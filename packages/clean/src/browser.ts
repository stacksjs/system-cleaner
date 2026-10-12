import * as path from 'node:path'
import process from 'node:process'
import { HOME, isWindows as IS_WINDOWS, pathExists, safeReadDir, safeReadFile } from '@system-cleaner/core'
import type { BrowserProfile } from './types'

/**
 * Detect all installed browser profiles and their cleanable paths
 */
/**
 * The cleanable paths of one Chromium profile.
 *
 * Every Chromium browser keeps the same set, so the shape is defined once
 * rather than repeated per browser. It was repeated five times, which is what
 * made adding Windows a matter of pasting it five more — and why the Arc block
 * had quietly drifted, listing no `ShaderCache` and no `Cookies-journal`.
 *
 * `externalCache` is the one genuinely per-browser path: macOS puts a second
 * cache under `~/Library/Caches/<bundle id>`, and Windows keeps everything
 * inside the profile.
 */
function chromiumProfile(
  browser: string,
  browserIcon: string,
  profile: string,
  externalCache: string | null,
): BrowserProfile {
  return {
    browser,
    browserIcon,
    profilePath: profile,
    cachePaths: [
      ...(externalCache ? [externalCache] : []),
      path.join(profile, 'Cache'),
      path.join(profile, 'Code Cache'),
      path.join(profile, 'GPUCache'),
      path.join(profile, 'ShaderCache'),
    ],
    cookiePaths: [path.join(profile, 'Cookies'), path.join(profile, 'Cookies-journal')],
    historyPaths: [path.join(profile, 'History'), path.join(profile, 'History-journal')],
    serviceWorkerPaths: [path.join(profile, 'Service Worker/CacheStorage'), path.join(profile, 'Service Worker/ScriptCache')],
    localStoragePaths: [path.join(profile, 'Local Storage')],
  }
}

/**
 * Where each Chromium browser keeps its profiles, per platform.
 *
 * Windows has no second cache location, so `externalCache` is null throughout
 * — the entries that would have pointed at `~/Library/Caches` there.
 */
