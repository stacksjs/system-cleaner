import * as fs from 'node:fs'
import * as path from 'node:path'
import { Database } from 'bun:sqlite'
import { HOME, formatBytes, pathExists, safeStat } from '@system-cleaner/core'
import { blockedByRunningBrowser, detectBrowserProfiles, runningBrowsers } from './browser'

/**
 * Per-browser privacy data — the feature CCleaner is actually known for.
 *
 * The app already cleaned browser *caches*: `CLEAN_TARGETS` carries a cache
 * entry per browser and nothing else. Cookies, history, downloads, sessions
 * and autofill were unreachable, even though `detectBrowserProfiles()` had
 * been mapping their paths the whole time.
 *
 * Two rules run through this file, and they are what make the feature usable
 * rather than frightening:
 *
 *   1. **Never write to a live profile.** Chromium and Firefox keep their
 *      SQLite databases open with WAL journals. Deleting one under a running
 *      browser does not "clear history", it corrupts a profile — and the
 *      damage shows up on the next launch, long after anyone would connect it
 *      to this app. Every clean checks for the browser first and refuses.
 *   2. **Cookies are keepable.** Clearing every cookie logs you out of
 *      everything, which is why people leave the box unticked forever. With a
 *      keep-list the rows for those domains survive, so the action is one
 *      someone will actually run.
 */
export type PrivacyKind
  = | 'cache'
    | 'cookies'
    | 'history'
    | 'downloads'
    | 'sessions'
    | 'local-storage'
    | 'service-workers'
    | 'autofill'
    | 'system'

/** How a kind is removed. */
export type PrivacyStrategy = 'delete-paths' | 'sqlite-rows'

export interface PrivacyItem {
  id: string
  browser: string
  browserIcon: string
  /** `Default`, `Profile 1`, … — empty for browsers with a single profile. */
  profile: string
  profilePath: string
  kind: PrivacyKind
  label: string
  description: string
  strategy: PrivacyStrategy
  paths: string[]
  sizeBytes: number
  sizeFormatted: string
  /**
   * True when clearing this costs the user something they will notice — being
   * logged out, losing open tabs. `Select safe` leaves these alone.
   */
  sensitive: boolean
  /** True when a keep-list applies to this item. */
  keepable: boolean
}

function sizeOfPaths(paths: string[]): number {
  let total = 0
  for (const p of paths) {
    const stat = safeStat(p)
    if (!stat)
      continue
    // A directory is measured shallowly on purpose. `Local Storage` and
    // `Service Worker` hold thousands of small files, and an exact `du` per
    // profile per kind turned the scan into a multi-second walk for a number
    // that only has to be the right order of magnitude.
    total += stat.isDirectory() ? shallowDirSize(p) : stat.size
  }
  return total
}

function shallowDirSize(dir: string): number {
  let total = 0
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  }
  catch {
    return 0
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    try {
      if (entry.isDirectory())
        total += shallowDirSize(full)
      else if (entry.isFile())
        total += fs.statSync(full).size
    }
    catch {
      // Unreadable entries contribute nothing rather than failing the scan.
    }
  }

  return total
}

/** Chromium keeps history, downloads and search terms in one `History` db. */
const CHROMIUM_HISTORY_TABLES = ['urls', 'visits', 'visit_source', 'keyword_search_terms', 'segments', 'segment_usage']
const CHROMIUM_DOWNLOAD_TABLES = ['downloads', 'downloads_url_chains', 'downloads_slices']
const FIREFOX_HISTORY_TABLES = ['moz_historyvisits', 'moz_places', 'moz_inputhistory']
const FIREFOX_DOWNLOAD_TABLES = ['moz_annos']

function isFirefox(browser: string): boolean {
  return browser === 'Firefox'
}

/**
 * The SQL that decides which cookies survive a clear.
 *
 * Exported because it is the one piece of this file where a mistake is
 * expensive in both directions: too loose and a clear leaves tracking cookies
 * behind, too tight and it signs you out of the sites you explicitly asked to
 * keep. `tests/privacy-keep-list.test.ts` runs it against a real database.
 *
 * A cookie for `github.com` is stored under `github.com` or `.github.com`, and
 * its subdomains under `.gist.github.com` — so an entry has to match a suffix,
 * not a string.
 */
