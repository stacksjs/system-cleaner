import { spawnSync } from 'node:child_process'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { listApplicationEntries } from './apps'
import { parsePlistToObject } from './plist'

/**
 * Rendered app icons, cached between launches.
 *
 * Not inside the app bundle: a `.app` in `/Applications` is not writable, and
 * is replaced wholesale on update. `~/Library/Caches` is both writable and the
 * directory macOS expects to be able to purge.
 */
const CACHE_DIR = path.join(os.homedir(), 'Library/Caches/SystemCleaner/icons')

/** Sizes the UI asks for. Anything else is refused rather than rendered. */
export const ICON_SIZES = [32, 64, 128] as const
export type IconSize = typeof ICON_SIZES[number]

/**
 * Locate the `.icns` inside an app bundle.
 *
 * `CFBundleIconFile` is the declared answer, but it is optional, sometimes
 * carries the `.icns` extension and sometimes does not, and modern bundles may
 * name a `CFBundleIconName` that lives compiled inside `Assets.car` instead —
 * unreadable without Apple's private asset tooling. Falling back to the only
 * `.icns` in `Resources/` handles those, which in practice is most of them.
 */
export function resolveAppIconFile(appPath: string): string | null {
  const resources = path.join(appPath, 'Contents/Resources')

  let declared: string | null = null
  try {
    const info = parsePlistToObject(path.join(appPath, 'Contents/Info.plist'))
    const value = info.CFBundleIconFile
    if (typeof value === 'string' && value) declared = value
  }
  catch {
    // An unreadable Info.plist is not fatal; the directory scan below still works.
  }

  if (declared) {
    const named = declared.endsWith('.icns') ? declared : `${declared}.icns`
    // basename() so a plist claiming `../../../etc/passwd` cannot escape.
    const candidate = path.join(resources, path.basename(named))
    if (fs.existsSync(candidate)) return candidate
  }

  try {
    const icns = fs.readdirSync(resources).filter(name => name.toLowerCase().endsWith('.icns'))
    if (icns.length === 0) return null
    // Prefer something that looks like the app icon over a document-type icon.
    const preferred = icns.find(name => /appicon|^icon\b/i.test(name)) ?? icns[0]
    return path.join(resources, preferred)
  }
  catch {
    return null
  }
}

function cachePathFor(appPath: string, size: IconSize): string {
  // Keyed on the bundle's path and mtime, so an app that updates its icon gets
  // a new file rather than serving the old one until someone clears the cache.
  let stamp = ''
  try {
    stamp = String(fs.statSync(appPath).mtimeMs)
  }
  catch {
    // A vanished bundle just gets a stable key; the render below will fail and
    // the caller falls back to a glyph.
  }
  const key = crypto.createHash('sha256').update(`${appPath}\0${stamp}\0${size}`).digest('hex').slice(0, 32)
  return path.join(CACHE_DIR, `${key}.png`)
}

/**
 * Render an app's icon to a PNG and return the file path, or null when the
 * bundle has no icon this can read.
 *
 * `sips` is Apple's own converter and ships with macOS, so there is no image
 * library to bundle. It is invoked argv-style — no shell — because the path
 * comes from a directory listing and may contain anything a filename may.
 */
export function renderAppIcon(appPath: string, size: IconSize = 64): string | null {
  const cached = cachePathFor(appPath, size)
  if (fs.existsSync(cached)) return cached

  const icns = resolveAppIconFile(appPath)
  if (!icns) return null

  fs.mkdirSync(CACHE_DIR, { recursive: true })

  // Render to a temp name and rename into place, so a killed process cannot
  // leave a half-written PNG that every later request then serves from cache.
  const staging = `${cached}.${process.pid}.tmp`
  const result = spawnSync('sips', ['-s', 'format', 'png', '-Z', String(size), icns, '--out', staging], {
    stdio: 'ignore',
    timeout: 10_000,
  })

  if (result.status !== 0 || !fs.existsSync(staging)) {
    try { fs.rmSync(staging, { force: true }) }
    catch {}
    return null
  }

  try {
    fs.renameSync(staging, cached)
  }
  catch {
    try { fs.rmSync(staging, { force: true }) }
    catch {}
    return null
  }

  return cached
}

/**
 * Bundle paths by lower-cased display name.
 *
 * Cached because a table of a hundred apps asks for a hundred icons, and
 * without this each one re-read both Applications directories to answer.
 */
let bundleIndex: { at: number, byName: Map<string, string> } | null = null
const BUNDLE_INDEX_TTL_MS = 60_000

function applicationIndex(): Map<string, string> {
  if (bundleIndex && Date.now() - bundleIndex.at < BUNDLE_INDEX_TTL_MS)
    return bundleIndex.byName

  const byName = new Map<string, string>()
  for (const entry of listApplicationEntries()) {
    // First writer wins, matching listApplicationEntries' own dedupe order.
    if (!byName.has(entry.name.toLowerCase()))
      byName.set(entry.name.toLowerCase(), entry.appPath)
  }

  bundleIndex = { at: Date.now(), byName }
  return byName
}

/**
 * Find an installed `.app` by display name.
 *
 * Matched case-insensitively: Homebrew cask tokens and `softwareupdate` labels
 * do not agree with each other on capitalisation, and neither reliably agrees
 * with the bundle on disk.
 */
export function findAppBundle(name: string): string | null {
  return applicationIndex().get(name.toLowerCase()) ?? null
}

/**
 * Cask tokens whose bundle name is not simply the token with the hyphens
 * turned back into spaces. Only the ones that actually differ — the general
 * rule below handles the rest.
 */
const CASK_BUNDLE_NAMES: Record<string, string> = {
  'visual-studio-code': 'Visual Studio Code',
  'google-chrome': 'Google Chrome',
  'firefox': 'Firefox',
  'iterm2': 'iTerm',
  'docker': 'Docker',
  'orbstack': 'OrbStack',
  'jetbrains-toolbox': 'JetBrains Toolbox',
  'microsoft-edge': 'Microsoft Edge',
  'chatgpt': 'ChatGPT',
  'claude': 'Claude',
  'zoom': 'zoom.us',
  'vlc': 'VLC',
  'obs': 'OBS',
  'sublime-text': 'Sublime Text',
  'android-studio': 'Android Studio',
  'raycast': 'Raycast',
  'rectangle': 'Rectangle',
  'alfred': 'Alfred 5',
  'the-unarchiver': 'The Unarchiver',
  'libreoffice': 'LibreOffice',
}

/** Best guess at the bundle name a Homebrew cask token installs. */
export function bundleNameForCask(token: string): string {
  const known = CASK_BUNDLE_NAMES[token.toLowerCase()]
  if (known) return known

  return token
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

/** Locate the bundle a cask token installed, by token or by derived name. */
export function findAppBundleForCask(token: string): string | null {
  return findAppBundle(bundleNameForCask(token)) ?? findAppBundle(token)
}
