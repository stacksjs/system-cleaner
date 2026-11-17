#!/usr/bin/env bun
/* eslint-disable ts/no-top-level-await, no-console */
/**
 * Build the local-agent UI and package it for macOS.
 * Stacks compiles the single executable and assembles/signs the application.
 * Pantry's create-dmg owns the drag-and-drop installer and notarization.
 * NOTARY_PROFILE names the keychain credentials; DESKTOP_SIGNING_IDENTITY
 * accepts a Developer ID name or fingerprint (use the latter for duplicates).
 *
 * `--app-store` builds the Mac App Store edition instead: the same bundle,
 * re-signed for the App Sandbox with the Store identity and profile, and
 * packaged by Pantry as a signed installer package. `--sandbox-check` signs
 * that edition ad hoc instead, so it can be launched on this Mac under the
 * real sandbox; Store-signed builds only run once installed through the
 * Store or TestFlight.
 *
 *   APPLE_STORE_SIGNING_IDENTITY       Apple Distribution identity (name or SHA-1)
 *   APPLE_STORE_INSTALLER_IDENTITY     3rd Party Mac Developer Installer identity
 *   APPLE_STORE_PROVISIONING_PROFILE   defaults to .pantry/apple/mac-app-store.provisionprofile
 *   APP_STORE_BUILD_NUMBER             CFBundleVersion, a positive integer (default 1)
 *   TS_PANTRY_CLI                      a ts-pantry source checkout's bin/cli.ts, instead of `bunx ts-pantry`
 */

import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import process from 'node:process'
import { createGitHubUpdateManifest, UPDATE_MANIFEST_ASSET } from '@stacksjs/desktop'
import { looksLikeBunExecutable, resolveCraftExecutable } from '@stacksjs/desktop-build'
import { stageDesktopWeb } from './desktop-resources'
import { DMG_WINDOW, readDmgWindowLayout } from './dmg-window'

const ROOT = process.cwd()
const APP_NAME = process.env.DESKTOP_APP_NAME || 'SystemCleaner'
const sandboxCheck = process.argv.includes('--sandbox-check')
const appStore = sandboxCheck || process.argv.includes('--app-store')

/** Where releases live. The installed app reads its manifest from here. */
const UPDATE_REPOSITORY = 'stacksjs/system-cleaner'

/**
 * The version being built. `Info.plist` gets this from the same place, so the
 * manifest cannot claim a version the bundle does not report.
 */
const APP_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version as string
const RESOURCES = path.join(ROOT, 'app/Desktop/Resources')

if (process.platform !== 'darwin') {
  console.error('[desktop] SystemCleaner only builds on macOS')
  process.exit(1)
}

const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || '0.0.0'

// The build and CI use the exact runtime declared for Pantry, not whichever
// SDK or version happens to be newest in a developer's package cache.
const dependencies = Bun.YAML.parse(fs.readFileSync(path.join(ROOT, 'deps.yaml'), 'utf8')) as { dependencies: Record<string, string> }
const craftVersion = dependencies.dependencies['craft-native.org']
if (!/^\d+\.\d+\.\d+$/.test(craftVersion))
  throw new Error('deps.yaml must pin an exact Craft runtime version')
const craftBin = resolveCraftExecutable(process.env.CRAFT_BIN || path.join(ROOT, 'pantry/craft-native.org', `v${craftVersion}`, 'bin/craft'))
if (!fs.existsSync(craftBin))
  throw new Error(`Craft is missing at ${craftBin}; run pantry install first`)

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
  CRAFT_BIN: craftBin,
}

/**
 * `migrate:regenerate` adds the files it writes to git's index, ignore rule
 * or not, so every build left a few hundred migrations staged and the next
 * `git commit` swept them in unless someone remembered to unstage them first.
 * The directory is ignored and nothing in it is tracked, so any new entry
 * staged under it is the generator's and comes back out. A tarball checkout
 * with no git has nothing to undo.
 */
