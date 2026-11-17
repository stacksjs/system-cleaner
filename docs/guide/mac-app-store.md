# Mac App Store releases

::: info The Store build runs in the App Sandbox
The App Store requires `com.apple.security.app-sandbox`. A sandboxed process
starts out seeing its own container as its home folder, so until the person
grants their real one, Quick Clean, Privacy and the disk scans have nothing to
look at. The edition asks once, through an Open panel, and keeps the answer as
a security-scoped bookmark (see [Home folder access](#home-folder-access)).

What the sandbox rules out entirely is turned off and says why, instead of
rendering an empty or failing screen: Startup Items, uninstalling apps,
Maintenance, VPN control, Scheduled Clean, the process list, Homebrew and
Pantry updates, emptying the Trash, and the app's own update check. The
reasons live in `SANDBOX_LIMITS` in `packages/core/src/sandbox.ts`.

The Developer ID build in [Desktop App](/guide/desktop-app) keeps every
feature.
:::

SystemCleaner ships two artifacts from one tag:

| Artifact | Workflow | Runner |
|---|---|---|
| CLI binary attached to the GitHub release | `Releaser` | ubuntu |
| Signed `.pkg` delivered to App Store Connect | `Publish Mac App Store` | macOS |

Both fire on `push: tags: v*`. The App Store job is skipped entirely while
`APPLE_BUNDLE_ID` is unset, so the CLI release is never blocked by a
half-configured Store setup.

## What runs where

`buddy` builds and signs; the pantry Action owns the keychain and the delivery.
Neither reimplements the other:

1. **`pantry-pm/pantry/packages/action`** with `apple-signing` creates an
   ephemeral keychain, imports the application and installer identities, writes
   the provisioning profile, and deletes the keychain in its post step — which
   runs even if the job is cancelled.
2. **`buddy desktop:apple:doctor`** fails the run early if anything is missing,
   naming each item.
3. **`buddy desktop:apple:publish --package-only`** builds the Craft-backed app,
   applies the App Sandbox entitlements, signs the helper before the parent, and
   produces the installer `.pkg`.
4. **The same Action** with `release` and `release-app-store` attaches the
   package to the GitHub release and validates or uploads it to App Store
   Connect.

The signing identities default to whichever ones step 1 imported. Set
`APPLE_APP_SIGNING_IDENTITY` only when the keychain holds more than one
candidate.

## Validate before you upload

A tag push runs with `validate-only: true`: the package is built, signed, and
checked against App Store Connect, but nothing is delivered. A signing or
entitlement regression surfaces on the release that caused it, at no cost.

To actually upload, run **Publish Mac App Store** from the Actions tab with
`validate-only` unchecked, after the artifact has passed local launch and UI QA.

A Store build number is immutable. Retry a failed upload with the same signed
artifact; only rebuild with a new number when the binary itself changes.

## Repository variables

| Variable | Example |
|---|---|
| `APPLE_APP_NAME` | `SystemCleaner` |
| `APPLE_BUNDLE_ID` | `app.systemcleaner.desktop` |
| `APPLE_TEAM_ID` | 10-character team ID |
| `DESKTOP_URL` | HTTPS URL the packaged app opens |
| `APPLE_APP_SIGNING_IDENTITY` | optional, see above |
| `APPLE_INSTALLER_SIGNING_IDENTITY` | optional, see above |

## Repository secrets

| Secret | |
|---|---|
| `APPLE_APP_CERTIFICATE_BASE64` | Mac App Distribution `.p12`, base64 |
| `APPLE_INSTALLER_CERTIFICATE_BASE64` | Mac Installer Distribution `.p12`, base64 |
| `APPLE_CERTIFICATE_PASSWORD` | password both `.p12` files were exported with |
| `APPLE_PROVISIONING_PROFILE_BASE64` | Mac App Store profile, base64 |
| `APP_STORE_CONNECT_API_KEY` | contents of the `AuthKey_*.p8` |
| `APP_STORE_CONNECT_API_KEY_ID` | |
| `APP_STORE_CONNECT_API_ISSUER_ID` | |

`buddy desktop:apple:csr` generates the private keys and certificate signing
requests to upload to the Apple Developer portal, and
`buddy desktop:apple:provision` reconciles the bundle ID, capabilities,
certificates, and profile.

## Not automated

These need a human with the Apple account:

- Apple Developer Program enrollment and agreement acceptance
- App Store Connect API access approval and the initial key download
- banking, tax, pricing, privacy, age rating, and export-compliance answers
- the final App Review submission and release policy

## Building and uploading from this Mac

The Store edition is the same app with a different process layout. The App
Sandbox lets only the app itself put up a window, so Craft's App Store runtime
(`craft-app-store`, shipped with the pinned Craft) becomes the main executable,
and SystemCleaner's own binary runs as its `craft-backend`, starting the agent
inside the same sandbox. The direct build's runtime uses private APIs App Review
refuses, so it is left out.

```bash
# Register the bundle ID and make a profile around a certificate this Mac can sign with
ts-pantry app-store:provision --bundle-id org.stacksjs.system-cleaner --name SystemCleaner \
  --api-key-id <id> --api-issuer-id <issuer> --api-key-path <AuthKey.p8> --apply

# Launch the edition locally under the real sandbox (ad hoc signed)
bun run build:app-store:check
open storage/framework/app-store/SystemCleaner.app

# Sign for the Store and package it
APPLE_STORE_SIGNING_IDENTITY="Apple Distribution: …" \
APPLE_STORE_INSTALLER_IDENTITY="3rd Party Mac Developer Installer: …" \
APP_STORE_BUILD_NUMBER=1 bun run build:app-store

# Validate, then upload to App Store Connect (TestFlight)
ts-pantry app-store:deliver storage/framework/app-store/SystemCleaner-<version>-<build>.pkg --validate-only …
ts-pantry app-store:deliver storage/framework/app-store/SystemCleaner-<version>-<build>.pkg …
```

`APP_STORE_BUILD_NUMBER` must grow with every upload; the marketing version is
`package.json`'s. Set `TS_PANTRY_CLI` to a pantry checkout's
`packages/ts-pantry/bin/cli.ts` to use unreleased pantry commands.

## Checking locally

```bash
./buddy desktop:apple:doctor
```

It prints every unmet prerequisite. The `Mac App Distribution` and
`Mac Installer Distribution` identities are different certificates and are used
at different steps; the provisioning profile has to match the team ID, bundle
ID, and the entitlements the app requests.

Store delivery is not notarization. Distributing outside the Store uses a
Developer ID identity and `notarytool` instead — see
[Desktop App](/guide/desktop-app).

## Home folder access

The edition is detected at runtime: macOS sets `APP_SANDBOX_CONTAINER_ID` in
every sandboxed process, and `packages/core/src/sandbox.ts` reads it.

1. The Overview carries a banner, and every screen that reads the home folder
   shows a panel instead of its content, until the folder is granted. Both
   call `craft.dialog.requestFolderAccess`, which opens an Open panel at the
   real home folder (`realHomeFolder()` strips the container suffix off
   `HOME`).
2. Craft keeps a security-scoped bookmark in the app's defaults
   (`CraftSecurityScopedBookmarks`), then restarts `craft-backend`. A child
   inherits the sandbox extensions its parent holds when it is spawned, not
   ones it gains later, so the restart is what hands the access down. On every
   later launch Craft resolves the bookmark before it starts the backend.
3. Craft lists the held folders in `CRAFT_SECURITY_SCOPED_PATHS`. When one
   covers the real home folder, `app/Desktop/launcher.ts` starts the agent with
   `HOME` pointed at it and `SYSTEM_CLEANER_HOME_GRANTED=1`, and every
   `os.homedir()` underneath resolves there. The database stays in the
   container.
4. The page reloads on the restarted agent's address. A folder that does not
   cover home is given back with `craft.dialog.revokeFolderAccess`, and the
   panel says which folder to choose.

Move to Trash uses `-[NSFileManager trashItemAtURL:]` through `bun:ffi` in this
edition (`packages/disk/src/trash-native.ts`), because the sandbox refuses the
Apple Events the direct build sends Finder.

Craft's folder-access API is new in Craft (branch
`feat/app-store-folder-access`). Until a release carries it, point the build at
a local App Store runtime:

```bash
CRAFT_APP_STORE_RUNTIME=~/Code/Tools/craft-worktrees/app-store-folder-access/packages/zig/zig-out/bin/craft \
  bun run build:app-store:check
```

## App Review notes

`app/Desktop/AppReviewNotes.txt` is the text for the *Notes* field of App
Review Information: how to test the home folder grant, why the app asks for it,
and what this edition leaves out. Paste it into App Store Connect, or give it to
`ts-pantry app-store:listing` as `reviewNotes` in `app-store.config.ts`
(`reviewNotes: fs.readFileSync('app/Desktop/AppReviewNotes.txt', 'utf8')`).
