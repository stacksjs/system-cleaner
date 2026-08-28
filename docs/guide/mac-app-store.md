# Mac App Store releases

::: warning The Store build is a reduced app
Everything on this page describes a **sandboxed** build. The App Store requires
`com.apple.security.app-sandbox`, and a sandboxed process cannot read
`~/Library`, enumerate `/Applications`, signal other processes, or exec `brew` —
which is most of what SystemCleaner does. Cleanup targets, startup items,
extension audits, process control, and Homebrew updates are all unavailable in
this build.

The distributable app is the Developer ID one in
[Desktop App](/guide/desktop-app). Keep this pipeline for a Store presence if
you want one; do not treat it as the primary artifact.
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