function unstageGeneratedMigrations(): void {
  // Listed from the index rather than `git diff --cached`: the generator adds
  // them intent-to-add (`git add -N`), which shows as ` A` in `git status` and
  // not at all in a cached diff.
  const git = (...args: string[]) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' })
  const indexed = git('ls-files', '--', 'database/migrations')
  const committed = git('ls-tree', '-r', '--name-only', 'HEAD', '--', 'database/migrations')
  if (indexed.status !== 0) return
  const known = new Set(committed.status === 0 ? committed.stdout.split('\n').filter(Boolean) : [])
  const files = indexed.stdout.split('\n').filter(file => file && !known.has(file))
  if (files.length === 0) return
  const removed = spawnSync('git', ['rm', '--cached', '--quiet', '--', ...files], { cwd: ROOT, stdio: 'inherit' })
  if (removed.status === 0)
    console.log(`[desktop] unstaged ${files.length} generated migration(s)`)
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

// Installer tools are macOS build dependencies, not runtime dependencies of
// the cross-platform project. Pantry installs the pinned tool without adding
// it to the root manifest that Linux and Windows environments also consume.
const installerDependencies = Bun.YAML.parse(fs.readFileSync(path.join(ROOT, 'resources/dmg/deps.yaml'), 'utf8')) as { dependencies: Record<string, string> }
// The Store edition is a .pkg; create-dmg has nothing to do there.
for (const [name, declaredVersion] of appStore ? [] : Object.entries(installerDependencies.dependencies))
  run('pantry', ['install', `${name}@${declaredVersion}`, '--no-save'])

const installerProvider = appStore ? null : spawnSync('pantry', ['which', '--resolve', path.join(ROOT, 'pantry/.bin/create-dmg')], { encoding: 'utf8' })
if (installerProvider && (installerProvider.status !== 0 || !installerProvider.stdout.trim()))
  throw new Error(`Pantry could not resolve create-dmg: ${installerProvider.stderr}`)
const installerBinary = installerProvider?.stdout.trim() ?? ''

// ── 1. Render the UI ────────────────────────────────────────────
// The STX page cache is keyed on the template, not on the environment that
// rendered it, so a cached page from a marketing build would ship the download
// prompt inside the app. A full render is ~3s; shipping the wrong payload is
// not worth saving it.
console.log('[desktop] building views')
for (const cache of ['.stx', 'storage/framework/stx', 'dist'])
  fs.rmSync(path.join(ROOT, cache), { recursive: true, force: true })

// The client scripts are bundled from `resources/scripts` into `public/`, and
// `build:views` copies `public/` into the render. They are generated output, so
// they are built here rather than tracked — a stale one shipping in the bundle
// is the kind of thing nobody looks for.
run('bun', [path.join(ROOT, 'scripts/build-client-scripts.ts')])

run('./buddy', ['build:views'])

const web = path.join(ROOT, 'dist')
if (!fs.existsSync(path.join(web, 'app/large-files.html')))
  throw new Error(`View build did not produce the app pages in ${web}`)

// Every page must come from this one render. The router reloads the whole
// window when the page it fetched carries a different build stamp from the
// one on screen, so a payload mixing two renders (an incremental build that
// redrew only the pages whose sources changed) turns every move between an
// old page and a new one into a full reload: blank flash, lost history,
// Back disabled. The caches are cleared above for this reason; this makes
// sure it held.
{
  const stamps = new Map<string, string[]>()
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.html')) {
        const stamp = /<meta name="stx-build" content="([^"]*)"/.exec(fs.readFileSync(full, 'utf8'))?.[1]
        if (stamp) stamps.set(stamp, [...(stamps.get(stamp) || []), path.relative(web, full)])
      }
    }
  }
  walk(web)
  if (stamps.size > 1)
    throw new Error(`View build mixes ${stamps.size} renders: ${[...stamps.entries()].map(([stamp, files]) => `${stamp} (${files.length} pages, e.g. ${files[0]})`).join('; ')}`)
}

// ── 2. Stage the payload ────────────────────────────────────────
// `buddy build:dmg` copies this directory into Contents/Resources. Both halves
// are build output — the rendered UI, and the migrations `buddy
// migrate:regenerate` derived from app/Models — so it is rebuilt each time
// rather than tracked.
console.log('[desktop] staging bundle resources')
fs.rmSync(RESOURCES, { recursive: true, force: true })
fs.mkdirSync(RESOURCES, { recursive: true })
const payload = await stageDesktopWeb(web, path.join(RESOURCES, 'web'))
console.log(`[desktop] web payload: ${payload.files} files, ${(payload.bytes / 1024 / 1024).toFixed(2)} MiB`)

