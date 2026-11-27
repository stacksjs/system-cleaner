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

Both run for version tags. The Store job requires the repository variable
`APPLE_STORE_ENABLED` and validates the package by default.

## What runs where

`buddy` builds and signs. Pantry prepares the keychain and delivers packages.

1. **`pantry-pm/pantry/packages/action`** with `apple-signing` creates an
   ephemeral keychain, imports the application and installer identities, writes
   the provisioning profile, and deletes the keychain in its post step — which
   runs even if the job is cancelled.
2. **`bun run build:app-store`** builds the Craft-backed app and prepares its
   bundled migrations for an installed copy. Buddy applies the App Sandbox
   entitlements, signs the helper before the parent, and produces the installer `.pkg`.
3. **`ts-pantry app-store:deliver`** validates or uploads the package to
   App Store Connect.

## Validate before you upload

A tag push builds and signs the package and checks it against App Store Connect.

To upload, run **Publish Mac App Store** with `upload` enabled and the next build
number after checking the app locally.

A Store build number is immutable. Retry a failed upload with the same signed
artifact; only rebuild with a new number when the binary itself changes.

## Repository variables

| Variable | Example |
|---|---|
| `APPLE_STORE_ENABLED` | `true` after configuring signing and runtime inputs |
| `DESKTOP_STORE_BUN_URL` | HTTPS URL for the pinned arm64 Bun executable |
| `DESKTOP_STORE_BUN_SHA256` | SHA-256 of that executable |

The Store build requires Bun linked to upstream ICU. Follow the
[Stacks runtime build guide](https://github.com/stacksjs/stacks/blob/main/docs/packages/desktop.md#bun-executables-for-the-mac-app-store)
and use the same executable for CI and local qualification. Buddy loads the
remaining app and entitlement settings from `config/desktop.ts`.

## Repository secrets

| Secret | |
|---|---|
| `APPLE_STORE_APP_CERTIFICATE_BASE64` | Mac App Distribution `.p12`, base64 |
| `APPLE_STORE_INSTALLER_CERTIFICATE_BASE64` | Mac Installer Distribution `.p12`, base64 |
| `APPLE_STORE_CERTIFICATE_PASSWORD` | password for both `.p12` files |
| `APPLE_STORE_PROVISIONING_PROFILE_BASE64` | Mac App Store profile, base64 |
| `APP_STORE_CONNECT_PRIVATE_KEY` | contents of the `AuthKey_*.p8` |
| `APP_STORE_CONNECT_API_KEY_ID` | |
| `APP_STORE_CONNECT_ISSUER_ID` | |

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
open storage/framework/desktop-dist/apple/SystemCleaner.app

# Sign for the Store and package it
DESKTOP_BUN_EXECUTABLE=/path/to/bun-store \
APPLE_PROVISIONING_PROFILE=.pantry/apple/mac-app-store.provisionprofile \
  bun run build:app-store --build-number 4

# Validate, then upload to App Store Connect (TestFlight)
ts-pantry app-store:deliver storage/framework/desktop-dist/apple/SystemCleaner-<version>-<build>.pkg --validate-only …
ts-pantry app-store:deliver storage/framework/desktop-dist/apple/SystemCleaner-<version>-<build>.pkg …
```

`--build-number` must grow with every upload. Set the Store marketing version
in `config/desktop.ts`.

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

The edition is detected from its bundled `craft-backend` executable.
`packages/core/src/sandbox.ts` also recognizes the sandbox environment flag when macOS supplies it.

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

## App Review notes

`app/Desktop/AppReviewNotes.txt` is the text for the *Notes* field of App
Review Information: how to test the home folder grant, why the app asks for it,
and what this edition leaves out. Paste it into App Store Connect, or give it to
`ts-pantry app-store:listing` as `reviewNotes` in `app-store.config.ts`
(`reviewNotes: fs.readFileSync('app/Desktop/AppReviewNotes.txt', 'utf8')`).
