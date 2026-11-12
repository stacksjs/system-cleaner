#!/usr/bin/env bun
/* eslint-disable ts/no-top-level-await, no-console */
/**
 * Build the local-agent UI and package it for macOS.
 * Stacks compiles the single executable and assembles/signs the application.
 * Pantry's create-dmg owns the drag-and-drop installer and notarization.
 * NOTARY_PROFILE names the keychain credentials; DESKTOP_SIGNING_IDENTITY
 * accepts a Developer ID name or fingerprint (use the latter for duplicates).
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
for (const [name, declaredVersion] of Object.entries(installerDependencies.dependencies))
  run('pantry', ['install', `${name}@${declaredVersion}`, '--no-save'])

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
  DESKTOP_SIGNING_IDENTITY: process.env.DESKTOP_SIGNING_IDENTITY || '-',
  DESKTOP_NOTARY_PROFILE: '',
})

const dmgDir = path.join(ROOT, 'storage/framework/desktop-dmg')
const dmgPath = path.join(dmgDir, `${APP_NAME}-${APP_VERSION}.dmg`)
if (!fs.existsSync(dmgPath))
  throw new Error(`build:dmg produced no disk image at ${dmgPath}`)

/** Pantry supplies create-dmg; it owns the background, icon placement and drop link. */
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

    const app = DMG_WINDOW.items['SystemCleaner.app']
    const applications = DMG_WINDOW.items.Applications
    // Script packages locate support files relative to their executable.
    // Canonicalize Pantry's entrypoint before executing it.
    run(fs.realpathSync(path.join(ROOT, 'pantry/.bin/create-dmg')), [
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