// The comment above is only half true until this runs. Nothing under
// `database/` is tracked, so the migrations are build output in principle but
// were never actually built here — the copy just assumed a dev tree that had
// them lying around from an earlier `buddy migrate`. A fresh checkout has no
// such directory, which is why this step died with ENOENT the first time CI
// got far enough to reach it. `--force` because a machine that has already run
// its migrations would otherwise refuse, and a build must not depend on
// whether the local ledger happens to be empty.
run('./buddy', ['migrate:regenerate', '--force'])
unstageGeneratedMigrations()
fs.cpSync(path.join(ROOT, 'database/migrations'), path.join(RESOURCES, 'migrations'), { recursive: true })

// ── 3. Launcher, Craft runtime, manifest ────────────────────────
// Compiles app/Desktop/launcher.ts, since this app supplies one.
console.log('[desktop] building the desktop bundle')
run('./buddy', ['build:desktop'])

// ── 4. Shared executable ────────────────────────────────
// The agent and the scanner used to be two more compiled binaries alongside the
// launcher. They are subcommands of it now — `SystemCleaner agent`,
// `SystemCleaner scan <json>` — because `bun build --compile` embeds the whole
// Bun runtime in every output it writes, and a hello-world measures 60 MB. Three
// executables meant three copies of that runtime and a 230 MB bundle whose
// actual native component, the Craft runtime, is 13 MB of it.
//
// The two still run out-of-process, spawned exactly as before; only the file
// being executed changed. `app/Desktop/launcher.ts` dispatches on argv[2].

// ── 5. Bundle and image ─────────────────────────────────────────
console.log('[desktop] packaging')
// Stacks owns executable placement and inside-out signing. Packaging failures
// are fatal; do not recover an unknown staged bundle from a failed command.
run('./buddy', ['build:dmg'], {
  // The Store edition is re-signed below, so its Developer ID pass is skipped.
  DESKTOP_SIGNING_IDENTITY: appStore ? '-' : (process.env.DESKTOP_SIGNING_IDENTITY || '-'),
  DESKTOP_NOTARY_PROFILE: '',
})

const dmgDir = path.join(ROOT, 'storage/framework/desktop-dmg')
const dmgPath = path.join(dmgDir, `${APP_NAME}-${APP_VERSION}.dmg`)
if (!fs.existsSync(dmgPath))
  throw new Error(`build:dmg produced no disk image at ${dmgPath}`)

/** Pantry supplies create-dmg; it owns the background, icon placement and drop link. */
/**
 * The Mac App Store edition, from the bundle `build:dmg` just assembled.
 *
 * The App Sandbox is the difference. Craft's App Store runtime is the main
 * executable and gets `app/Desktop/AppStore.entitlements`; this app's binary
 * runs as its `craft-backend` (and starts the agent from the same file) with
 * `AppStoreHelper.entitlements`, which makes it inherit that sandbox. Signing
 * goes inside out, backend before app, and Pantry then checks the result and
 * writes the signed installer package.
 */
