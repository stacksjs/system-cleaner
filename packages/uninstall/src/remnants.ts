import * as path from 'node:path'
import { HOME, getDirSize, macPaths, pathExists, safeStat, safeReadDir, formatBytes } from '@system-cleaner/core'
import type { AppInfo, AppRemnant, RemnantType } from './types'

interface RemnantSearchLocation {
  basePath: string
  type: RemnantType
  matchBy: 'bundleId' | 'name' | 'both'
  /** If true, search for files matching the pattern, not just exact dirs */
  fuzzy?: boolean
}

/**
 * All known locations where app remnants hide on macOS — 50+ locations matching Mole.
 */
const REMNANT_LOCATIONS: RemnantSearchLocation[] = [
  // ── User Library ────────────────────────────────────────────
  { basePath: macPaths.applicationSupport, type: 'application-support', matchBy: 'both' },
  { basePath: macPaths.caches, type: 'caches', matchBy: 'both' },
  { basePath: macPaths.logs, type: 'logs', matchBy: 'both' },
  { basePath: macPaths.preferences, type: 'preferences', matchBy: 'bundleId', fuzzy: true },
  { basePath: path.join(HOME, 'Library/Preferences/ByHost'), type: 'preferences', matchBy: 'bundleId', fuzzy: true },
  { basePath: macPaths.cookies, type: 'cookies', matchBy: 'bundleId', fuzzy: true },
  { basePath: macPaths.launchAgents, type: 'launch-agent', matchBy: 'both', fuzzy: true },
  { basePath: macPaths.savedState, type: 'saved-state', matchBy: 'bundleId', fuzzy: true },
  { basePath: macPaths.httpStorages, type: 'http-storage', matchBy: 'bundleId', fuzzy: true },
  { basePath: macPaths.webkit, type: 'webkit', matchBy: 'bundleId', fuzzy: true },
  { basePath: path.join(HOME, 'Library/WebKit/com.apple.WebKit.WebContent'), type: 'webkit', matchBy: 'bundleId', fuzzy: true },
  { basePath: macPaths.containers, type: 'containers', matchBy: 'bundleId' },
  { basePath: macPaths.groupContainers, type: 'group-containers', matchBy: 'bundleId', fuzzy: true },
  { basePath: macPaths.crashReports, type: 'crash-reports', matchBy: 'name', fuzzy: true },
  { basePath: path.join(HOME, 'Library/Application Support/CrashReporter'), type: 'crash-reports', matchBy: 'name', fuzzy: true },
  { basePath: path.join(HOME, 'Library/Receipts'), type: 'receipts', matchBy: 'bundleId', fuzzy: true },

  // ── User Library — Plugins & Extensions ─────────────────────
  { basePath: path.join(HOME, 'Library/Application Scripts'), type: 'other', matchBy: 'bundleId' },
  { basePath: path.join(HOME, 'Library/Services'), type: 'other', matchBy: 'name', fuzzy: true },
  { basePath: path.join(HOME, 'Library/QuickLook'), type: 'other', matchBy: 'name', fuzzy: true },
  { basePath: path.join(HOME, 'Library/Internet Plug-Ins'), type: 'other', matchBy: 'name', fuzzy: true },
  { basePath: path.join(HOME, 'Library/Audio/Plug-Ins/Components'), type: 'other', matchBy: 'name', fuzzy: true },
  { basePath: path.join(HOME, 'Library/Audio/Plug-Ins/VST'), type: 'other', matchBy: 'name', fuzzy: true },
  { basePath: path.join(HOME, 'Library/Audio/Plug-Ins/VST3'), type: 'other', matchBy: 'name', fuzzy: true },
  { basePath: path.join(HOME, 'Library/PreferencePanes'), type: 'other', matchBy: 'name', fuzzy: true },
  { basePath: path.join(HOME, 'Library/Input Methods'), type: 'other', matchBy: 'both', fuzzy: true },
  { basePath: path.join(HOME, 'Library/Screen Savers'), type: 'other', matchBy: 'name', fuzzy: true },
  { basePath: path.join(HOME, 'Library/Frameworks'), type: 'other', matchBy: 'name', fuzzy: true },
  { basePath: path.join(HOME, 'Library/Autosave Information'), type: 'other', matchBy: 'bundleId', fuzzy: true },
  { basePath: path.join(HOME, 'Library/Contextual Menu Items'), type: 'other', matchBy: 'name', fuzzy: true },
  { basePath: path.join(HOME, 'Library/Spotlight'), type: 'other', matchBy: 'name', fuzzy: true },
  { basePath: path.join(HOME, 'Library/ColorPickers'), type: 'other', matchBy: 'name', fuzzy: true },
  { basePath: path.join(HOME, 'Library/Workflows'), type: 'other', matchBy: 'name', fuzzy: true },

  // ── Dotfiles in home directory ──────────────────────────────
  { basePath: path.join(HOME, '.config'), type: 'other', matchBy: 'name' },
  { basePath: path.join(HOME, '.local/share'), type: 'other', matchBy: 'name' },

  // ── System-level locations ──────────────────────────────────
  { basePath: '/Library/Application Support', type: 'application-support', matchBy: 'both' },
  { basePath: macPaths.systemLaunchAgents, type: 'launch-agent', matchBy: 'bundleId', fuzzy: true },
  { basePath: macPaths.systemLaunchDaemons, type: 'launch-daemon', matchBy: 'bundleId', fuzzy: true },
  { basePath: '/Library/Preferences', type: 'preferences', matchBy: 'bundleId', fuzzy: true },
  { basePath: '/Library/Caches', type: 'caches', matchBy: 'bundleId', fuzzy: true },
  { basePath: '/Library/Receipts', type: 'receipts', matchBy: 'bundleId', fuzzy: true },
  { basePath: '/Library/Frameworks', type: 'other', matchBy: 'name', fuzzy: true },
  { basePath: '/Library/Internet Plug-Ins', type: 'other', matchBy: 'name', fuzzy: true },
  { basePath: '/Library/Input Methods', type: 'other', matchBy: 'both', fuzzy: true },
  { basePath: '/Library/Audio/Plug-Ins/Components', type: 'other', matchBy: 'name', fuzzy: true },
  { basePath: '/Library/Audio/Plug-Ins/VST', type: 'other', matchBy: 'name', fuzzy: true },
  { basePath: '/Library/Audio/Plug-Ins/VST3', type: 'other', matchBy: 'name', fuzzy: true },
  { basePath: '/Library/QuickLook', type: 'other', matchBy: 'name', fuzzy: true },
  { basePath: '/Library/PreferencePanes', type: 'other', matchBy: 'name', fuzzy: true },
  { basePath: '/Library/Screen Savers', type: 'other', matchBy: 'name', fuzzy: true },
  { basePath: '/Library/PrivilegedHelperTools', type: 'other', matchBy: 'bundleId', fuzzy: true },
  { basePath: '/private/var/db/receipts', type: 'receipts', matchBy: 'bundleId', fuzzy: true },
  { basePath: macPaths.systemCrashReports, type: 'crash-reports', matchBy: 'name', fuzzy: true },
]

