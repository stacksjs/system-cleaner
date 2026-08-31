import type { AppInfo, AppRemnant, RemnantType } from '@system-cleaner/core'
import * as path from 'node:path'
import { formatBytes, getDirSize, HOME, TtlCache } from '@system-cleaner/core'
import { discoverApps, findRemnants, getAppInfo, summarizeRemnants } from '@system-cleaner/uninstall'
import { bulkDelete, protectedPathSet } from './bulk-delete'
import type { BulkDeleteOutcome, DeleteMode } from './bulk-delete'

/**
 * The app uninstaller.
 *
 * Dragging an app to the Trash leaves its preferences, caches, containers,
 * launch agents and receipts behind — which is the entire reason AppCleaner
 * exists and the most-used panel in CleanMyMac. The engine for it
 * (`@system-cleaner/uninstall`) has been in this repo since the beginning,
 * reachable only from the CLI. This module is what puts it on screen.
 *
 * Two decisions worth stating, because they differ from the package's own
 * `uninstallApp()`:
 *
 *   - **The Trash, by default.** The package does `rm -rf`. Removing an app
 *     you use every day is a mistake someone will make, and one that is
 *     recoverable from Finder is a different class of mistake to one that is
 *     not. `bulkDelete` gives us that, plus the protected-path check and the
 *     lifetime-freed history every other delete in the app records.
 *   - **The user chooses.** The scan lists every remnant with its size and
 *     lets rows be unticked. A licence file living in Application Support is
 *     indistinguishable from a cache to any heuristic, and re-entering a
 *     licence key is a worse afternoon than leaving 4 KB on the disk.
 */

const appListCache = new TtlCache<InstalledApp[]>(5 * 60_000)
const appSizeCache = new TtlCache<Record<string, number>>(15 * 60_000)

export interface InstalledApp {
  name: string
  bundleId: string
  version: string
  path: string
  installedAt: string | null
  sizeBytes: number | null
}

