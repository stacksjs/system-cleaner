---
title: Desktop App
---

# Building the macOS app

The desktop app requires macOS 15 or newer, matching the pinned Craft runtime.
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
  MacOS/SystemCleaner           launcher, agent and scanner subcommands
  MacOS/craft-runtime            native window
  Resources/web/                 application pages and assets
  Resources/migrations/          database schema
```

The launcher starts `SystemCleaner agent` on loopback, waits for `/__health`,
opens Craft's native tray popover on `/app/tray`, and stops the agent when the app quits. Disk scans
run in another process as `SystemCleaner scan <json>`, so a blocked scan can be
stopped independently. All three share one executable and one embedded Bun
runtime.

Application data lives in `~/Library/Application Support/SystemCleaner/`.
The installed bundle is read-only and replaced wholesale on update.

## Menu bar overview

On macOS, the native `--tray-popover` window owns the menu-bar icon. Its
`/app/tray` page opens a named `dashboard` window on launch, so the full app
remains available normally. Closing that window keeps the tray and agent alive;
Open SystemCleaner brings the same window back with its page and scans intact.
View → System Overview (Shift-Command-M) also opens the popover. The primary
tray page owns the application menu and routes page commands to the dashboard.
The panel reuses `BrandMark`; the status item uses a native template rendered
from `public/images/systemcleaner-mark.svg`. After changing that artwork, run
`bun scripts/render-tray-icon.ts` and commit the resulting PNG.

The panel shows available startup-disk space, used and available memory, CPU
utilization, processor details and uptime. `/api/system-status` measures these
without a process listing or cleanup scan. Readings refresh every three seconds
while the popover is focused. A failed refresh keeps the last reading and shows
its timestamp and an offline notice. The tray, app and Settings share appearance
preferences through the persistent website data store.

## How the build is split

| Step | Owner |
|---|---|
| Render the local-agent UI | `buddy build:views`, with `SYSTEM_CLEANER_AGENT=1` |
| Stage application pages, assets and migrations | `scripts/build-desktop-app.ts` |
| Compile the launcher and bundle Craft | `buddy build:desktop` |
| Assemble and sign the application | `buddy build:dmg` |
| Author, compress, sign and notarize the installer | Pantry's `create-dmg` |
| Verify the finished image and generate `update.json` | `scripts/build-desktop-app.ts` |

Stacks reads `app/Desktop/launcher.ts`, `app/Desktop/Resources/`,
`app/Desktop/Info.plist.json` and `app/Desktop/Entitlements.plist` directly.
It owns executable placement and inside-out signing. A failed packaging command
fails the build; the app does not recover arbitrary staging directories or
repair a failed signature.

`stageDesktopWeb` keeps application HTML, runtime chunks, styles, fonts and
referenced assets. Marketing pages and showcase screenshots stay on the website.
Production browser scripts and the compiled launcher are minified.

## The drag-and-drop installer

`resources/dmg/deps.yaml` pins `github.com/create-dmg/create-dmg`. The macOS
build installs it through Pantry with `--no-save`, keeping platform build tools
out of the root runtime dependencies used on Linux and Windows.
`pantry which --resolve` locates its provider executable, so its bundled support
files resolve correctly through either symlinks or activation scripts. It builds a 660×460 Finder window with the app
on the left, an Applications drop target on the right, and instruction artwork.
It also sets the volume icon, hides the app extension and uses HFS+ with LZMA
(`ULMO`) compression. The signed app is supplied by Stacks unchanged.

Geometry lives in `DMG_WINDOW` in `scripts/dmg-window.ts`. Edit the artwork in
`resources/dmg/installer-background.svg`, then regenerate its committed PNG:

```bash
bun scripts/render-dmg-background.ts
```

The final mounted image must contain the background, the intended window and
icon geometry, and a symlink to `/Applications`. Signature, image integrity,
notarization ticket and Gatekeeper checks must pass. A cosmetic failure stops
the release; there is no position-only installer fallback.

The build emits `size-report.json` with payload and image sizes and requires
exactly one Bun executable. Set `DMG_BENCHMARK=1` to compare maximum zlib and
LZFSE compression against the shipped LZMA image. On the same signed payload,
LZMA measured 33.16 MiB, LZFSE 44.95 MiB, and maximum zlib 46.77 MiB. Alternative
images are temporary and never published.

The exact `.app` from the finished image is also copied to
`storage/framework/desktop-dist/SystemCleaner.app` for local launch and QA.

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

With the identity set, Stacks signs the executable leaves and then seals the
bundle, using `app/Desktop/Entitlements.plist`. Use the identity's SHA-1
fingerprint if multiple certificates share its name. Pantry's `create-dmg`
signs the final installer, submits it to Apple and staples its accepted ticket.
The build then validates the ticket and asks Gatekeeper to assess the shipped
image and application.

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
| `persistentStorage: true` | The same website data store the main window uses. Without it the window writes preferences nothing else can read — see below. |

Requires Craft 0.0.89 — `window.open`, per-window action routing,
`chromeControls` and `persistentStorage` all landed there. On anything older `craft.window.open` is
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

### Why the app's preferences used to evaporate

Two separate things had to be true before a setting written on the page could
survive being written, and neither was:

1. **Craft's website data store is ephemeral by default**, and each window gets
   one of its own — no disk I/O at startup, which is right for a window that
   only renders. `localStorage.setItem` succeeds, and the value is gone at the
   next launch and invisible to every other window meanwhile. Nothing reports
   it. `--persistent-storage` on the launcher and `persistentStorage: true` on
   the Settings window opt into the shared, durable store.

2. **The agent's port is the page's origin.** Asking the OS for a free port is
   right — a fixed one collides with whatever else is running, and with a
   second copy of the app — but asking for a *different* one every launch makes
   `http://127.0.0.1:<port>` a different origin every launch, and browser
   storage is scoped to an origin. The launcher now writes the number to
   `agent-port` in the data directory and asks for it again;
   `app/Support/Runtime/agent-port.ts` is that file's reader and writer, and
   the agent falls back to a fresh port when it is taken.