/**
 * Generate all naming variants for an app, matching Mole's variant strategy.
 * e.g., "Maestro Studio" → [original, NoSpace, Under_Score, Hyphen-Ated, lowercase variants, ...]
 */
function generateNameVariants(name: string): string[] {
  const variants = new Set<string>()
  const clean = name.replace(/\.app$/i, '')

  variants.add(clean)
  variants.add(clean.replace(/\s+/g, ''))        // NoSpace
  variants.add(clean.replace(/\s+/g, '_'))        // Under_Score
  variants.add(clean.replace(/\s+/g, '-'))        // Hyphen-Ated
  variants.add(clean.toLowerCase())               // lowercase
  variants.add(clean.toLowerCase().replace(/\s+/g, ''))   // lowercasenospace
  variants.add(clean.toLowerCase().replace(/\s+/g, '-'))  // lowercase-hyphen
  variants.add(clean.toLowerCase().replace(/\s+/g, '_'))  // lowercase_under

  // Base name (strip version suffixes like "Zed Nightly" → "Zed")
  const baseName = clean.split(/\s+/)[0]
  if (baseName !== clean && baseName.length > 2) {
    variants.add(baseName)
    variants.add(baseName.toLowerCase())
  }

  return [...variants]
}

/**
 * Find all remnants for a given application
 */
export async function findRemnants(app: AppInfo): Promise<AppRemnant[]> {
  const remnants: AppRemnant[] = []
  const seen = new Set<string>()

  const terms = buildSearchTerms(app)

  for (const location of REMNANT_LOCATIONS) {
    if (!pathExists(location.basePath))
      continue

    const matches = findMatches(location, terms)
    for (const matchPath of matches) {
      if (seen.has(matchPath))
        continue
      seen.add(matchPath)

      if (matchPath === app.path)
        continue

      const stat = safeStat(matchPath)
      if (!stat)
        continue

      const sizeBytes = stat.isDirectory() ? await getDirSize(matchPath) : stat.size

      remnants.push({
        path: matchPath,
        type: location.type,
        sizeBytes,
        exists: true,
      })
    }
  }

  // Also check for dotfiles in HOME: ~/.appname, ~/.appnamerc
  for (const variant of terms.nameVariantsLower) {
    for (const dotfile of [path.join(HOME, `.${variant}`), path.join(HOME, `.${variant}rc`)]) {
      if (seen.has(dotfile) || !pathExists(dotfile))
        continue
      seen.add(dotfile)
      const stat = safeStat(dotfile)
      if (!stat)
        continue
      remnants.push({ path: dotfile, type: 'other', sizeBytes: stat.isDirectory() ? await getDirSize(dotfile) : stat.size, exists: true })
    }
  }

  return remnants.sort((a, b) => b.sizeBytes - a.sizeBytes)
}