function finishAppStore(imagePath: string): void {
  const buildNumber = process.env.APP_STORE_BUILD_NUMBER || '1'
  if (!/^[1-9]\d*$/.test(buildNumber))
    throw new Error(`APP_STORE_BUILD_NUMBER must be a positive integer, not ${buildNumber}`)
  const bundleId = buildEnv.DESKTOP_BUNDLE_ID
  const identity = sandboxCheck ? '-' : process.env.APPLE_STORE_SIGNING_IDENTITY
  const installerIdentity = process.env.APPLE_STORE_INSTALLER_IDENTITY
  const profile = path.resolve(ROOT, process.env.APPLE_STORE_PROVISIONING_PROFILE || '.pantry/apple/mac-app-store.provisionprofile')
  if (!sandboxCheck && (!identity || !installerIdentity || !fs.existsSync(profile)))
    throw new Error('The App Store edition needs APPLE_STORE_SIGNING_IDENTITY, APPLE_STORE_INSTALLER_IDENTITY and a provisioning profile (run `ts-pantry app-store:provision --apply`)')

  const outDir = path.join(ROOT, 'storage/framework/app-store')
  fs.rmSync(outDir, { recursive: true, force: true })
  fs.mkdirSync(outDir, { recursive: true })
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'system-cleaner-app-store-'))
  const mount = path.join(work, 'mounted')
  fs.mkdirSync(mount)
  const app = path.join(outDir, `${APP_NAME}.app`)
  try {
    run('hdiutil', ['attach', imagePath, '-nobrowse', '-readonly', '-mountpoint', mount])
    try { run('ditto', [path.join(mount, `${APP_NAME}.app`), app]) }
    finally { spawnSync('hdiutil', ['detach', mount], { stdio: 'inherit' }) }

    // Craft's App Store runtime becomes the main executable, because the
    // sandbox lets only the app itself put up a window; this app's binary
    // moves to `craft-backend`, which Craft starts inside the sandbox (see
    // `craftBackend` in app/Desktop/launcher.ts). The direct build's runtime
    // calls private APIs App Review refuses, so it leaves the bundle, and the
    // public one must say it is the App Store build before it goes in.
    const macOS = path.join(app, 'Contents/MacOS')
    // `CRAFT_APP_STORE_RUNTIME` points at a Craft build ahead of the pinned
    // release, the way `CRAFT_BIN` does for the direct one.
    const storeRuntime = process.env.CRAFT_APP_STORE_RUNTIME
      ? path.resolve(process.env.CRAFT_APP_STORE_RUNTIME)
      : path.join(path.dirname(craftBin), 'craft-app-store')
    const probe = spawnSync(storeRuntime, ['--distribution'], { encoding: 'utf8', timeout: 10_000 })
    if (probe.status !== 0 || probe.stdout.trim() !== 'app-store')
      throw new Error(`${storeRuntime} is not Craft's App Store runtime; run pantry install`)
    fs.renameSync(path.join(macOS, APP_NAME), path.join(macOS, 'craft-backend'))
    fs.rmSync(path.join(macOS, 'craft-runtime'), { force: true })
    fs.copyFileSync(storeRuntime, path.join(macOS, APP_NAME))
    fs.chmodSync(path.join(macOS, APP_NAME), 0o755)
    fs.writeFileSync(path.join(app, 'Contents/Resources/craft.json'), `${JSON.stringify({
      title: APP_NAME,
      appName: APP_NAME,
      width: 1400,
      height: 900,
      titlebarHidden: true,
      backend: { executable: 'craft-backend' },
    }, null, 2)}\n`)

    // The Store reads the version pair from the bundle and refuses a build
    // number it has seen. HTTPS through the system is the only encryption the
    // app uses, which is exempt, so the export question is answered here.
    const plist = path.join(app, 'Contents/Info.plist')
    run('plutil', ['-replace', 'CFBundleShortVersionString', '-string', APP_VERSION, plist])
    run('plutil', ['-replace', 'CFBundleVersion', '-string', buildNumber, plist])
    run('plutil', ['-replace', 'ITSAppUsesNonExemptEncryption', '-bool', 'NO', plist])

    let applicationIdentifier = ''
    let teamIdentifier = ''
    if (!sandboxCheck) {
      const decoded = spawnSync('security', ['cms', '-D', '-i', profile], { encoding: 'utf8' })
      if (decoded.status !== 0)
        throw new Error(`Could not read the provisioning profile ${profile}`)
      const profilePlist = path.join(work, 'profile.plist')
      fs.writeFileSync(profilePlist, decoded.stdout)
      // Read key by key: the profile holds dates and certificate data, which
      // have no JSON form, so a whole-file conversion fails.
      const entitlement = (key: string): string => spawnSync('plutil', ['-extract', `Entitlements.${key.replaceAll('.', '\\.')}`, 'raw', '-o', '-', profilePlist], { encoding: 'utf8' }).stdout.trim()
      applicationIdentifier = entitlement('com.apple.application-identifier')
      teamIdentifier = entitlement('com.apple.developer.team-identifier')
      if (applicationIdentifier !== `${teamIdentifier}.${bundleId}`)
        throw new Error(`The provisioning profile is for ${applicationIdentifier}, not ${teamIdentifier}.${bundleId}`)
      // Pantry writes the profile owner-only; inside the app everyone must
      // be able to read it, or the Store rejects the package (90255).
      fs.copyFileSync(profile, path.join(app, 'Contents/embedded.provisionprofile'))
      fs.chmodSync(path.join(app, 'Contents/embedded.provisionprofile'), 0o644)
    }

    // An ad hoc signature cannot carry the profile-backed identifiers, and a
    // local sandbox check does not need them.
    const template = fs.readFileSync(path.join(ROOT, 'app/Desktop/AppStore.entitlements'), 'utf8')
    const mainEntitlements = path.join(work, 'app.entitlements')
    fs.writeFileSync(mainEntitlements, sandboxCheck
      ? template.replace(/\s*<key>com\.apple\.application-identifier<\/key>\s*<string>[^<]*<\/string>/, '').replace(/\s*<key>com\.apple\.developer\.team-identifier<\/key>\s*<string>[^<]*<\/string>/, '')
      : template.replace('$(APPLICATION_IDENTIFIER)', applicationIdentifier).replace('$(TEAM_IDENTIFIER)', teamIdentifier))

    const helper = path.join(macOS, 'craft-backend')
    run('codesign', ['--force', '--sign', identity!, '--entitlements', path.join(ROOT, 'app/Desktop/AppStoreHelper.entitlements'), helper])
    run('codesign', ['--force', '--sign', identity!, '--entitlements', mainEntitlements, app])
    run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app])

    if (sandboxCheck) {
      console.log(`[desktop] sandboxed build for local checks: ${app}`)
      return
    }

    const pkg = path.join(outDir, `${APP_NAME}-${APP_VERSION}-${buildNumber}.pkg`)
    const pantry = process.env.TS_PANTRY_CLI ? ['bun', process.env.TS_PANTRY_CLI] : ['bunx', '--bun', 'ts-pantry']
    run(pantry[0]!, [...pantry.slice(1), 'app-store:package', app, '--output', pkg, '--installer-identity', installerIdentity!])
    console.log(`[desktop] ${pkg}`)
  }
  finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
}

