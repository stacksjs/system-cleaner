#!/usr/bin/env bun
/* eslint-disable ts/no-top-level-await, no-console */
/**
 * Package SystemCleaner as a macOS `.app` inside a `.dmg`.
 *
 * This drives `buddy` rather than replacing it. Everything that is framework
 * work — compiling the launcher, bundling the Craft runtime, writing the
 * manifest and provenance, building the icon, assembling the bundle, signing,
 * and imaging the DMG — belongs to `buddy build:desktop` and `buddy build:dmg`.
 * What is left here is the three things only this app can know:
 *
 *   1. the UI has to be rendered as the local agent, not as the marketing site
 *   2. the launcher spawns two sibling binaries, which need compiling into the
 *      same directory `build:desktop` writes to
 *   3. the bundle carries a payload — the rendered UI and the migrations
 *
 * The framework learned the rest in 0.72.99 and 0.72.100:
 * `app/Desktop/launcher.ts` overrides the framework launcher, `DESKTOP_URL`
 * becomes optional for such an app, every file in `desktop-dist` is bundled,
 * `app/Desktop/Resources/` is copied into `Contents/Resources`, and
 * `app/Desktop/Info.plist.json` supplies the permission-prompt strings.
 *
 * Signing
 * -------
 * `DESKTOP_SIGNING_IDENTITY` (a Developer ID Application identity) makes
 * `build:dmg` sign the bundle; `NOTARY_PROFILE` then notarizes and staples the
 * DMG here, which `build:dmg` does not do and which Gatekeeper requires on a
 * Mac that has never seen the app. Unsigned still builds — useful locally, not
 * distributable.
 *
 * Developer ID rather than Mac App Store, deliberately: the Store requires
 * `com.apple.security.app-sandbox`, and a sandboxed process cannot read
 * `~/Library`, enumerate `/Applications`, signal other processes, or exec
 * `brew` — which is most of this app. See docs/guide/mac-app-store.md.
 */

import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()
const APP_NAME = process.env.DESKTOP_APP_NAME || 'SystemCleaner'
const DESKTOP_DIST = path.join(ROOT, 'storage/framework/desktop-dist')
const RESOURCES = path.join(ROOT, 'app/Desktop/Resources')

if (process.platform !== 'darwin') {
  console.error('[desktop] SystemCleaner only builds on macOS')
  process.exit(1)
}

const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || '0.0.0'

/**
 * Point the framework at the Craft runtime this project declares in
 * `deps.yaml`.
 *
 * `buddy build:desktop` resolves `CRAFT_BIN`, then `craft` on PATH. Pantry
 * installs into the project rather than onto PATH, so without this the build
 * fails on a machine that has done nothing wrong.
 */
function resolveCraftBin(): string | undefined {
  if (process.env.CRAFT_BIN) return process.env.CRAFT_BIN

  const pantryDir = path.join(ROOT, 'pantry/craft-native.org')
  if (!fs.existsSync(pantryDir)) return undefined

  // Newest installed version wins, so an upgrade needs no edit here.
  for (const dir of fs.readdirSync(pantryDir).filter(name => name.startsWith('v')).sort().reverse()) {
    const candidate = path.join(pantryDir, dir, 'bin/craft')
    if (fs.existsSync(candidate)) return candidate
  }

  return undefined
}

const craftBin = resolveCraftBin()

/** Environment every step shares: this is a production build of the local agent. */
const buildEnv: Record<string, string> = {
  APP_ENV: 'production',
  NODE_ENV: 'production',
  // Without this, `resources/layouts/app.stx` renders the "runs on your Mac"
  // download prompt — correct for the website, useless inside the app itself.
  SYSTEM_CLEANER_AGENT: '1',
  DESKTOP_APP_NAME: APP_NAME,
  DESKTOP_APP_VERSION: version,
  DESKTOP_BUNDLE_ID: process.env.DESKTOP_BUNDLE_ID || 'org.stacksjs.system-cleaner',
  ...(craftBin ? { CRAFT_BIN: craftBin } : {}),
}

function run(cmd: string, args: string[], envOverrides: Record<string, string> = {}): void {
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    cwd: ROOT,
    env: { ...process.env, ...buildEnv, ...envOverrides },
  })
  if (result.status !== 0)
    throw new Error(`${cmd} ${args.join(' ')} exited with ${result.status}`)
}

