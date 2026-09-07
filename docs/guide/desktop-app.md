---
title: Desktop App
---

# Building the macOS app

SystemCleaner ships as a self-contained `.app`. Nothing it shows comes over the
network: the bundle carries its own HTTP server, and the window points at
`127.0.0.1`.

```bash
bun run build:app
```

That writes `storage/framework/desktop-dmg/SystemCleaner-<version>.dmg`.

## What is inside the bundle

```
SystemCleaner.app/Contents/
  MacOS/stacks-desktop           launcher      (app/Desktop/launcher.ts)
  MacOS/system-cleaner-agent     HTTP server   (app/Desktop/server.ts)
  MacOS/system-cleaner-scan      disk scanner  (app/Workers/disk-scan.ts)
  MacOS/craft-runtime            native window (pantry: craft-native.org)
  Resources/web/                 UI            (buddy build:views)
  Resources/migrations/          schema        (buddy migrate:regenerate)
```

Launching runs four steps in order: the launcher starts the agent on a loopback
port the OS picks, waits for `/__health`, opens the Craft window on
`http://127.0.0.1:<port>/app`, and kills the agent when the window closes.

The scanner is a separate binary rather than a `Worker` because
`bun build --compile` does not embed worker entrypoints. It is also the more
robust arrangement: a scan that wedges inside a blocking `readdir` can be
killed, which a worker cannot.

Application data lives in `~/Library/Application Support/SystemCleaner/`. The
bundle in `/Applications` is read-only and is replaced wholesale on update, so
cleanup history cannot live inside it.

## How the build is split

`buddy` does the framework work; `scripts/build-desktop-app.ts` does the three
things only this app can know.

| Step | Owner |
|---|---|
| Render the UI as the local agent | `buddy build:views`, with `SYSTEM_CLEANER_AGENT=1` |
| Stage the payload into `app/Desktop/Resources/` | this app |
| Compile the launcher, bundle Craft, write the manifest | `buddy build:desktop` |
| Compile the agent and scanner into `desktop-dist` | this app |
| Assemble the bundle, build the icon, sign, image the DMG | `buddy build:dmg` |

Four framework conventions make that possible, all added in Stacks 0.72.99 and
0.72.100:

- **`app/Desktop/launcher.ts`** overrides the framework launcher, which would
  otherwise open a Craft window on a remote `DESKTOP_URL`. SystemCleaner has no
  such URL — it starts a server locally and opens a window on that, on a port
  not known until launch.
- **`DESKTOP_URL` is optional** once an app owns its launcher.
- **Every file `build:desktop` emits is bundled** into `Contents/MacOS`, so the
  sibling binaries the launcher spawns travel with it, and
  **`app/Desktop/Resources/`** is copied into `Contents/Resources`.
- **`app/Desktop/Info.plist.json`** supplies the `NS*UsageDescription` strings —
  the sentences macOS shows when it asks to read your Downloads folder or drive
  Finder.

`build:dmg` also narrows App Transport Security for an app-owned launcher: an
exception for `127.0.0.1` rather than `NSAllowsArbitraryLoads`, which would
additionally permit every unencrypted host on the internet.

## Signing and notarizing

Unsigned bundles run on the machine that built them and nowhere else —
Gatekeeper refuses them. For distribution:

```bash
DESKTOP_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)" \
NOTARY_PROFILE=systemcleaner \
bun run build:app
```

`NOTARY_PROFILE` names a keychain profile you create once:

```bash
xcrun notarytool store-credentials systemcleaner \
  --apple-id you@example.com --team-id TEAMID --password app-specific-password
```

With the identity set, `buddy build:dmg` signs inside-out — every nested
executable, then the launcher, then the bundle — because signing the parent
first invalidates its seal. With the notary profile set, the build script
submits the DMG, waits, and staples the ticket; a signed but un-notarized DMG is
still refused on a Mac that has never seen it.

**Developer ID rather than the Mac App Store, deliberately.** The App Store
requires `com.apple.security.app-sandbox`, and a sandboxed process cannot read
`~/Library`, enumerate `/Applications`, signal other processes, or exec `brew` —
which is most of what this app does. See [Mac App Store](/guide/mac-app-store)
for the Store pipeline, which remains wired up but produces a build with those
capabilities removed.

## Permissions on first launch

macOS gates the things SystemCleaner is for, and each gate is a prompt the user
answers once:

| Prompt | Needed for |
|---|---|
| Desktop / Documents / Downloads access | scanning those folders for large files |
| Full Disk Access (System Settings) | reading `~/Library` caches and login items |
| Automation → Finder | moving items to the Trash instead of deleting them |

The reasons shown in each prompt are the `NS*UsageDescription` strings in
`app/Desktop/Info.plist.json`, which `buddy build:dmg` merges into the bundle's
`Info.plist`.

