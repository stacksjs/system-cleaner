import { lstatSync } from 'node:fs'
import * as path from 'node:path'
import { HOME, getDirSize, macPaths, safeReadDir, formatBytes } from '@system-cleaner/core'
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
  { basePath: path.join(macPaths.caches, 'SentryCrash'), type: 'caches', matchBy: 'name' },
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
  { basePath: path.join(HOME, '.config'), type: 'other', matchBy: 'both' },
  { basePath: path.join(HOME, '.local/share'), type: 'other', matchBy: 'both' },
  { basePath: path.join(HOME, '.local/state'), type: 'other', matchBy: 'both' },

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

  return [...variants]
}

/**
 * Human label and glyph per remnant kind.
 *
 * Lives here rather than in the view layer because it is a property of the
 * remnant type, and because `tests/runtime-icons.test.ts` has to read it
 * without dragging the app's database along: every one of these classes only
 * ever reaches the DOM through a `:class` binding, so Crosswind's scanner
 * cannot see it and the safelist has to cover it.
 */
export const REMNANT_PRESENTATION: Record<RemnantType, { label: string, icon: string }> = {
  'application-support': { label: 'Application Support', icon: 'i-f7-folder-fill' },
  'preferences': { label: 'Preferences', icon: 'i-f7-gear-alt-fill' },
  'caches': { label: 'Caches', icon: 'i-f7-archivebox-fill' },
  'logs': { label: 'Logs', icon: 'i-f7-doc-text-fill' },
  'cookies': { label: 'Cookies', icon: 'i-f7-globe' },
  'launch-agent': { label: 'Launch Agent', icon: 'i-f7-bolt-fill' },
  'launch-daemon': { label: 'Launch Daemon', icon: 'i-f7-bolt-fill' },
  'saved-state': { label: 'Saved Window State', icon: 'i-f7-macwindow' },
  'http-storage': { label: 'HTTP Storage', icon: 'i-f7-globe' },
  'webkit': { label: 'WebKit Data', icon: 'i-f7-compass-fill' },
  'containers': { label: 'Container', icon: 'i-f7-cube-box-fill' },
  'group-containers': { label: 'Group Container', icon: 'i-f7-cube-box-fill' },
  'crash-reports': { label: 'Crash Reports', icon: 'i-f7-exclamationmark-triangle-fill' },
  'receipts': { label: 'Install Receipts', icon: 'i-f7-doc-checkmark-fill' },
  'other': { label: 'Other', icon: 'i-f7-doc-fill' },
}

export function remnantPresentation(type: RemnantType): { label: string, icon: string } {
  return REMNANT_PRESENTATION[type] ?? REMNANT_PRESENTATION.other
}

/**
 * Find all remnants for a given application
 */
const additionalRemnants = new Map<string, Array<{ path: string, type: RemnantType }>>([
  ['com.raycast.macos', [
    { path: path.join(macPaths.applicationSupport, 'com.raycast.shared'), type: 'application-support' },
    { path: path.join(macPaths.caches, 'SentryCrash/Raycast Accessibility'), type: 'caches' },
    { path: path.join(macPaths.caches, 'SentryCrash/Raycast Pasteboard'), type: 'caches' },
  ]],
])

function remnantCandidates(app: AppInfo): Map<string, RemnantType> {
  const terms = buildSearchTerms(app)
  const candidates = new Map<string, RemnantType>()

  for (const location of REMNANT_LOCATIONS) {
    for (const match of findMatches(location, terms))
      candidates.set(match, location.type)
  }

  for (const variant of terms.nameVariantsLower) {
    if (variant.length < 3) continue
    candidates.set(path.join(HOME, `.${variant}`), 'other')
    candidates.set(path.join(HOME, `.${variant}rc`), 'other')
  }

  for (const remnant of additionalRemnants.get(terms.bundleIdLower) ?? [])
    candidates.set(remnant.path, remnant.type)

  candidates.delete(app.path)
  return candidates
}

/** Resolve file ownership without running disk measurements again at removal time. */
export function findRemnantPaths(app: AppInfo): string[] {
  return [...remnantCandidates(app).keys()]
}

export async function findRemnants(app: AppInfo): Promise<AppRemnant[]> {
  const candidates = [...remnantCandidates(app)]
  const remnants: AppRemnant[] = []

  for (let offset = 0; offset < candidates.length; offset += 4) {
    const batch = await Promise.all(candidates.slice(offset, offset + 4).map(async ([remnantPath, type]) => {
      try {
        const stat = lstatSync(remnantPath)
        const sizeBytes = stat.isDirectory() ? await getDirSize(remnantPath).catch(() => 0) : stat.size
        return { path: remnantPath, type, sizeBytes, exists: true }
      }
      catch {
        return null
      }
    }))
    for (const remnant of batch) {
      if (remnant) remnants.push(remnant)
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
  bundleIdLower: string
  nameVariantsLower: string[]
}

function buildSearchTerms(app: AppInfo): SearchTerms {
  return {
    bundleIdLower: app.bundleId.toLowerCase(),
    nameVariantsLower: generateNameVariants(app.name).map(name => name.toLowerCase()),
  }
}

function findMatches(location: RemnantSearchLocation, terms: SearchTerms): string[] {
  const matches: string[] = []
  const bundleId = terms.bundleIdLower

  for (const entry of safeReadDir(location.basePath)) {
    const name = entry.toLowerCase()
    const unhidden = name.replace(/^\./, '')
    // App groups and scripts can carry a signing-team prefix.
    const identifier = unhidden.replace(/^[a-z0-9]{10}\./, '')
    const matchesId = location.matchBy !== 'name' && bundleId && (
      identifier === bundleId || identifier.startsWith(`${bundleId}.`)
    )

    const matchesName = location.matchBy !== 'bundleId' && terms.nameVariantsLower.some(variant =>
      variant.length >= 3 && (unhidden === variant || unhidden.startsWith(`${variant}.`)
        || (location.fuzzy && unhidden.startsWith(`${variant}-`))
        || (location.type === 'crash-reports' && unhidden.startsWith(`${variant}_`))),
    )

    if (matchesId || matchesName)
      matches.push(path.join(location.basePath, entry))
  }
  return matches
}