Both are needed. Either one alone leaves the colour mode resetting to "system"
on every start, along with every switch in the Settings window.

## Releasing

```bash
bun run release:patch
```

Buddy updates the version and changelog and pushes the release tag. The
**Releaser** builds the CLI archives, Windows bundle, and signed macOS installer
before publishing anything. The macOS build uses `macos-15`; the Craft binary
supplies its own SDK-linked window chrome.

One Pantry Action receives all five artifacts, attaches them to the GitHub
release, and generates complete `checksums.txt` and `release-manifest.json`
files. Publication requires the DMG and its matching `update.json`; a missing
installer fails the release. There are no independent upload jobs overwriting
one another's checksums.

| Repository variable | Example |
|---|---|
| `DESKTOP_SIGNING_IDENTITY_NAME` | `Developer ID Application: Your Name (TEAMID)` |

| Repository secret | Purpose |
|---|---|
| `DEVELOPER_ID_CERTIFICATE_BASE64` | Developer ID Application `.p12`, base64 |
| `APPLE_CERTIFICATE_PASSWORD` | Certificate password |
| `APPLE_ID` | Apple ID for notarization |
| `APPLE_TEAM_ID` | 10-character team ID |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password |

Pantry imports the certificate into an ephemeral keychain and removes it in its
post step. These credentials are separate from Mac App Store distribution.

## Updating itself

The app checks GitHub for a newer release from the **Updates** screen, next to
the macOS, Homebrew and Pantry sections. It is deliberately three steps —
check, download, install — because each one costs something different: a check
is free, a download is 40 MB of the user's bandwidth, and an install quits the
app.

`build:app` writes `update.json` beside the DMG, and the Pantry release step attaches
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

## Checking appearance

The main, Settings and VPN windows share `public/app-theme.css` and
`resources/lib/appearance.ts`. The pre-paint STX appearance bootstrap uses the
same storage key. Each window updates its page and native appearance on theme
changes, storage clearing, focus and system appearance changes. The Settings
segmented control follows the stored preference as well.

With the bundled agent running, verify synchronization, persistence and visible
text contrast across every application route and Settings pane:

```bash
BASE_URL=http://127.0.0.1:<port> bun scripts/verify-appearance.ts
```

The check writes screenshots and its report under `.shots/appearance/`.