export function buildKeepClause(hostColumn: string, domains: string[]): { clause: string, params: string[] } {
  const clause = domains
    .map(() => `(${hostColumn} = ? OR ${hostColumn} LIKE ? OR ${hostColumn} LIKE ?)`)
    .join(' OR ')

  const params: string[] = []
  for (const domain of domains)
    params.push(domain, `%.${domain}`, `.${domain}`)

  return { clause, params }
}

/**
 * Everything on this Mac that a privacy clean can address.
 *
 * Items with no data on disk are dropped: a row for a browser profile that has
 * never stored a cookie is a checkbox that can only ever free zero bytes.
 */
export function scanPrivacyItems(): PrivacyItem[] {
  const items: PrivacyItem[] = []

  for (const profile of detectBrowserProfiles()) {
    const profileName = profile.browser === 'Safari' ? '' : path.basename(profile.profilePath)
    const key = `${profile.browser.toLowerCase()}:${profileName || 'default'}`
    const firefox = isFirefox(profile.browser)

    const historyDb = profile.historyPaths[0]
    const cookieDb = profile.cookiePaths[0]
    const autofillDb = firefox
      ? path.join(profile.profilePath, 'formhistory.sqlite')
      : path.join(profile.profilePath, 'Web Data')
    const sessionPaths = firefox
      ? [path.join(profile.profilePath, 'sessionstore-backups')]
      : [path.join(profile.profilePath, 'Sessions')]

    const candidates: Array<Omit<PrivacyItem, 'id' | 'browser' | 'browserIcon' | 'profile' | 'profilePath' | 'sizeBytes' | 'sizeFormatted'>> = [
      {
        kind: 'cache',
        label: 'Cache',
        description: 'Images, scripts and pages the browser stored to load sites faster',
        strategy: 'delete-paths',
        paths: profile.cachePaths,
        sensitive: false,
        keepable: false,
      },
      {
        kind: 'history',
        label: 'Browsing history',
        description: 'Every page visited, and what was typed into the address bar',
        strategy: 'sqlite-rows',
        paths: historyDb ? [historyDb] : [],
        sensitive: false,
        keepable: false,
      },
      {
        kind: 'downloads',
        label: 'Download history',
        description: 'The list of downloaded files. The files themselves are untouched',
        strategy: 'sqlite-rows',
        paths: historyDb ? [historyDb] : [],
        sensitive: false,
        keepable: false,
      },
      {
        kind: 'cookies',
        label: 'Cookies',
        description: 'Site logins and tracking identifiers. Keep-listed sites survive',
        // Safari stores cookies in a binary plist, which cannot be edited a
        // row at a time — so it is the one browser where cookies are all or
        // nothing, and `keepable` says so.
        strategy: profile.browser === 'Safari' ? 'delete-paths' : 'sqlite-rows',
        paths: cookieDb ? [cookieDb] : [],
        sensitive: true,
        keepable: profile.browser !== 'Safari',
      },
      {
        kind: 'sessions',
        label: 'Open tabs & session',
        description: 'The tabs the browser would restore on next launch',
        strategy: 'delete-paths',
        paths: sessionPaths,
        sensitive: true,
        keepable: false,
      },
      {
        kind: 'local-storage',
        label: 'Local storage',
        description: 'Data sites saved in your browser, including some logins',
        strategy: 'delete-paths',
        paths: profile.localStoragePaths,
        sensitive: true,
        keepable: false,
      },
      {
        kind: 'service-workers',
        label: 'Service workers',
        description: 'Offline copies of sites and their background scripts',
        strategy: 'delete-paths',
        paths: profile.serviceWorkerPaths,
        sensitive: false,
        keepable: false,
      },
      {
        kind: 'autofill',
        label: 'Form autofill',
        description: 'Saved addresses, phone numbers and form entries. Not passwords',
        strategy: 'sqlite-rows',
        paths: [autofillDb],
        sensitive: true,
        keepable: false,
      },
    ]

    for (const candidate of candidates) {
      const present = candidate.paths.filter(p => pathExists(p))
      if (present.length === 0)
        continue

      const sizeBytes = sizeOfPaths(present)
      items.push({
        id: `${key}:${candidate.kind}`,
        browser: profile.browser,
        browserIcon: profile.browserIcon,
        profile: profileName,
        profilePath: profile.profilePath,
        ...candidate,
        paths: present,
        sizeBytes,
        sizeFormatted: formatBytes(sizeBytes),
      })
    }
  }

  items.push(...scanSystemPrivacyItems())

  return items
}