function finishInstaller(imagePath: string): void {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'system-cleaner-installer-'))
  const mount = path.join(work, 'mounted')
  const source = path.join(work, 'source')
  const output = path.join(work, `${APP_NAME}-${APP_VERSION}.dmg`)
  const bundle = path.join(source, `${APP_NAME}.app`)
  fs.mkdirSync(mount)
  fs.mkdirSync(source)
  let mounted = false
  try {
    run('hdiutil', ['attach', imagePath, '-nobrowse', '-readonly', '-mountpoint', mount])
    mounted = true
    run('ditto', [path.join(mount, `${APP_NAME}.app`), bundle])
    run('hdiutil', ['detach', mount])
    mounted = false

    const macos = path.join(bundle, 'Contents/MacOS')
    const runtimes = fs.readdirSync(macos).filter(name => looksLikeBunExecutable(path.join(macos, name)))
    if (runtimes.length !== 1)
      throw new Error(`Expected one Bun runtime, found ${runtimes.length}: ${runtimes.join(', ')}`)
    run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', bundle])

    // create-dmg lays the window out by scripting Finder, and Finder now and
    // then drops the background setting (the layout reads back with
    // backgroundType 0) on a build that is otherwise fine. The same inputs
    // pass on a second run, so one retry is the difference between a release
    // and a person rerunning a ten-minute build by hand. A second failure is
    // real and stops the build.
    const ATTEMPTS = 2
    for (let attempt = 1; ; attempt++) {
      try {
        const app = DMG_WINDOW.items['SystemCleaner.app']
        const applications = DMG_WINDOW.items.Applications
        // Pantry resolves script packages to their provider so relative support
        // resources are found regardless of how the activation entrypoint is made.
        run(installerBinary, [
          '--volname', `${APP_NAME} ${APP_VERSION}`,
          '--volicon', path.join(bundle, 'Contents/Resources/AppIcon.icns'),
          '--background', path.join(ROOT, 'resources/dmg/installer-background.png'),
          '--window-pos', '200', '120',
          '--window-size', String(DMG_WINDOW.width), String(DMG_WINDOW.height),
          '--icon-size', String(DMG_WINDOW.iconSize),
          '--text-size', '13',
          '--icon', `${APP_NAME}.app`, String(app.x), String(app.y),
          '--hide-extension', `${APP_NAME}.app`,
          '--app-drop-link', String(applications.x), String(applications.y),
          '--format', 'ULMO',
          '--filesystem', 'HFS+',
          ...(process.env.DESKTOP_SIGNING_IDENTITY ? ['--codesign', process.env.DESKTOP_SIGNING_IDENTITY] : []),
          ...(process.env.NOTARY_PROFILE ? ['--notarize', process.env.NOTARY_PROFILE] : []),
          output, source,
        ])

        // Validate the shipped image, not an intermediate directory. A release
        // without artwork or a usable drop target is a failed installer build.
        run('hdiutil', ['verify', output])
        run('hdiutil', ['attach', output, '-nobrowse', '-readonly', '-mountpoint', mount])
        mounted = true
        const layout = readDmgWindowLayout(new Uint8Array(fs.readFileSync(path.join(mount, '.DS_Store'))))
        if (layout.backgroundType !== 2 || layout.width !== DMG_WINDOW.width || layout.height !== DMG_WINDOW.height || layout.iconSize !== DMG_WINDOW.iconSize)
          throw new Error(`Installer layout does not match the design: ${JSON.stringify(layout)}`)
        for (const [name, position] of Object.entries(DMG_WINDOW.items)) {
          if (layout.items[name]?.x !== position.x || layout.items[name]?.y !== position.y)
            throw new Error(`Installer icon ${name} is misplaced`)
        }
        if (fs.readlinkSync(path.join(mount, 'Applications')) !== '/Applications')
          throw new Error('Installer has no Applications drop target')
        break
      }
      catch (err) {
        if (mounted) {
          spawnSync('hdiutil', ['detach', mount], { stdio: 'inherit' })
          mounted = false
        }
        fs.rmSync(output, { force: true })
        if (attempt >= ATTEMPTS) throw err
        console.warn(`[desktop] installer image attempt ${attempt} failed (${err instanceof Error ? err.message : String(err)}); building it again`)
      }
    }
    const shippedBundle = path.join(mount, `${APP_NAME}.app`)
    run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', shippedBundle])
    if (process.env.NOTARY_PROFILE) {
      run('xcrun', ['stapler', 'validate', output])
      run('spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=2', output])
      run('spctl', ['--assess', '--type', 'execute', '--verbose=2', shippedBundle])
    }
    // Preserve the exact bundled app for local launch and UI verification.
    run('ditto', [shippedBundle, path.join(ROOT, 'storage/framework/desktop-dist', `${APP_NAME}.app`)])
    run('hdiutil', ['detach', mount])
    mounted = false

    const compression: { format: string, bytes: number }[] = [{ format: 'ULMO', bytes: fs.statSync(output).size }]
    if (process.env.DMG_BENCHMARK === '1') {
      for (const format of ['UDZO', 'ULFO']) {
        const alternative = path.join(work, `${format}.dmg`)
        run('hdiutil', ['convert', output, '-format', format,
          ...(format === 'UDZO' ? ['-imagekey', 'zlib-level=9'] : []), '-ov', '-o', alternative])
        compression.push({ format, bytes: fs.statSync(alternative).size })
      }
    }
    for (const result of compression)
      console.log(`[desktop] ${result.format}: ${(result.bytes / 1024 / 1024).toFixed(2)} MiB`)
    fs.writeFileSync(path.join(dmgDir, 'size-report.json'), `${JSON.stringify({ web: payload, runtimes, compression }, null, 2)}\n`)
    fs.renameSync(output, imagePath)
  }
  finally {
    if (mounted)
      spawnSync('hdiutil', ['detach', mount], { stdio: 'inherit' })
    fs.rmSync(work, { recursive: true, force: true })
  }
}