// ── 1. Render the UI ────────────────────────────────────────────
// The STX page cache is keyed on the template, not on the environment that
// rendered it, so a cached page from a marketing build would ship the download
// prompt inside the app. A full render is ~3s; shipping the wrong payload is
// not worth saving it.
console.log('[desktop] building views')
for (const cache of ['.stx', 'storage/framework/stx', 'dist'])
  fs.rmSync(path.join(ROOT, cache), { recursive: true, force: true })

run('./buddy', ['build:views'])

const web = path.join(ROOT, 'dist')
if (!fs.existsSync(path.join(web, 'app/large-files.html')))
  throw new Error(`View build did not produce the app pages in ${web}`)

// ── 2. Stage the payload ────────────────────────────────────────
// `buddy build:dmg` copies this directory into Contents/Resources. Both halves
// are build output — the rendered UI, and the migrations `buddy
// migrate:regenerate` derived from app/Models — so it is rebuilt each time
// rather than tracked.
console.log('[desktop] staging bundle resources')
fs.rmSync(RESOURCES, { recursive: true, force: true })
fs.mkdirSync(RESOURCES, { recursive: true })
fs.cpSync(web, path.join(RESOURCES, 'web'), { recursive: true })
fs.cpSync(path.join(ROOT, 'database/migrations'), path.join(RESOURCES, 'migrations'), { recursive: true })

// ── 3. Launcher, Craft runtime, manifest ────────────────────────
// Compiles app/Desktop/launcher.ts, since this app supplies one.
console.log('[desktop] building the desktop bundle')
run('./buddy', ['build:desktop'])

// ── 4. The binaries the launcher spawns ─────────────────────────
// After build:desktop, which clears that directory first. The scanner is its
// own executable because `bun build --compile` does not embed worker
// entrypoints — see the note at the top of app/Workers/disk-scan.ts.
for (const [entry, name] of [
  ['app/Desktop/server.ts', 'system-cleaner-agent'],
  ['app/Workers/disk-scan.ts', 'system-cleaner-scan'],
] as const) {
  console.log(`[desktop] compiling ${name}`)
  run('bun', [
    'build', path.join(ROOT, entry),
    '--compile', '--target=bun-darwin-arm64',
    '--outfile', path.join(DESKTOP_DIST, name),
  ])
}

// ── 5. Bundle and image ─────────────────────────────────────────
console.log('[desktop] packaging')
// The framework cannot yet distinguish executable payloads from its JSON
// metadata when signing an app with a userland launcher. Build the image
// unsigned here; `sealSignedBundle` below performs the authoritative,
// verified inside-out signing pass.
run('./buddy', ['build:dmg'], { DESKTOP_SIGNING_IDENTITY: '' })

const dmgDir = path.join(ROOT, 'storage/framework/desktop-dmg')
const dmg = (fs.existsSync(dmgDir) ? fs.readdirSync(dmgDir) : []).find(file => file.endsWith('.dmg'))
if (!dmg)
  throw new Error(`build:dmg produced no disk image in ${dmgDir}`)

const dmgPath = path.join(dmgDir, dmg)

/**
 * `build:dmg` copies every desktop-dist file into `Contents/MacOS`. That is
 * harmless for unsigned development images, but Apple treats every item in
 * that directory as nested code when it seals the outer bundle. The manifest,
 * provenance, and checksum files therefore make an otherwise valid Developer
 * ID signature fail with "code object is not signed at all".
 *
 * The userland launcher does not consume those files. Preserve them as build
 * metadata under Resources, then sign the executable leaves before sealing the
 * app itself. Rebuilding the image here also makes a failed framework signing
 * attempt impossible to mistake for a distributable artifact.
 */
