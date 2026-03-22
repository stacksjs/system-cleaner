import * as path from 'node:path'
import { HOME, pathExists, safeReadDir, safeReadFile } from '@system-cleaner/core'
import type { BrowserProfile } from './types'

/**
 * Detect all installed browser profiles and their cleanable paths
 */
export function detectBrowserProfiles(): BrowserProfile[] {
  const profiles: BrowserProfile[] = []

  // Chrome
  const chromeBase = path.join(HOME, 'Library/Application Support/Google/Chrome')
  if (pathExists(chromeBase)) {
    for (const profile of findChromeProfiles(chromeBase)) {
      profiles.push({
        browser: 'Chrome',
        browserIcon: '🌐',
        profilePath: profile,
        cachePaths: [
          path.join(HOME, 'Library/Caches/Google/Chrome'),
          path.join(profile, 'Cache'),
          path.join(profile, 'Code Cache'),
          path.join(profile, 'GPUCache'),
          path.join(profile, 'ShaderCache'),
        ],
        cookiePaths: [path.join(profile, 'Cookies'), path.join(profile, 'Cookies-journal')],
        historyPaths: [path.join(profile, 'History'), path.join(profile, 'History-journal')],
        serviceWorkerPaths: [path.join(profile, 'Service Worker/CacheStorage'), path.join(profile, 'Service Worker/ScriptCache')],
        localStoragePaths: [path.join(profile, 'Local Storage')],
      })
    }
  }

  // Firefox
  const firefoxProfiles = path.join(HOME, 'Library/Application Support/Firefox/Profiles')
  if (pathExists(firefoxProfiles)) {
    for (const profile of safeReadDir(firefoxProfiles)) {
      const profilePath = path.join(firefoxProfiles, profile)
      profiles.push({
        browser: 'Firefox',
        browserIcon: '🦊',
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
      browserIcon: '🧭',
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

  // Edge
  const edgeBase = path.join(HOME, 'Library/Application Support/Microsoft Edge')
  if (pathExists(edgeBase)) {
    for (const profile of findChromeProfiles(edgeBase)) {
      profiles.push({
        browser: 'Edge',
        browserIcon: '🔷',
        profilePath: profile,
        cachePaths: [
          path.join(HOME, 'Library/Caches/Microsoft Edge'),
          path.join(profile, 'Cache'),
          path.join(profile, 'Code Cache'),
          path.join(profile, 'GPUCache'),
        ],
        cookiePaths: [path.join(profile, 'Cookies')],
        historyPaths: [path.join(profile, 'History')],
        serviceWorkerPaths: [path.join(profile, 'Service Worker/CacheStorage')],
        localStoragePaths: [path.join(profile, 'Local Storage')],
      })
    }
  }

  // Brave
  const braveBase = path.join(HOME, 'Library/Application Support/BraveSoftware/Brave-Browser')
  if (pathExists(braveBase)) {
    for (const profile of findChromeProfiles(braveBase)) {
      profiles.push({
        browser: 'Brave',
        browserIcon: '🦁',
        profilePath: profile,
        cachePaths: [
          path.join(HOME, 'Library/Caches/BraveSoftware/Brave-Browser'),
          path.join(profile, 'Cache'),
          path.join(profile, 'Code Cache'),
          path.join(profile, 'GPUCache'),
        ],
        cookiePaths: [path.join(profile, 'Cookies')],
        historyPaths: [path.join(profile, 'History')],
        serviceWorkerPaths: [path.join(profile, 'Service Worker/CacheStorage')],
        localStoragePaths: [path.join(profile, 'Local Storage')],
      })
    }
  }

  // Arc
  const arcBase = path.join(HOME, 'Library/Application Support/Arc')
  if (pathExists(arcBase)) {
    const arcUser = path.join(arcBase, 'User Data')
    if (pathExists(arcUser)) {
      for (const profile of findChromeProfiles(arcUser)) {
        profiles.push({
          browser: 'Arc',
          browserIcon: '🌈',
          profilePath: profile,
          cachePaths: [
            path.join(HOME, 'Library/Caches/company.thebrowser.Browser'),
            path.join(profile, 'Cache'),
            path.join(profile, 'Code Cache'),
            path.join(profile, 'GPUCache'),
          ],
          cookiePaths: [path.join(profile, 'Cookies')],
          historyPaths: [path.join(profile, 'History')],
          serviceWorkerPaths: [path.join(profile, 'Service Worker/CacheStorage')],
          localStoragePaths: [path.join(profile, 'Local Storage')],
        })
      }
    }
  }

  return profiles
}

/**
 * Scan Chrome extensions from all detected Chrome-based profiles
 */
export function scanChromeExtensions(): ExtensionInfo[] {
  const extensions: ExtensionInfo[] = []

  const chromeBases = [
    { base: path.join(HOME, 'Library/Application Support/Google/Chrome'), browser: 'Chrome', icon: '🌐' },
    { base: path.join(HOME, 'Library/Application Support/Microsoft Edge'), browser: 'Edge', icon: '🔷' },
    { base: path.join(HOME, 'Library/Application Support/BraveSoftware/Brave-Browser'), browser: 'Brave', icon: '🦁' },
    { base: path.join(HOME, 'Library/Application Support/Arc/User Data'), browser: 'Arc', icon: '🌈' },
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
          extensions.push({
            id: `${browser.toLowerCase()}-${extId}`,
            name: manifest.name || extId,
            version: manifest.version || latestVer,
            description: (manifest.description || '').slice(0, 120),
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
          browserIcon: '🦊',
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