if (appStore) {
  finishAppStore(dmgPath)
  process.exit(0)
}

finishInstaller(dmgPath)

// ── 6. Update manifest ──────────────────────────────────────────
/**
 * `update.json`, next to the DMG.
 *
 * The installed app fetches this from
 * `releases/latest/download/update.json` to learn whether it is behind, so it
 * has to be attached to the same release as the DMG it points at — and it has
 * to be written *after* notarization, because stapling the ticket changes the
 * file and therefore its SHA-256. Generating it earlier produced a manifest
 * whose hash no downloaded DMG could ever match.
 */
const manifest = createGitHubUpdateManifest({
  repository: UPDATE_REPOSITORY,
  version: APP_VERSION,
  artifacts: { darwin: dmgPath },
})

const manifestPath = path.join(dmgDir, UPDATE_MANIFEST_ASSET)
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`[desktop] ${manifestPath}`)

if (!process.env.DESKTOP_SIGNING_IDENTITY)
  console.warn('[desktop] DESKTOP_SIGNING_IDENTITY is unset — the bundle is sealed ad hoc, so it runs on this Mac and is refused on every other')
else if (!process.env.NOTARY_PROFILE)
  console.warn('[desktop] NOTARY_PROFILE is unset — the DMG is signed but not notarized')

// A self-update the running app cannot verify is one it will refuse to
// install, so an unsigned build is not merely undistributable — the manifest
// beside it describes an update nobody can take.
if (!process.env.NOTARY_PROFILE)
  console.warn(`[desktop] ${UPDATE_MANIFEST_ASSET} describes an un-notarized DMG; installed copies will refuse it`)

console.log(`[desktop] ${dmgPath}`)
