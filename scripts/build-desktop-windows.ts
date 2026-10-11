#!/usr/bin/env bun
/* eslint-disable ts/no-top-level-await, no-console */
/**
 * Assemble the Windows desktop bundle.
 *
 * A separate script rather than a branch in `build-desktop-app.ts`, because
 * that one delegates the two steps that matter to `buddy build:desktop` and
 * `buddy build:dmg` — which produce a `.app` and a disk image. Neither has a
 * Windows equivalent to reuse, and the parts that *are* shared (the client
 * scripts, the rendered views, the migrations) are three `run()` calls.
 *
 * What comes out is a directory, zipped:
 *
 *     SystemCleaner/
 *       SystemCleaner.exe        the launcher, with the agent and scanner in it
 *       craft-runtime.exe        the webview host
 *       WebView2Loader.dll       which it needs beside it
 *       resources/web/           the prerendered UI
 *       resources/migrations/
 *
 * `app/Desktop/bundle.ts` is where the launcher learns that layout, and its
 * tests pin it — so this script and the thing that reads it cannot drift
 * without a test failing.
 *
 * Two things this is not, both deliberate:
 *
 * **Not an installer.** The craft-native SDK can drive WiX, but `candle.exe`
 * and `light.exe` have to be on the build machine, and a zip that extracts to
 * a working app is worth more than a half-configured MSI.
 *
 * **Not signed.** There is no Authenticode certificate for this project, so
 * SmartScreen will warn on first run. Signing is a credential problem rather
 * than a build problem, and the release notes say so rather than the user
 * finding out.
 *
 * See stacksjs/system-cleaner#23.
 */

import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()
const APP_NAME = process.env.DESKTOP_APP_NAME || 'SystemCleaner'
const APP_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version as string

const OUT_DIR = path.join(ROOT, 'storage/framework/desktop-windows')
const STAGE = path.join(OUT_DIR, APP_NAME)

function run(command: string, args: string[], options: { cwd?: string, env?: Record<string, string> } = {}): void {
  const proc = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...options.env },
  })
  // `status` is null when the process could not be spawned at all, which
  // reads as "exited with undefined" if it is interpolated blindly — the shape
  // of the error that made a missing `zip` on windows-latest so confusing.
  if (proc.status !== 0)
    throw new Error(`${command} ${args.join(' ')} ${proc.status === null ? 'could not be spawned' : `exited ${proc.status}`}`)
}

/**
 * The oldest Craft release whose Windows archive is complete.
 *
 * `craft.exe` reaches WebView2 through `WebView2Loader.dll` and the archive is
 * expected to carry it. The v0.0.90 Windows asset — the version pantry
 * resolves for this project, and the one the macOS bundle ships — contains
 * only `craft.exe`, so a bundle built from it would install cleanly and never
 * open a window. Every release from v0.0.100 on ships both.
 */
const MIN_WINDOWS_CRAFT = 100

/** `v0.0.90` → 90. Craft has not left 0.0.x, so the patch is the version. */
function patchOf(version: string): number {
  return Number.parseInt(version.replace(/^v0\.0\./, ''), 10) || 0
}

/**
 * The Craft runtime version this bundle ships.
 *
 * From `deps.yaml`, which is tracked and therefore present wherever the build
 * runs. The first version of this read the installed `pantry/craft-native.org`
 * directory instead, to match whatever the macOS build resolves — and a
 * Windows runner has no pantry at all, so it failed having already compiled
 * the launcher:
 *
 *     error: no Craft runtime in D:\\a\\...\\pantry\\craft-native.org
 *
 * The declared dependency is the better answer anyway: it is the version this
 * project asks for, rather than the one a particular machine happens to have
 * unpacked.
 *
 * Raised to the floor when the declared version predates a complete Windows
 * archive. The check further down is what actually enforces completeness; the
 * floor only avoids a download that is known to be useless.
 */
function craftVersion(): string {
  const depsFile = path.join(ROOT, 'deps.yaml')
  const declared = fs.readFileSync(depsFile, 'utf8').match(/craft-native\.org:\s*[\^~]?([\d.]+)/)

  if (!declared)
    throw new Error(`no craft-native.org dependency in ${depsFile}`)

  const version = `v${declared[1]}`
  if (patchOf(version) >= MIN_WINDOWS_CRAFT)
    return version

  const floor = `v0.0.${MIN_WINDOWS_CRAFT}`
  console.warn(`[windows] ${version} is declared, but its Windows archive ships no WebView2 loader; using ${floor}`)
  return floor
}

/** Extract a zip, with whatever the build machine has. */
function unzip(archive: string, into: string): void {
  fs.mkdirSync(into, { recursive: true })
  if (process.platform === 'win32') {
    run('powershell', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
      `Expand-Archive -Path '${archive}' -DestinationPath '${into}' -Force`,
    ])
    return
  }
  run('unzip', ['-o', '-q', archive, '-d', into])
}

