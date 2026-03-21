import * as path from 'node:path'
import { HOME, exec, formatBytes, macPaths, pathExists, safeReadDir, safeStat, shellEscape } from '@system-cleaner/core'

export interface OrphanedItem {
  path: string
  bundleId: string
  type: 'cache' | 'log' | 'saved-state' | 'webkit' | 'http-storage' | 'cookie'
  sizeBytes: number
  daysSinceModified: number
}

/** Bundle ID patterns that should NEVER be cleaned as orphans */
const NEVER_DELETE = [
  /1password/i, /keychain/i, /bitwarden/i, /lastpass/i, /keepass/i, /dashlane/i, /enpass/i,
  /\bssh\b/i, /\bgpg\b/i, /gnupg/i, /credential/i, /secret/i, /\btoken\b/i, /\bauth\b/i,
  /com\.apple\./i, /\bloginwindow\b/i, /\bdock\b/i, /\bfinder\b/i, /\bsafari\b/i,
]

/** Case-insensitive pattern to match reverse-DNS bundle IDs */
const BUNDLE_ID_PATTERN = /^(com|org|net|io)\.[a-z]/i

const ORPHAN_DIRS: { basePath: string, type: OrphanedItem['type'], pattern: RegExp }[] = [
  { basePath: macPaths.caches, type: 'cache', pattern: BUNDLE_ID_PATTERN },
  { basePath: macPaths.logs, type: 'log', pattern: BUNDLE_ID_PATTERN },
  { basePath: macPaths.savedState, type: 'saved-state', pattern: /\.savedState$/i },
  { basePath: macPaths.webkit, type: 'webkit', pattern: BUNDLE_ID_PATTERN },
  { basePath: macPaths.httpStorages, type: 'http-storage', pattern: BUNDLE_ID_PATTERN },
]

const AGE_THRESHOLD_DAYS = 30

/**
 * Find orphaned app data — caches, logs, saved states for apps no longer installed.
 * Uses shellEscape to prevent command injection from bundle IDs.
 */
export async function findOrphanedAppData(): Promise<OrphanedItem[]> {
  const installedBundles = await getInstalledBundleIds()
  const now = Date.now()
  const orphans: OrphanedItem[] = []

  for (const dir of ORPHAN_DIRS) {
    if (!pathExists(dir.basePath))
      continue

    for (const entry of safeReadDir(dir.basePath)) {
      if (!dir.pattern.test(entry))
        continue

      const bundleId = entry.replace(/\.savedState$/i, '')

      // Protection: skip sensitive patterns
      if (NEVER_DELETE.some(p => p.test(bundleId)))
        continue

      // Skip if app is installed
      if (installedBundles.has(bundleId) || installedBundles.has(bundleId.toLowerCase()))
        continue

      const fullPath = path.join(dir.basePath, entry)
      const stat = safeStat(fullPath)
      if (!stat)
        continue

      const daysSinceModified = Math.floor((now - stat.mtimeMs) / 86_400_000)
      if (daysSinceModified < AGE_THRESHOLD_DAYS)
        continue

      // Validate bundle ID format before using in shell command (reverse-DNS only)
      if (!/^[\w.-]+$/.test(bundleId))
        continue

      // Final check: use mdfind with shellEscape to verify app is truly gone
      const mdfindResult = await exec(
        `mdfind "kMDItemCFBundleIdentifier == ${shellEscape(bundleId)}" 2>/dev/null | head -1`,
        { timeout: 3000 },
      )
      if (mdfindResult.ok && mdfindResult.stdout.trim())
        continue

      const sizeBytes = stat.isDirectory()
        ? await getDirSizeQuick(fullPath)
        : stat.size

      orphans.push({
        path: fullPath,
        bundleId,
        type: dir.type,
        sizeBytes,
        daysSinceModified,
      })
    }
  }

  return orphans.sort((a, b) => b.sizeBytes - a.sizeBytes)
}

async function getInstalledBundleIds(): Promise<Set<string>> {
  // Use two separate safe commands instead of piping mdfind through xargs
  const result = await exec(
    'mdfind "kMDItemContentType == \'com.apple.application-bundle\'" 2>/dev/null',
    { timeout: 15_000 },
  )

  const ids = new Set<string>()

  if (result.ok) {
    const appPaths = result.stdout.split('\n').filter(Boolean).slice(0, 500) // Cap at 500 apps
    // Read bundle IDs directly via plist parsing (no shell piping)
    const { readAppInfoPlist } = await import('@system-cleaner/core')
    for (const appPath of appPaths) {
      try {
        const info = readAppInfoPlist(appPath)
        const bid = info.CFBundleIdentifier as string
        if (bid)
          ids.add(bid)
      }
      catch { /* skip unreadable bundles */ }
    }
  }

  // Add well-known system bundle IDs as fallback
  for (const id of ['com.apple.Safari', 'com.apple.mail', 'com.apple.finder', 'com.apple.dock'])
    ids.add(id)

  return ids
}

async function getDirSizeQuick(dirPath: string): Promise<number> {
  const result = await exec(`du -sk ${shellEscape(dirPath)} 2>/dev/null | cut -f1`, { timeout: 5000 })
  if (!result.ok)
    return 0
  return (Number.parseInt(result.stdout) || 0) * 1024
}