/**
 * Traces macOS itself keeps, which no browser owns.
 *
 * The quarantine log is the interesting one: every file downloaded on this Mac
 * is in it, with the URL it came from and when, going back years.
 */
function scanSystemPrivacyItems(): PrivacyItem[] {
  const definitions: Array<{
    id: string
    label: string
    description: string
    paths: string[]
    sensitive: boolean
  }> = [
    {
      id: 'recent-items',
      label: 'Recent items',
      description: 'The recent documents, applications and servers lists across the system',
      paths: [path.join(HOME, 'Library/Application Support/com.apple.sharedfilelist')],
      sensitive: false,
    },
    {
      id: 'quarantine-log',
      label: 'Download log',
      description: 'The record macOS keeps of every file downloaded, and the URL it came from',
      paths: [
        path.join(HOME, 'Library/Preferences/com.apple.LaunchServices.QuarantineEventsV2'),
        path.join(HOME, 'Library/Preferences/com.apple.LaunchServices.QuarantineEventsV2-shm'),
        path.join(HOME, 'Library/Preferences/com.apple.LaunchServices.QuarantineEventsV2-wal'),
      ],
      sensitive: false,
    },
    {
      id: 'shell-history',
      label: 'Shell history',
      description: 'Every command typed into a terminal, including any with a secret in it',
      paths: [
        path.join(HOME, '.zsh_history'),
        path.join(HOME, '.bash_history'),
      ],
      sensitive: true,
    },
  ]

  const items: PrivacyItem[] = []

  for (const definition of definitions) {
    const present = definition.paths.filter(p => pathExists(p))
    if (present.length === 0)
      continue

    const sizeBytes = sizeOfPaths(present)
    items.push({
      id: `macos::${definition.id}`,
      browser: 'macOS',
      browserIcon: 'i-f7-desktopcomputer',
      profile: '',
      profilePath: HOME,
      kind: 'system',
      label: definition.label,
      description: definition.description,
      strategy: 'delete-paths',
      paths: present,
      sizeBytes,
      sizeFormatted: formatBytes(sizeBytes),
      sensitive: definition.sensitive,
      keepable: false,
    })
  }

  return items
}

export interface PrivacyCleanOptions {
  /** Cookie domains to keep. `github.com` also keeps `www.github.com`. */
  keepDomains?: string[]
}

export interface PrivacyCleanOutcome {
  cleaned: string[]
  skipped: Array<{ id: string, reason: string }>
  errors: Array<{ id: string, error: string }>
  freedBytes: number
  freedFormatted: string
  keptCookies: number
}

/**
 * Clear the selected privacy items.
 *
 * Anything belonging to a running browser is skipped rather than attempted —
 * see the note at the top of this file.
 */
export async function cleanPrivacyItems(
  ids: string[],
  options: PrivacyCleanOptions = {},
): Promise<PrivacyCleanOutcome> {
  const wanted = new Set(ids)
  const items = scanPrivacyItems().filter(item => wanted.has(item.id))
  const busy = new Set(await runningBrowsers())
  const keepDomains = (options.keepDomains ?? []).map(d => d.trim().toLowerCase()).filter(Boolean)

  const outcome: PrivacyCleanOutcome = {
    cleaned: [],
    skipped: [],
    errors: [],
    freedBytes: 0,
    freedFormatted: '0 B',
    keptCookies: 0,
  }

  for (const item of items) {
    const blocked = blockedByRunningBrowser(item.browser, busy, 'clear')
    if (blocked) {
      outcome.skipped.push({ id: item.id, reason: blocked })
      continue
    }

    const before = sizeOfPaths(item.paths)

    try {
      if (item.strategy === 'sqlite-rows') {
        const kept = clearSqliteRows(item, keepDomains)
        outcome.keptCookies += kept
      }
      else {
        for (const target of item.paths)
          fs.rmSync(target, { recursive: true, force: true })
      }

      const after = sizeOfPaths(item.paths)
      outcome.freedBytes += Math.max(0, before - after)
      outcome.cleaned.push(item.id)
    }
    catch (err) {
      outcome.errors.push({ id: item.id, error: err instanceof Error ? err.message : String(err) })
    }
  }

  outcome.freedFormatted = formatBytes(outcome.freedBytes)
  return outcome
}