/** Archive a directory, preserving it as the top-level folder. */
function zipDir(dir: string, archive: string): void {
  fs.rmSync(archive, { force: true })
  if (process.platform === 'win32') {
    run('powershell', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
      `Compress-Archive -Path '${dir}' -DestinationPath '${archive}' -Force`,
    ])
    return
  }
  // Run from the staging parent and name the directory, so the archive
  // carries `SystemCleaner/...` rather than scattering the bundle into
  // whatever folder it is opened in. The path to the archive is resolved
  // because the working directory is no longer the repository root.
  run('zip', ['-r', '-q', path.resolve(archive), path.basename(dir)], { cwd: path.dirname(dir) })
}

/**
 * A multi-size Windows icon, assembled from the PNGs the site already ships.
 *
 * ICO entries may hold a PNG verbatim, which is how the existing favicon is
 * built, so this needs no image library and no resizer — and therefore works
 * on whichever platform runs the build. Sizes above 255 cannot be expressed in
 * the directory entry (the byte is 0 for exactly 256), so 384 and 512 are
 * left out.
 *
 * Returns null when the sources are missing, and the caller ships without an
 * icon rather than failing the build over one.
 */
function buildIco(destination: string): string | null {
  const sizes = [16, 32, 48, 96, 192]
  const images: { size: number, png: Buffer }[] = []

  for (const size of sizes) {
    const file = path.join(ROOT, 'public', `favicon-${size}x${size}.png`)
    if (fs.existsSync(file))
      images.push({ size, png: fs.readFileSync(file) })
  }

  if (images.length === 0)
    return null

  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // 1 = icon
  header.writeUInt16LE(images.length, 4)

  const directory = Buffer.alloc(16 * images.length)
  let offset = header.length + directory.length

  images.forEach((image, index) => {
    const at = index * 16
    directory.writeUInt8(image.size === 256 ? 0 : image.size, at + 0)
    directory.writeUInt8(image.size === 256 ? 0 : image.size, at + 1)
    directory.writeUInt8(0, at + 2) // palette size, 0 for truecolor
    directory.writeUInt8(0, at + 3) // reserved
    directory.writeUInt16LE(1, at + 4) // colour planes
    directory.writeUInt16LE(32, at + 6) // bits per pixel
    directory.writeUInt32LE(image.png.length, at + 8)
    directory.writeUInt32LE(offset, at + 12)
    offset += image.png.length
  })

  fs.writeFileSync(destination, Buffer.concat([header, directory, ...images.map(i => i.png)]))
  return destination
}

// ── 1. Shared build output ──────────────────────────────────────
/**
 * Whether to produce the shared build output, or trust that it is there.
 *
 * `./buddy` is a POSIX shell script, and `spawnSync` cannot execute one on
 * Windows — it tries to exec the file, Windows has no shebang handling, and
 * the spawn fails before any argument is read:
 *
 *     error: ./buddy build:views could not be spawned
 *
 * Running it through `sh` instead would mean depending on Git Bash being
 * reachable from a child process, which is the same assumption that makes
 * `exec()` work on CI and fail for users. So on Windows the CI job runs those
 * steps itself, in the bash shell it already has, and this script is told to
 * skip them.
 *
 * Nothing is trusted silently: the outputs are checked below either way.
 */
const PREPARE = !process.argv.includes('--skip-prepare')

console.log(`[windows] building ${APP_NAME} ${APP_VERSION}`)

if (PREPARE) {
  run('bun', [path.join(ROOT, 'scripts/build-client-scripts.ts')])
  run('./buddy', ['build:views'])
  // `--force` because a machine that has already run its migrations would
  // otherwise refuse, and a build must not depend on whether the local ledger
  // happens to be empty.
  run('./buddy', ['migrate:regenerate', '--force'])
}
else {
  console.log('[windows] --skip-prepare: using the shared build output already on disk')
}

const web = path.join(ROOT, 'dist')
if (!fs.existsSync(path.join(web, 'app/large-files.html')))
  throw new Error(`no rendered app pages in ${web} - run \`./buddy build:views\` first, or drop --skip-prepare`)

const migrations = path.join(ROOT, 'database/migrations')
if (!fs.existsSync(migrations) || fs.readdirSync(migrations).length === 0)
  throw new Error(`no migrations in ${migrations} - run \`./buddy migrate:regenerate --force\` first, or drop --skip-prepare`)

// ── 2. Stage ────────────────────────────────────────────────────
fs.rmSync(STAGE, { recursive: true, force: true })
fs.mkdirSync(STAGE, { recursive: true })

const resources = path.join(STAGE, 'resources')
fs.cpSync(web, path.join(resources, 'web'), { recursive: true })
fs.cpSync(migrations, path.join(resources, 'migrations'), { recursive: true })

// ── 3. The launcher ─────────────────────────────────────────────
/**
 * The icon and the version-info resource need a Windows build host.
 *
 * `--windows-hide-console` is only a bit in the PE header, so Bun sets it from
 * anywhere. Everything else here writes a Win32 resource — the icon, and the
 * block Windows shows in file properties and the installed-programs list,
 * which is this platform's Info.plist — and that needs the resource compiler:
 *
 *     error: Using --windows-icon is only available when compiling on Windows
 *
 * So a cross-build produces a bundle that runs and looks anonymous, which is
 * right for local iteration and not for a release. The CI job that builds the
 * shipping bundle runs on windows-latest for exactly this reason.
 */