function chromiumRoots(): { browser: string, icon: string, base: string, externalCache: string | null }[] {
  if (IS_WINDOWS) {
    const local = process.env.LOCALAPPDATA || path.win32.join(HOME, 'AppData', 'Local')
    const roaming = process.env.APPDATA || path.win32.join(HOME, 'AppData', 'Roaming')
    return [
      { browser: 'Chrome', icon: 'i-f7-globe', base: path.win32.join(local, 'Google', 'Chrome', 'User Data'), externalCache: null },
      { browser: 'Edge', icon: 'i-f7-globe', base: path.win32.join(local, 'Microsoft', 'Edge', 'User Data'), externalCache: null },
      { browser: 'Brave', icon: 'i-f7-shield-fill', base: path.win32.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data'), externalCache: null },
      { browser: 'Vivaldi', icon: 'i-f7-globe', base: path.win32.join(local, 'Vivaldi', 'User Data'), externalCache: null },
      { browser: 'Opera', icon: 'i-f7-globe', base: path.win32.join(roaming, 'Opera Software', 'Opera Stable'), externalCache: null },
    ]
  }

  const support = path.join(HOME, 'Library/Application Support')
  return [
    { browser: 'Chrome', icon: 'i-f7-globe', base: path.join(support, 'Google/Chrome'), externalCache: path.join(HOME, 'Library/Caches/Google/Chrome') },
    { browser: 'Edge', icon: 'i-f7-globe', base: path.join(support, 'Microsoft Edge'), externalCache: path.join(HOME, 'Library/Caches/Microsoft Edge') },
    { browser: 'Brave', icon: 'i-f7-shield-fill', base: path.join(support, 'BraveSoftware/Brave-Browser'), externalCache: path.join(HOME, 'Library/Caches/BraveSoftware/Brave-Browser') },
    { browser: 'Arc', icon: 'i-f7-circle-grid-hex-fill', base: path.join(support, 'Arc/User Data'), externalCache: path.join(HOME, 'Library/Caches/company.thebrowser.Browser') },
  ]
}

/** Where Firefox keeps its profiles, per platform. */
function firefoxProfilesRoot(): string {
  if (IS_WINDOWS) {
    const roaming = process.env.APPDATA || path.win32.join(HOME, 'AppData', 'Roaming')
    return path.win32.join(roaming, 'Mozilla', 'Firefox', 'Profiles')
  }
  return path.join(HOME, 'Library/Application Support/Firefox/Profiles')
}

export function detectBrowserProfiles(): BrowserProfile[] {
  const profiles: BrowserProfile[] = []

  for (const { browser, icon, base, externalCache } of chromiumRoots()) {
    if (!pathExists(base)) continue
    for (const profile of findChromeProfiles(base))
      profiles.push(chromiumProfile(browser, icon, profile, externalCache))
  }

  // Firefox
  const firefoxProfiles = firefoxProfilesRoot()
  if (pathExists(firefoxProfiles)) {
    for (const profile of safeReadDir(firefoxProfiles)) {
      const profilePath = path.join(firefoxProfiles, profile)
      profiles.push({
        browser: 'Firefox',
        browserIcon: 'i-f7-flame-fill',
        profilePath,
        cachePaths: [
          path.join(HOME, 'Library/Caches/Firefox'),
          path.join(profilePath, 'cache2'),
          path.join(profilePath, 'OfflineCache'),
          path.join(profilePath, 'startupCache'),
        ],
        cookiePaths: [path.join(profilePath, 'cookies.sqlite')],
        historyPaths: [path.join(profilePath, 'places.sqlite')],
        serviceWorkerPaths: [path.join(profilePath, 'storage/default')],
        localStoragePaths: [path.join(profilePath, 'webappsstore.sqlite')],
      })
    }
  }

  // Safari
  const safariPath = path.join(HOME, 'Library/Safari')
  if (pathExists(safariPath)) {
    profiles.push({
      browser: 'Safari',
      browserIcon: 'i-f7-compass-fill',
      profilePath: safariPath,
      cachePaths: [
        path.join(HOME, 'Library/Caches/com.apple.Safari'),
        path.join(HOME, 'Library/Caches/com.apple.Safari.SafeBrowsing'),
        path.join(HOME, 'Library/Caches/com.apple.WebKit.WebContent'),
        path.join(HOME, 'Library/Caches/com.apple.WebKit.Networking'),
      ],
      cookiePaths: [path.join(HOME, 'Library/Cookies/com.apple.Safari.cookies')],
      historyPaths: [path.join(safariPath, 'History.db')],
      serviceWorkerPaths: [path.join(HOME, 'Library/WebKit/com.apple.Safari/WebsiteData')],
      localStoragePaths: [path.join(safariPath, 'LocalStorage')],
    })
  }

  return profiles
}

/**
 * Scan Chrome extensions from all detected Chrome-based profiles
 */
export function scanChromeExtensions(): ExtensionInfo[] {
  const extensions: ExtensionInfo[] = []

  const chromeBases = [
    { base: path.join(HOME, 'Library/Application Support/Google/Chrome'), browser: 'Chrome', icon: 'i-f7-globe' },
    { base: path.join(HOME, 'Library/Application Support/Microsoft Edge'), browser: 'Edge', icon: 'i-f7-app-fill' },
    { base: path.join(HOME, 'Library/Application Support/BraveSoftware/Brave-Browser'), browser: 'Brave', icon: 'i-f7-shield-lefthalf-fill' },
    { base: path.join(HOME, 'Library/Application Support/Arc/User Data'), browser: 'Arc', icon: 'i-f7-circle-grid-hex-fill' },
  ]

  for (const { base, browser, icon } of chromeBases) {
    for (const profile of findChromeProfiles(base)) {
      const extDir = path.join(profile, 'Extensions')
      if (!pathExists(extDir))
        continue

      for (const extId of safeReadDir(extDir)) {
        const extPath = path.join(extDir, extId)
        try {
          const versions = safeReadDir(extPath).filter(v => !v.startsWith('.'))
          if (versions.length === 0)
            continue
          const latestVer = versions.sort().pop()!
          const manifestRaw = safeReadFile(path.join(extPath, latestVer, 'manifest.json'))
          if (!manifestRaw)
            continue
          const manifest = JSON.parse(manifestRaw)
          // Resolve __MSG_*__ i18n placeholders from _locales
          let name = manifest.name || extId
          let description = (manifest.description || '').slice(0, 120)
          if (name.startsWith('__MSG_') || description.startsWith('__MSG_')) {
            const localesPath = path.join(extPath, latestVer, '_locales', 'en', 'messages.json')
            const localesRaw = safeReadFile(localesPath)
            if (localesRaw) {
              try {
                const messages = JSON.parse(localesRaw)
                const resolve = (s: string) => s.replace(/__MSG_(\w+)__/g, (_, key) => messages[key]?.message || messages[key.toLowerCase()]?.message || s)
                name = resolve(name)
                description = resolve(description)
              }
              catch { /* skip broken locales */ }
            }
            // Still unresolved? Use extension ID as name
            if (name.startsWith('__MSG_')) name = extId
            if (description.startsWith('__MSG_')) description = ''
          }
          extensions.push({
            id: `${browser.toLowerCase()}-${extId}`,
            name,
            version: manifest.version || latestVer,
            description: description.slice(0, 120),
            browser,
            browserIcon: icon,
            extId,
            permissions: manifest.permissions?.length || 0,
            hostPermissions: manifest.host_permissions?.length || 0,
            path: extPath,
          })
        }
        catch { /* skip broken extensions */ }
      }
    }
  }

  return extensions
}

/**
 * Scan Firefox extensions
 */
export function scanFirefoxExtensions(): ExtensionInfo[] {
  const extensions: ExtensionInfo[] = []
  const profilesDir = path.join(HOME, 'Library/Application Support/Firefox/Profiles')

  for (const profile of safeReadDir(profilesDir)) {
    // Check all profile directories that contain extensions.json, not just .default
    const extFile = path.join(profilesDir, profile, 'extensions.json')
    if (!pathExists(extFile))
      continue

    const raw = safeReadFile(extFile)
    if (!raw)
      continue

    try {
      const data = JSON.parse(raw)
      for (const addon of (data.addons || [])) {
        if (addon.type !== 'extension')
          continue
        extensions.push({
          id: `firefox-${addon.id}`,
          name: addon.defaultLocale?.name || addon.id,
          version: addon.version || '—',
          description: (addon.defaultLocale?.description || '').slice(0, 120),
          browser: 'Firefox',
          browserIcon: 'i-f7-flame-fill',
          extId: addon.id,
          permissions: 0,
          hostPermissions: 0,
          path: path.join(profilesDir, profile, 'extensions', `${addon.id}.xpi`),
        })
      }
    }
    catch { /* skip broken profile */ }
  }

  return extensions
}

/**
 * Get all browser extensions across all browsers
 */
/**
 * Get all browser extensions across all browsers.
 * Note: scanChromeExtensions covers Chrome, Edge, Brave, and Arc (all Chromium-based).
 */
export function getAllExtensions(): ExtensionInfo[] {
  return [...scanChromeExtensions(), ...scanFirefoxExtensions()]
}

export interface ExtensionInfo {
  id: string
  name: string
  version: string
  description: string
  browser: string
  browserIcon: string
  extId: string
  permissions: number
  hostPermissions: number
  path: string
}

// Helper: find Chrome-style profile directories
function findChromeProfiles(basePath: string): string[] {
  const profiles: string[] = []

  // Default profile
  const defaultProfile = path.join(basePath, 'Default')
  if (pathExists(defaultProfile))
    profiles.push(defaultProfile)

  // Numbered profiles (Profile 1, Profile 2, etc.)
  for (const entry of safeReadDir(basePath)) {
    if (entry.startsWith('Profile '))
      profiles.push(path.join(basePath, entry))
  }

  return profiles
}

/** Process names to check before touching a browser's profile. */
const BROWSER_PROCESSES: Record<string, string[]> = {
  'Chrome': ['Google Chrome'],
  'Safari': ['Safari'],
  'Firefox': ['firefox'],
  'Edge': ['Microsoft Edge'],
  'Brave': ['Brave Browser'],
  'Arc': ['Arc'],
}

/** The same browsers, by the image name Windows reports for them. */
const WINDOWS_BROWSER_PROCESSES: Record<string, string[]> = {
  Chrome: ['chrome.exe'],
  Firefox: ['firefox.exe'],
  Edge: ['msedge.exe'],
  Brave: ['brave.exe'],
  Opera: ['opera.exe'],
  Vivaldi: ['vivaldi.exe'],
}

/**
 * Returned in place of a browser name when the probe could not answer.
 *
 * Not a browser, and deliberately unspellable as one. `blockedByRunningBrowser`
 * treats its presence as "every browser might be open", which is the only safe
 * reading: this gate exists because writing into a live profile corrupts it,
 * and a gate that cannot see has to refuse rather than wave things through.
 */
export const BROWSER_PROBE_FAILED = '\u0000probe-failed'

/**
 * Which browsers are running right now, by the display name the rest of this
 * package uses.
 *
 * Both the privacy clean and the extension remover check this first: writing
 * into a live browser profile does not clear or uninstall anything, it corrupts
 * the profile, and the damage only shows up at the next launch.
 */
export async function runningBrowsers(): Promise<string[]> {
  const names = await processNames()

  // The probe could not answer. Say so rather than returning an empty list,
  // which reads identically to "nothing is open" and is how this gate used to
  // fail open: `pgrep` exits 1 when it matches nothing and 127 when it is not
  // there, and both produced empty output. On Windows there is no `pgrep` at
  // all, so every clean would have been permitted against a live profile.
  if (names === null)
    return [BROWSER_PROBE_FAILED]

  const table = IS_WINDOWS ? WINDOWS_BROWSER_PROCESSES : BROWSER_PROCESSES
  const running: string[] = []

  for (const [browser, processes] of Object.entries(table)) {
    // Exact match on the executable name, so "Google Chrome" cannot be matched
    // by "Google Chrome Helper" and report a browser that is not open.
    if (processes.some(name => names.has(name.toLowerCase())))
      running.push(browser)
  }

  return running
}

/**
 * Every running process's executable name, lowercased, or null if the list
 * could not be obtained.
 *
 * One spawn for the whole sweep rather than one per browser, and spawned
 * directly rather than through `exec`, which wraps everything in `sh -c` —
 * absent on Windows, and the reason this check silently permitted every clean
 * there.
 */
async function processNames(): Promise<Set<string> | null> {
  // `tasklist` lives in System32 and is always present; `ps` is in the POSIX
  // base. Neither needs a shell.
  const argv = IS_WINDOWS
    ? ['tasklist.exe', '/FO', 'CSV', '/NH']
    : ['ps', '-A', '-o', 'comm=']

  try {
    const proc = Bun.spawn(argv, { stdout: 'pipe', stderr: 'ignore' })
    const timer = setTimeout(() => proc.kill(), 5000)
    const stdout = await new Response(proc.stdout).text()
    const code = await proc.exited
    clearTimeout(timer)

    if (code !== 0 || !stdout.trim())
      return null

    const names = new Set<string>()
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      // tasklist CSV quotes every field, and the image name is the first.
      // `ps -o comm=` prints a path on macOS, so only the last segment is the
      // executable name.
      const value = IS_WINDOWS
        ? trimmed.split('","')[0].replace(/^"/, '')
        : trimmed.split('/').pop() || trimmed
      names.add(value.toLowerCase())
    }
    return names
  }
  catch {
    return null
  }
}

/**
 * Why a browser's data cannot be touched right now, or null if it can.
 *
 * Shared by the privacy clean and the extension remover because both enforce
 * the same rule for the same reason, and a rule enforced twice is a rule that
 * drifts. Takes the running set rather than looking it up, so one `pgrep`
 * sweep covers a whole batch and the decision itself is testable without a
 * browser open.
 */
export function blockedByRunningBrowser(browser: string, running: Iterable<string>, action: 'clear' | 'remove'): string | null {
  for (const open of running) {
    // The probe failed, so nothing can be ruled out. Refusing is the only
    // honest answer: the whole point of this check is that writing into a live
    // profile corrupts it, and silence is not evidence that none is open.
    if (open === BROWSER_PROBE_FAILED) {
      return action === 'clear'
        ? 'Could not tell whether a browser is open, so this was not cleared — a live profile would be corrupted'
        : 'Could not tell whether a browser is open, so nothing was removed — a live profile would be corrupted'
    }

    if (open !== browser)
      continue

    return action === 'clear'
      ? `Quit ${browser} first — writing to a live profile corrupts it`
      : `Quit ${browser} first — removing an extension from a live profile corrupts it`
  }

  return null
}