/**
 * Delete the rows one kind owns, leaving the database itself in place.
 *
 * Row-level rather than deleting the file, because these databases hold more
 * than one kind: Chromium's `History` is history *and* downloads *and* typed
 * search terms, so removing the file to clear a download list would take the
 * other two with it. `VACUUM` afterwards is what actually returns the pages to
 * the filesystem — without it the file keeps its size and the UI reports that
 * nothing was freed.
 */
function clearSqliteRows(item: PrivacyItem, keepDomains: string[]): number {
  const file = item.paths[0]
  if (!file || !pathExists(file))
    return 0

  const firefox = isFirefox(item.browser)
  const db = new Database(file, { readwrite: true })
  let kept = 0

  try {
    if (item.kind === 'cookies') {
      const table = firefox ? 'moz_cookies' : 'cookies'
      const hostColumn = firefox ? 'host' : 'host_key'

      if (keepDomains.length === 0) {
        db.run(`DELETE FROM ${table}`)
      }
      else {
        const { clause, params } = buildKeepClause(hostColumn, keepDomains)
        kept = Number((db.query(`SELECT COUNT(*) AS n FROM ${table} WHERE ${clause}`).get(...params) as { n: number } | null)?.n ?? 0)
        db.run(`DELETE FROM ${table} WHERE NOT (${clause})`, params)
      }
    }
    else {
      const tables = item.kind === 'history'
        ? (firefox ? FIREFOX_HISTORY_TABLES : CHROMIUM_HISTORY_TABLES)
        : item.kind === 'downloads'
          ? (firefox ? FIREFOX_DOWNLOAD_TABLES : CHROMIUM_DOWNLOAD_TABLES)
          : (firefox ? ['moz_formhistory'] : ['autofill', 'autofill_profiles', 'autofill_profile_emails', 'autofill_profile_phones', 'autofill_profile_names'])

      for (const table of tables) {
        try {
          db.run(`DELETE FROM ${table}`)
        }
        catch {
          // Schemas differ across browser versions, and a table that is not
          // there is not an error — Chrome dropped `segment_usage` at one
          // point and Firefox's `moz_annos` only exists once something has
          // been downloaded.
        }
      }
    }

    db.run('VACUUM')
  }
  finally {
    db.close()
  }

  return kept
}

/**
 * Count the cookies a keep-list would preserve, without deleting anything.
 *
 * The keep-list is only trustworthy if you can see it working before you press
 * the button.
 */
export function previewKeptCookies(keepDomains: string[]): number {
  if (keepDomains.length === 0)
    return 0

  let kept = 0

  for (const item of scanPrivacyItems()) {
    if (item.kind !== 'cookies' || item.strategy !== 'sqlite-rows')
      continue

    const file = item.paths[0]
    if (!file)
      continue

    const firefox = isFirefox(item.browser)
    const table = firefox ? 'moz_cookies' : 'cookies'
    const hostColumn = firefox ? 'host' : 'host_key'

    try {
      const db = new Database(file, { readonly: true })
      try {
        const { clause, params } = buildKeepClause(hostColumn, keepDomains)
        kept += Number((db.query(`SELECT COUNT(*) AS n FROM ${table} WHERE ${clause}`).get(...params) as { n: number } | null)?.n ?? 0)
      }
      finally {
        db.close()
      }
    }
    catch {
      // A locked or unreadable profile contributes nothing to the preview.
    }
  }

  return kept
}

/** Total bytes a privacy scan could reclaim, for the dashboard card. */
export async function privacyTotals(): Promise<{ items: number, sizeBytes: number, sizeFormatted: string }> {
  const items = scanPrivacyItems()
  const sizeBytes = items.reduce((sum, item) => sum + item.sizeBytes, 0)
  return { items: items.length, sizeBytes, sizeFormatted: formatBytes(sizeBytes) }
}