const ON_WINDOWS = process.platform === 'win32'

const icon = ON_WINDOWS ? buildIco(path.join(OUT_DIR, `${APP_NAME}.ico`)) : null
if (ON_WINDOWS && !icon)
  console.warn('[windows] no favicon PNGs found; shipping without an icon')

const branding = ON_WINDOWS
  ? [
      ...(icon ? [`--windows-icon=${icon}`] : []),
      `--windows-title=${APP_NAME}`,
      '--windows-publisher=Stacks',
      `--windows-version=${APP_VERSION}.0`,
      '--windows-description=Reclaim disk space and keep your machine tidy',
      `--windows-copyright=(c) ${new Date().getFullYear()} Stacks`,
    ]
  : []

if (!ON_WINDOWS)
  console.warn(`[windows] cross-building from ${process.platform}: no icon and no version metadata. Build on Windows for a release bundle.`)

console.log('[windows] compiling the launcher')
run('bun', [
  'build',
  path.join(ROOT, 'app/Desktop/launcher.ts'),
  '--compile',
  '--target=bun-windows-x64',
  // Without this, launching the app opens a command prompt beside the window:
  // a compiled Bun binary is a console subsystem executable.
  '--windows-hide-console',
  ...branding,
  '--outfile',
  path.join(STAGE, `${APP_NAME}.exe`),
])

// ── 4. The Craft runtime ────────────────────────────────────────
const version = craftVersion()
const url = `https://github.com/craft-native/craft/releases/download/${version}/craft-windows-x64.zip`

console.log(`[windows] fetching the Craft runtime ${version}`)
const download = path.join(os.tmpdir(), `craft-windows-${version}.zip`)
if (!fs.existsSync(download)) {
  const response = await fetch(url)
  if (!response.ok)
    throw new Error(`could not download ${url}: HTTP ${response.status}`)
  fs.writeFileSync(download, Buffer.from(await response.arrayBuffer()))
}

const extracted = path.join(os.tmpdir(), `craft-windows-${version}-extracted`)
fs.rmSync(extracted, { recursive: true, force: true })
unzip(download, extracted)

const shipped = fs.readdirSync(extracted)

const craftExe = path.join(extracted, 'craft.exe')
if (!fs.existsSync(craftExe))
  throw new Error(`the Craft archive did not contain craft.exe: ${shipped.join(', ')}`)

// Craft hosts the window in Edge WebView2 and reaches it through this loader.
// Checked rather than assumed, because the v0.0.90 archive does not have it
// and a bundle missing it installs cleanly and never opens a window.
if (!shipped.includes('WebView2Loader.dll'))
  throw new Error(`the Craft ${version} archive ships no WebView2Loader.dll (only ${shipped.join(', ')}), so the window would never open`)

// Everything the archive holds, not a list maintained here: the runtime
// decides what it needs beside it, and a future release adding another DLL
// should not need this script edited to keep working.
for (const name of shipped) {
  // `craft-runtime.exe` is what `bundleLayout` looks for, and what the macOS
  // bundle calls the same file.
  const target = name === 'craft.exe' ? 'craft-runtime.exe' : name
  fs.copyFileSync(path.join(extracted, name), path.join(STAGE, target))
}

// ── 5. Check the bundle is complete, then archive it ────────────
// Asserted against the layout the launcher itself reads, rather than against a
// second list written here that could disagree with it.
//
// Asked for the Windows layout it answers in Windows paths, which is correct
// and not what this filesystem uses when the build is cross-compiled. So the
// layout is taken relative to a synthetic root and re-joined with the host's
// separator: the structure still comes from one place, and the check still
// looks where the files actually are.
const { bundleLayout } = await import('../app/Desktop/bundle')

const SYNTHETIC_ROOT = 'C:\\stage'
const layout = bundleLayout(`${SYNTHETIC_ROOT}\\${APP_NAME}.exe`, 'win32')

function staged(windowsPath: string): string {
  const relative = windowsPath.slice(SYNTHETIC_ROOT.length + 1).split('\\')
  return path.join(STAGE, ...relative)
}

for (const [label, target] of [
  ['launcher', path.join(STAGE, `${APP_NAME}.exe`)],
  ['Craft runtime', staged(layout.craftBinary)],
  ['WebView2 loader', path.join(STAGE, 'WebView2Loader.dll')],
  ['web payload', staged(layout.webRoot)],
  ['migrations', staged(layout.migrationsDir)],
] as const) {
  if (!fs.existsSync(target))
    throw new Error(`${label} missing from the staged bundle: ${target}`)
}

const archive = path.join(OUT_DIR, `${APP_NAME}-${APP_VERSION}-windows-x64.zip`)
console.log('[windows] packaging')
zipDir(STAGE, archive)

const { size } = fs.statSync(archive)
console.log(`[windows] ${path.relative(ROOT, archive)} (${(size / 1e6).toFixed(1)} MB)`)
