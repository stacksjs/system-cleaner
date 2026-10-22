import * as path from 'node:path'
import { exec, macPaths, pathExists, safeReadDir, safeStat, shellEscape, readAppInfoPlist } from '@system-cleaner/core'

export interface OrphanedItem {
  path: string
  bundleId: string
  type: 'cache' | 'log' | 'saved-state' | 'webkit' | 'http-storage' | 'cookie' | 'app-support' | 'container'
  sizeBytes: number
  daysSinceModified: number
  /**
   * True for roots that hold real user documents rather than rebuildable
   * scratch. Callers must not auto-select these — a stale cache is free to
   * delete, an app's Application Support directory may be the only copy of
   * something the user cannot regenerate.
   */
  holdsUserData: boolean
}

/** Bundle ID patterns that should NEVER be cleaned as orphans */
const NEVER_DELETE = [
  /1password/i, /keychain/i, /bitwarden/i, /lastpass/i, /keepass/i, /dashlane/i, /enpass/i,
  /\bssh\b/i, /\bgpg\b/i, /gnupg/i, /credential/i, /secret/i, /\btoken\b/i, /\bauth\b/i,
  /com\.apple\./i, /\bloginwindow\b/i, /\bdock\b/i, /\bfinder\b/i, /\bsafari\b/i,
]

/**
 * Plain-named directories under Application Support that belong to macOS
 * itself, not to a third-party app. None of these has a matching `.app`, so
 * any "is the owning app installed?" test reports them as orphaned — and
 * `MobileSync` alone can be every iPhone backup on the machine.
 *
 * Only consulted for the plain-name path; reverse-DNS entries are already
 * covered by the `com.apple.` rule in NEVER_DELETE.
 */
export const SYSTEM_DIR_NAMES = new Set([
  'addressbook', 'animoji', 'callhistorydb', 'callhistorytransactions', 'clouddocs',
  'crashreporter', 'differentialprivacy', 'diskimages', 'dock', 'facetime',
  'fileprovider', 'icloud', 'knowledge', 'mobilesync', 'music', 'sesstorage',
  'syncservices', 'caches', 'com.apple',
])

/**
 * Plain-named Application Support directories mapped to the apps that own
 * them. Required because the directory name routinely is not the app name:
 * Chrome writes to `Google`, Firefox to `Mozilla`, Brave to `BraveSoftware`.
 *
 * This map is deliberately the *only* source of plain-name orphans. The
 * obvious alternative — flag any directory whose name matches no installed
 * app — is unsafe: on the machine this was developed against, `Google` held
 * 7.7 GB of live Chrome profile (history, bookmarks, saved passwords) and
 * would have been reported as orphaned data from an uninstalled app.
 *
 * An unrecognised directory is therefore never flagged. False negatives cost
 * disk space; false positives cost the user their data.
 */
export const KNOWN_APP_DIRS: Record<string, string[]> = {
  'Arc': ['Arc'],
  'BraveSoftware': ['Brave Browser', 'Brave Browser Beta', 'Brave Browser Nightly'],
  'Chromium': ['Chromium'],
  'Code': ['Visual Studio Code', 'Code'],
  'Cursor': ['Cursor'],
  'Discord': ['Discord'],
  'Firefox': ['Firefox'],
  'GitHub Desktop': ['GitHub Desktop'],
  'Google': ['Google Chrome', 'Google Chrome Canary', 'Google Chrome Beta', 'Google Drive'],
  'JetBrains': ['IntelliJ IDEA', 'WebStorm', 'PyCharm', 'GoLand', 'RubyMine', 'CLion', 'PhpStorm', 'Rider', 'DataGrip'],
  'Microsoft': ['Microsoft Edge', 'Microsoft Word', 'Microsoft Excel', 'Microsoft PowerPoint', 'Microsoft Outlook', 'Microsoft Teams', 'OneDrive'],
  'Mozilla': ['Firefox', 'Firefox Developer Edition', 'Thunderbird'],
  'Notion': ['Notion'],
  'Postman': ['Postman'],
  'Slack': ['Slack'],
  'Steam': ['Steam'],
  'Sublime Text': ['Sublime Text'],
  'TeamViewer': ['TeamViewer'],
  'Zoom': ['zoom.us'],
}

/** Case-insensitive pattern to match reverse-DNS bundle IDs */
const BUNDLE_ID_PATTERN = /^(com|org|net|io)\.[a-z]/i