/** Human labels for the places a remnant is found, and an icon per kind. */
const REMNANT_PRESENTATION: Record<RemnantType, { label: string, icon: string }> = {
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
 * Every third-party app that can be uninstalled.
 *
 * Sizes are omitted here and filled in by {@link appSizes}: sizing 120 app
 * bundles is a `du` per bundle, which is seconds of work the list does not
 * need in order to render.
 */
export async function listInstalledApps(): Promise<{ apps: InstalledApp[], cached: boolean }> {
  const hit = appListCache.get('apps')
  if (hit)
    return { apps: hit, cached: true }

  const discovered = await discoverApps(false)
  const sizes = appSizeCache.get('sizes') ?? {}

  const apps: InstalledApp[] = discovered.map(app => ({
    name: app.name,
    bundleId: app.bundleId,
    version: app.version,
    path: app.path,
    installedAt: app.installDate ? app.installDate.toISOString() : null,
    sizeBytes: sizes[app.path] ?? null,
  }))

  appListCache.set('apps', apps)
  return { apps, cached: false }
}

/** Bundle sizes, keyed by path. Ten at a time, so the disk is busy but not thrashed. */
export async function appSizes(): Promise<Record<string, number>> {
  const hit = appSizeCache.get('sizes')
  if (hit)
    return hit

  const { apps } = await listInstalledApps()
  const sizes: Record<string, number> = {}
  const BATCH = 10

  for (let i = 0; i < apps.length; i += BATCH) {
    const batch = apps.slice(i, i + BATCH)
    const measured = await Promise.all(batch.map(async (app) => {
      try {
        return [app.path, await getDirSize(app.path)] as const
      }
      catch {
        return [app.path, 0] as const
      }
    }))
    for (const [appPath, size] of measured)
      sizes[appPath] = size
  }

  appSizeCache.set('sizes', sizes)
  // The list is cached with its sizes still null; refresh it so the next
  // request does not hand back nulls next to a populated size map.
  appListCache.clear()
  return sizes
}

export function invalidateAppCaches(): void {
  appListCache.clear()
  appSizeCache.clear()
}

export interface RemnantRow {
  path: string
  displayPath: string
  type: RemnantType
  typeLabel: string
  icon: string
  sizeBytes: number
  sizeFormatted: string
  /** True when the path is on the user's never-delete list. */
  protected: boolean
  /**
   * True when removing it needs administrator rights this process does not
   * have — anything under `/Library`, which is every launch daemon and every
   * system-wide receipt.
   */
  needsAdmin: boolean
}

export interface AppScanResult {
  app: {
    name: string
    bundleId: string
    version: string
    path: string
    sizeBytes: number
    sizeFormatted: string
  }
  remnants: RemnantRow[]
  totalRemnantBytes: number
  totalRemnantFormatted: string
  totalBytes: number
  totalFormatted: string
}

function shortPath(target: string): string {
  return target.startsWith(`${HOME}/`) ? `~${target.slice(HOME.length)}` : target
}

/** Everything this app has left around the system, sized and ready to review. */
export async function scanApp(appPath: string): Promise<AppScanResult | null> {
  const info = await getAppInfo(appPath)
  if (!info)
    return null

  const [remnants, protectedPaths, bundleSize] = await Promise.all([
    findRemnants(info),
    protectedPathSet(),
    getDirSize(appPath).catch(() => 0),
  ])

  const sized: AppInfo = { ...info, sizeBytes: bundleSize }
  const summary = summarizeRemnants(sized, remnants)

  return {
    app: {
      name: info.name,
      bundleId: info.bundleId,
      version: info.version,
      path: info.path,
      sizeBytes: bundleSize,
      sizeFormatted: formatBytes(bundleSize),
    },
    remnants: remnants.map((remnant: AppRemnant) => {
      const presentation = remnantPresentation(remnant.type)
      return {
        path: remnant.path,
        displayPath: shortPath(remnant.path),
        type: remnant.type,
        typeLabel: presentation.label,
        icon: presentation.icon,
        sizeBytes: remnant.sizeBytes,
        sizeFormatted: formatBytes(remnant.sizeBytes),
        protected: protectedPaths.has(path.resolve(remnant.path)),
        needsAdmin: !remnant.path.startsWith(`${HOME}/`) && !remnant.path.startsWith('/Applications/'),
      }
    }),
    totalRemnantBytes: summary.totalRemnantSize,
    totalRemnantFormatted: summary.totalRemnantSizeFormatted,
    totalBytes: summary.totalSize,
    totalFormatted: summary.totalSizeFormatted,
  }
}

/**
 * Remove an app and the remnants the caller selected.
 *
 * Every path is re-derived from a fresh remnant scan rather than trusted from
 * the request: the client sends a list, and this only acts on the members of
 * that list which the scan itself produced. Without that check the endpoint
 * would be "delete any path you name", wearing an uninstaller's clothes.
 */
export async function uninstall(
  appPath: string,
  requestedPaths: string[],
  mode: DeleteMode,
): Promise<{ outcome: BulkDeleteOutcome, app: string } | null> {
  const scan = await scanApp(appPath)
  if (!scan)
    return null

  const allowed = new Set<string>([path.resolve(scan.app.path), ...scan.remnants.map(r => path.resolve(r.path))])
  const targets = requestedPaths
    .map(p => path.resolve(p))
    .filter(p => allowed.has(p))

  if (targets.length === 0)
    return { outcome: { succeeded: [], failed: [], skipped: [], freedBytes: 0, freedFormatted: '0 B' }, app: scan.app.name }

  const outcome = await bulkDelete(targets, mode, 'uninstall')

  // The skip reason `isPathSafe` gives for `/Library/...` is "outside home
  // directory", which reads as a bug rather than as the permission boundary it
  // is. Say what is actually true and what to do about it.
  outcome.skipped = outcome.skipped.map(entry => (
    entry.reason === 'Path is outside home directory'
      ? { path: entry.path, reason: 'Needs administrator rights — remove it in Terminal with sudo' }
      : entry
  ))

  invalidateAppCaches()
  return { outcome, app: scan.app.name }
}