Until Automation is allowed, "Move to Trash" fails and reports why; "Delete
Permanently" needs no Apple Events and works regardless.

## The Settings window

⌘, opens a second window rather than a sheet, because that is what Settings is
on a Mac — its own window, closed without disturbing what you were looking at.
It is `/app/settings`, served by the same agent as everything else, opened
through Craft's window bridge:

```ts
craft.window.open({
  name: 'settings',
  url: 'http://127.0.0.1:<port>/app/settings',
  width: 715,
  height: 640,
  titlebarHidden: true,
  webWindowMaterial: true,
  chromeControls: false,
})
```

Four of those are the whole design, and each is a decision:

| Option | Why |
|---|---|
| `name: 'settings'` | Craft brings an already-open window of that name forward instead of opening a second one, which is what ⌘, twice does in every Mac app. |
| `titlebarHidden` | Puts the window buttons over the sidebar's top-left corner, where System Settings has them. |
| `webWindowMaterial` | One material behind the whole view. The `webSidebarMaterial` span looks closer to this window and is pinned to vibrant light, so it would leave a pale sidebar in dark mode; the page paints both surfaces instead, and they flip with the theme. |
| `chromeControls: false` | Craft otherwise draws a sidebar toggle and two history arrows beside the window buttons. This window draws its own history in the detail pane's toolbar, and two pairs of arrows mean two different things. |

Requires Craft 0.0.89 — `window.open`, per-window action routing and
`chromeControls` all landed there. On anything older `craft.window.open` is
absent and ⌘, falls back to a browser tab, which is what happens on the
marketing site too.

The window is four files that have to agree, and `tests/settings-window.test.ts`
is what makes them:

| Path | What it holds |
|---|---|
| `resources/layouts/settings.stx` | the shell: two columns, the toolbar, the whole stylesheet |
| `resources/components/SettingsSidebar.stx` | the rows, their icons and their grouping |
| `resources/views/app/settings.stx` | one `.set-pane` per row |
| `resources/scripts/settings-window.ts` | the wiring — what each control reads and writes |

The main window keeps `resources/scripts/settings-panel.ts`, which is now only
the opener plus its own half of the appearance work: Craft routes a window
action to the window that asked for it, so each window sets its own
`setAppearance`, and both read the one stored colour mode.

## Releasing

The **Releaser** workflow builds the DMG on a tag push and attaches it to the
GitHub release. The job is skipped entirely until
`DESKTOP_SIGNING_IDENTITY_NAME` is set, so the CLI release is never blocked by a
half-configured signing setup.

| Repository variable | Example |
|---|---|
| `DESKTOP_SIGNING_IDENTITY_NAME` | `Developer ID Application: Your Name (TEAMID)` |

| Repository secret | |
|---|---|
| `DEVELOPER_ID_CERTIFICATE_BASE64` | Developer ID Application `.p12`, base64 |
| `APPLE_CERTIFICATE_PASSWORD` | password the `.p12` was exported with |
| `APPLE_ID` | Apple ID used for notarization |
| `APPLE_TEAM_ID` | 10-character team ID |
| `APPLE_APP_SPECIFIC_PASSWORD` | app-specific password for that Apple ID |

These are a different certificate from the Mac App Store pipeline: Developer ID
Application, not Mac App Distribution.

## Updating itself

The app checks GitHub for a newer release from the **Updates** screen, next to
the macOS, Homebrew and Pantry sections. It is deliberately three steps —
check, download, install — because each one costs something different: a check
is free, a download is 40 MB of the user's bandwidth, and an install quits the
app.

`build:app` writes `update.json` beside the DMG, and the Releaser attaches
both. The manifest is generated **after** notarization: stapling the ticket
rewrites the DMG, so a manifest built earlier carries a hash no download can
match.

### What has to be true before the app replaces itself

The manifest's SHA-256 is the weakest of the checks, not the strongest —
whoever can rewrite the manifest can rewrite the hash with it. So the
downloaded bundle is unpacked to a staging directory and put through the same
questions Gatekeeper asks at launch, before anything at
`~/Applications/SystemCleaner.app` is touched:

| Check | Rejects |
|---|---|
| `codesign --verify --deep --strict` | a tampered or re-packed bundle |
| `spctl -a -t exec` | anything Apple has not notarized |
| `TeamIdentifier` matches the running copy | notarized builds from other developers |

The team is not configured anywhere — it is read from the signature on the copy
already installed, so the app can only ever be updated by whoever shipped it.

Only then is the quarantine flag cleared and the bundle swapped, and the swap
is two renames inside the install directory rather than a delete and a copy, so
an interrupted update never leaves the user without an app.

An unsigned local build still produces a manifest, and `build:app` says so: an
installed copy will refuse that update, which is the correct outcome and a
confusing one to debug without the warning.