function sealSignedBundle(imagePath: string): void {
  const identity = process.env.DESKTOP_SIGNING_IDENTITY
  if (!identity)
    return

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'system-cleaner-sign-'))
  const mountDir = path.join(workDir, 'mounted')
  const imageRoot = path.join(workDir, 'image')
  const appBundle = path.join(imageRoot, `${APP_NAME}.app`)
  const rebuiltImage = path.join(workDir, path.basename(imagePath))
  let mounted = false

  fs.mkdirSync(mountDir)
  fs.mkdirSync(imageRoot)

  try {
    run('hdiutil', ['attach', imagePath, '-nobrowse', '-readonly', '-mountpoint', mountDir])
    mounted = true
    run('ditto', [path.join(mountDir, `${APP_NAME}.app`), appBundle])
    run('hdiutil', ['detach', mountDir])
    mounted = false

    const macosDir = path.join(appBundle, 'Contents/MacOS')
    const metadataDir = path.join(appBundle, 'Contents/Resources/BuildMetadata')
    fs.mkdirSync(metadataDir, { recursive: true })

    for (const name of ['desktop.json', 'provenance.json', 'checksums.sha256']) {
      const source = path.join(macosDir, name)
      if (fs.existsSync(source))
        fs.renameSync(source, path.join(metadataDir, name))
    }

    // Hardened runtime with no entitlements produces a window that opens,
    // reports valid bounds, and draws nothing: WebKit cannot allocate
    // executable memory for JavaScriptCore, the content process is killed, and
    // the webview never composites. The app looked like it had vanished.
    //
    // `app/Desktop/Entitlements.plist` carries the minimum that a Craft window
    // and three compiled Bun binaries need under `--options runtime`:
    //
    //   allow-jit                        JavaScriptCore, in the webview and in Bun
    //   allow-unsigned-executable-memory  Bun maps pages it writes to
    //   disable-library-validation        the launcher spawns sibling binaries
    //   allow-dyld-environment-variables  the launcher passes SYSTEM_CLEANER_* through
    //   automation.apple-events           "Move to Trash" drives Finder
    //
    // The file carries no XML comments: AMFI's unserializer is stricter than
    // `plutil -lint` and rejects them outright — "syntax error near line 12",
    // pointing at a comment plutil had just called valid.
    const entitlements = path.join(ROOT, 'app/Desktop/Entitlements.plist')
    if (!fs.existsSync(entitlements))
      throw new Error(`Signing needs ${entitlements}`)

    const signArgs = [
      '--force',
      '--options', 'runtime',
      '--entitlements', entitlements,
      '--timestamp',
      '--sign', identity,
    ]

    for (const name of ['system-cleaner-scan', 'craft-runtime', 'system-cleaner-agent', APP_NAME])
      run('codesign', [...signArgs, path.join(macosDir, name)])

    run('codesign', [...signArgs, appBundle])
    run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appBundle])

    fs.symlinkSync('/Applications', path.join(imageRoot, 'Applications'))
    run('hdiutil', [
      'create',
      '-volname', APP_NAME,
      '-srcfolder', imageRoot,
      '-ov',
      '-format', 'UDZO',
      rebuiltImage,
    ])
    fs.renameSync(rebuiltImage, imagePath)
  }
  finally {
    if (mounted) {
      spawnSync('hdiutil', ['detach', mountDir], {
        stdio: 'inherit',
        cwd: ROOT,
      })
    }
    fs.rmSync(workDir, { recursive: true, force: true })
  }
}

sealSignedBundle(dmgPath)

// ── 6. Notarize ─────────────────────────────────────────────────
// Signing is `build:dmg`'s job; notarization is not, and a signed but
// un-notarized DMG is still refused by Gatekeeper on a Mac that has never seen
// it. `NOTARY_PROFILE` names a keychain profile created once with
// `xcrun notarytool store-credentials`.
if (process.env.NOTARY_PROFILE) {
  console.log('[desktop] submitting to the notary service')
  run('xcrun', ['notarytool', 'submit', dmgPath, '--keychain-profile', process.env.NOTARY_PROFILE, '--wait'])
  run('xcrun', ['stapler', 'staple', dmgPath])
}

if (!process.env.DESKTOP_SIGNING_IDENTITY)
  console.warn('[desktop] DESKTOP_SIGNING_IDENTITY is unset — the bundle is unsigned and will not launch on another Mac')
else if (!process.env.NOTARY_PROFILE)
  console.warn('[desktop] NOTARY_PROFILE is unset — the DMG is signed but not notarized')

console.log(`[desktop] ${dmgPath}`)