/**
 * How entries in a root identify their owning app. `bundle-id` names are
 * unambiguous and resolve against installed bundle identifiers; `app-name`
 * names resolve through KNOWN_APP_DIRS against installed app names.
 */
type NameKind = 'bundle-id' | 'app-name'

interface OrphanDir {
  basePath: string
  type: OrphanedItem['type']
  pattern: RegExp
  nameKind: NameKind
  /** Age below which an entry in this root is never reported. */
  minAgeDays: number
  holdsUserData: boolean
}

const AGE_THRESHOLD_DAYS = 30

/**
 * Application Support and Containers get a longer threshold than caches do.
 * A cache untouched for a month is dead; an app's documents untouched for a
 * month may just be an app the user opens quarterly.
 */
const USER_DATA_AGE_THRESHOLD_DAYS = 90

const ORPHAN_DIRS: OrphanDir[] = [
  { basePath: macPaths.caches, type: 'cache', pattern: BUNDLE_ID_PATTERN, nameKind: 'bundle-id', minAgeDays: AGE_THRESHOLD_DAYS, holdsUserData: false },
  { basePath: macPaths.logs, type: 'log', pattern: BUNDLE_ID_PATTERN, nameKind: 'bundle-id', minAgeDays: AGE_THRESHOLD_DAYS, holdsUserData: false },
  { basePath: macPaths.savedState, type: 'saved-state', pattern: /\.savedState$/i, nameKind: 'bundle-id', minAgeDays: AGE_THRESHOLD_DAYS, holdsUserData: false },
  { basePath: macPaths.webkit, type: 'webkit', pattern: BUNDLE_ID_PATTERN, nameKind: 'bundle-id', minAgeDays: AGE_THRESHOLD_DAYS, holdsUserData: false },
  { basePath: macPaths.httpStorages, type: 'http-storage', pattern: BUNDLE_ID_PATTERN, nameKind: 'bundle-id', minAgeDays: AGE_THRESHOLD_DAYS, holdsUserData: false },

  // Where an uninstalled app leaves gigabytes rather than megabytes. Scanned
  // twice: once for the reverse-DNS directories, once for the plain-named
  // ones KNOWN_APP_DIRS can attribute.
  { basePath: macPaths.applicationSupport, type: 'app-support', pattern: BUNDLE_ID_PATTERN, nameKind: 'bundle-id', minAgeDays: USER_DATA_AGE_THRESHOLD_DAYS, holdsUserData: true },
  { basePath: macPaths.applicationSupport, type: 'app-support', pattern: /^[A-Z][\w .+-]*$/i, nameKind: 'app-name', minAgeDays: USER_DATA_AGE_THRESHOLD_DAYS, holdsUserData: true },

  // Sandboxed apps. Always bundle-id named, so unambiguous.
  { basePath: macPaths.containers, type: 'container', pattern: BUNDLE_ID_PATTERN, nameKind: 'bundle-id', minAgeDays: USER_DATA_AGE_THRESHOLD_DAYS, holdsUserData: true },

  // Group Containers are deliberately omitted: they are prefixed with a team
  // identifier (`9BNSXJN65R.com.example.app`) and shared between several apps
  // of one vendor, so "the owning app is gone" is not a question a single
  // directory name can answer.
]

/**
 * Find orphaned app data — caches, logs, saved states for apps no longer installed.
 * Uses shellEscape to prevent command injection from bundle IDs.
 */
