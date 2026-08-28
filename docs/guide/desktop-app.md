---
title: Desktop App
---

# Building the macOS app

SystemCleaner ships as a self-contained `.app`. Nothing it shows comes over the
network: the bundle carries its own HTTP server, and the window points at
`127.0.0.1`.

```bash
bun run build:app        # SystemCleaner.app
bun run build:app:dmg    # ...plus a .dmg beside it
```

Both write to `storage/framework/desktop-dist/`.

## What is inside the bundle

```
SystemCleaner.app/Contents/
  MacOS/SystemCleaner            launcher      (app/Desktop/launcher.ts)
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

## Why not `buddy build:desktop` — for now

`buddy build:desktop` and `buddy build:dmg` used to build only one shape of
desktop app: the framework launcher opening a Craft window on `DESKTOP_URL`,
with everything the window shows coming off the network. SystemCleaner has no
server to point at — it reads the disks, processes, and login items of the Mac
it is installed on — and `build:dmg` copied exactly three files into the bundle
(`stacks-desktop`, `craft-runtime`, `desktop.json`), leaving nowhere to put the
agent or the UI payload.

Stacks has since gained the missing piece, and this app already sits on the
contract it settled on: `app/Desktop/launcher.ts` overrides the framework
launcher, `DESKTOP_URL` becomes optional, every file `build:desktop` emits is
bundled, and `app/Desktop/Resources/` is copied into `Contents/Resources`.

That is on the framework's `main` rather than in a release, so
`scripts/build-desktop-app.ts` still does the packaging here. When a published
Stacks carries it, the switch is: move the view build and the migrations under
`app/Desktop/Resources/`, compile the agent and scanner into
`storage/framework/desktop-dist`, run `buddy build:desktop && buddy build:dmg`,
and delete the script.

Either way the framework work goes through buddy: `buddy build:views` renders
the UI, `buddy generate:app-icons` renders the icon set from
`config/images.ts`, and `database/migrations/` is whatever
`buddy migrate:regenerate` derived from `app/Models/`.

## Signing and notarizing

Unsigned bundles run on the machine that built them and nowhere else —
Gatekeeper refuses them. For distribution:

```bash
DESKTOP_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)" \
NOTARY_PROFILE=systemcleaner \
bun run build:app:dmg
```

`NOTARY_PROFILE` names a keychain profile you create once:

```bash
xcrun notarytool store-credentials systemcleaner \
  --apple-id you@example.com --team-id TEAMID --password app-specific-password
```

With the identity set, the script signs inside-out (nested executables first,
the bundle last) and verifies the result. With the notary profile set, it
submits the DMG, waits, and staples the ticket.

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

The reasons shown in each prompt come from the `NS*UsageDescription` keys in
`Info.plist`, written by `scripts/build-desktop-app.ts`.

Until Automation is allowed, "Move to Trash" fails and reports why; "Delete
Permanently" needs no Apple Events and works regardless.

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