/**
 * Calculate total remnant sizes
 */
export function summarizeRemnants(app: AppInfo, remnants: AppRemnant[]): {
  totalRemnantSize: number
  totalRemnantSizeFormatted: string
  totalSize: number
  totalSizeFormatted: string
  byType: Record<string, { count: number, size: number }>
} {
  const totalRemnantSize = remnants.reduce((sum, r) => sum + r.sizeBytes, 0)
  const totalSize = app.sizeBytes + totalRemnantSize

  const byType: Record<string, { count: number, size: number }> = {}
  for (const remnant of remnants) {
    if (!byType[remnant.type])
      byType[remnant.type] = { count: 0, size: 0 }
    byType[remnant.type].count++
    byType[remnant.type].size += remnant.sizeBytes
  }

  return {
    totalRemnantSize,
    totalRemnantSizeFormatted: formatBytes(totalRemnantSize),
    totalSize,
    totalSizeFormatted: formatBytes(totalSize),
    byType,
  }
}

// ── Search infrastructure ────────────────────────────────────────

interface SearchTerms {
  exactBundleId: string
  bundleIdLower: string
  nameVariants: string[]
  nameVariantsLower: string[]
  /** Short unique parts of bundle ID for fuzzy matching (e.g., "spotify" from "com.spotify.client") */
  bundleParts: string[]
}

function buildSearchTerms(app: AppInfo): SearchTerms {
  const variants = generateNameVariants(app.name)
  const bundleParts = app.bundleId
    .split('.')
    .filter(p => !['com', 'org', 'net', 'io', 'app', 'client', 'desktop', 'mac', 'macos', 'osx'].includes(p) && p.length > 2)

  return {
    exactBundleId: app.bundleId,
    bundleIdLower: app.bundleId.toLowerCase(),
    nameVariants: variants,
    nameVariantsLower: variants.map(v => v.toLowerCase()),
    bundleParts,
  }
}

function findMatches(location: RemnantSearchLocation, terms: SearchTerms): string[] {
  const matches: string[] = []

  let entries: string[]
  try {
    entries = safeReadDir(location.basePath)
  }
  catch {
    return []
  }

  for (const entry of entries) {
    const entryLower = entry.toLowerCase()
    let isMatch = false

    // Bundle ID match
    if (location.matchBy === 'bundleId' || location.matchBy === 'both') {
      if (terms.exactBundleId && entryLower.includes(terms.bundleIdLower)) {
        isMatch = true
      }
    }

    // Name variant match
    if (!isMatch && (location.matchBy === 'name' || location.matchBy === 'both')) {
      for (const variant of terms.nameVariantsLower) {
        if (variant.length < 3)
          continue
        if (entryLower === variant || entryLower === `${variant}.plist` || entryLower === `${variant}.savedstate` || entryLower === `${variant}.workflow` || entryLower === `${variant}.qlgenerator` || entryLower === `${variant}.plugin` || entryLower === `${variant}.framework` || entryLower === `${variant}.prefpane` || entryLower === `${variant}.saver` || entryLower === `${variant}.app` || entryLower === `${variant}.component` || entryLower === `${variant}.vst` || entryLower === `${variant}.vst3` || entryLower === `${variant}.mdimporter` || entryLower === `${variant}.colorpicker`) {
          isMatch = true
          break
        }
        // Substring match for directories
        if (entryLower === variant || entryLower.startsWith(`${variant}.`) || entryLower.startsWith(`${variant}-`)) {
          isMatch = true
          break
        }
      }
    }

    // Fuzzy: check bundle ID parts (require length >= 4 to avoid false positives)
    if (!isMatch && location.fuzzy) {
      for (const part of terms.bundleParts) {
        if (part.length >= 4 && entryLower.includes(part.toLowerCase())) {
          isMatch = true
          break
        }
      }
    }

    if (isMatch) {
      matches.push(path.join(location.basePath, entry))
    }
  }

  return matches
}