export async function findOrphanedAppData(): Promise<OrphanedItem[]> {
  const installed = await getInstalledApps()
  const now = Date.now()
  const orphans: OrphanedItem[] = []
  const seen = new Set<string>()

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

      if (dir.nameKind === 'bundle-id') {
        // Skip if app is installed
        if (installed.bundleIds.has(bundleId) || installed.bundleIds.has(bundleId.toLowerCase()))
          continue
      }
      else {
        // If the app index came back empty — Spotlight disabled, mdfind
        // missing — then *every* mapped directory reads as uninstalled.
        // Refuse to answer rather than answer wrongly: the bundle-id roots
        // have NEVER_DELETE and `com.apple.` to fall back on, this path has
        // nothing but the index.
        if (installed.appNames.size === 0)
          continue

        // Plain name. macOS's own directories first — none of them has an
        // owning `.app`, so every one would otherwise read as orphaned.
        if (SYSTEM_DIR_NAMES.has(bundleId.toLowerCase()))
          continue

        // Only directories we can actually attribute. An unknown name is
        // left alone rather than guessed at; see KNOWN_APP_DIRS.
        const owners = KNOWN_APP_DIRS[bundleId]
        if (!owners)
          continue

        if (owners.some(name => installed.appNames.has(name.toLowerCase())))
          continue
      }

      const fullPath = path.join(dir.basePath, entry)
      if (seen.has(fullPath))
        continue

      const stat = safeStat(fullPath)
      if (!stat)
        continue

      const daysSinceModified = Math.floor((now - stat.mtimeMs) / 86_400_000)
      if (daysSinceModified < dir.minAgeDays)
        continue

      // Validate the name before using it in a shell command. Plain app names
      // may legitimately contain spaces, dots and `+` (e.g. "Sublime Text").
      const safeName = dir.nameKind === 'bundle-id'
        ? /^[\w.-]+$/.test(bundleId)
        : /^[\w .+-]+$/.test(bundleId)
      if (!safeName)
        continue

      // Final check against Spotlight: verify the app is truly gone rather
      // than merely absent from the index we built.
      const query = dir.nameKind === 'bundle-id'
        ? `kMDItemCFBundleIdentifier == ${shellEscape(bundleId)}`
        : `kMDItemFSName == ${shellEscape(`${bundleId}.app`)}`
      const mdfindResult = await exec(
        `mdfind ${shellEscape(query)} 2>/dev/null | head -1`,
        { timeout: 3000 },
      )
      if (mdfindResult.ok && mdfindResult.stdout.trim())
        continue

      const sizeBytes = stat.isDirectory()
        ? await getDirSizeQuick(fullPath)
        : stat.size

      seen.add(fullPath)
      orphans.push({
        path: fullPath,
        bundleId,
        type: dir.type,
        sizeBytes,
        daysSinceModified,
        holdsUserData: dir.holdsUserData,
      })
    }
  }

  return orphans.sort((a, b) => b.sizeBytes - a.sizeBytes)
}

interface InstalledApps {
  bundleIds: Set<string>
  /** Lowercased app names, from the bundle's own metadata and its filename. */
  appNames: Set<string>
}

async function getInstalledApps(): Promise<InstalledApps> {
  const result = await exec(
    'mdfind "kMDItemContentType == \'com.apple.application-bundle\'" 2>/dev/null',
    { timeout: 15_000 },
  )

  const ids = new Set<string>()
  const names = new Set<string>()

  if (result.ok) {
    // No artificial cap. The previous `slice(0, 300)` silently classified
    // every app installed past index 300 as an orphan — and its support
    // data was queued for deletion. The PLIST_BATCH below already keeps
    // FS pressure bounded.
    const appPaths = result.stdout.split('\n').filter(Boolean)
    const PLIST_BATCH = 20
    for (let i = 0; i < appPaths.length; i += PLIST_BATCH) {
      for (const appPath of appPaths.slice(i, i + PLIST_BATCH)) {
        // The filename is recorded whether or not the plist is readable —
        // an unreadable bundle is still an installed app, and treating it as
        // absent is how live data gets reported as orphaned.
        names.add(path.basename(appPath, '.app').toLowerCase())
        try {
          const info = readAppInfoPlist(appPath)
          const bid = info.CFBundleIdentifier as string
          if (bid)
            ids.add(bid)
          for (const key of ['CFBundleName', 'CFBundleDisplayName'] as const) {
            const value = info[key]
            if (typeof value === 'string' && value)
              names.add(value.toLowerCase())
          }
        }
        catch { /* skip unreadable bundles */ }
      }
    }
  }

  // Well-known system bundle IDs as fallback in case mdfind is unavailable
  // (e.g. Spotlight indexing disabled). Without these we'd misclassify
  // Apple's own caches as orphans.
  for (const id of ['com.apple.Safari', 'com.apple.mail', 'com.apple.finder', 'com.apple.dock'])
    ids.add(id)

  return { bundleIds: ids, appNames: names }
}

async function getDirSizeQuick(dirPath: string): Promise<number> {
  const result = await exec(`du -sk ${shellEscape(dirPath)} 2>/dev/null | cut -f1`, { timeout: 5000 })
  if (!result.ok)
    return 0
  return (Number.parseInt(result.stdout) || 0) * 1024
}
