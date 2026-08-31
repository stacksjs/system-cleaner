import * as fs from 'node:fs'
import * as path from 'node:path'
import { HOME, formatBytes, safeStat } from '@system-cleaner/core'
import type { ExtensionInfo } from './browser'
import { blockedByRunningBrowser, getAllExtensions, runningBrowsers } from './browser'

/**
 * Removing a browser extension from disk.
 *
 * The Extensions screen was an inventory with no verbs, and the honest reason
 * was that "uninstall an extension" is not one operation on macOS — it is a
 * different operation per browser, and for Chromium it is one the browser can
 * undo behind your back.
 *
 * What this does, and what it deliberately does not:
 *
 *   - **It deletes the extension's files.** For Chromium that is the whole
 *     `Extensions/<id>` directory; for Firefox it is the `<id>.xpi` and its
 *     entry in `extensions.json`.
 *   - **It refuses while the browser is open.** Same rule as the privacy
 *     clean: a live profile is being written to, and deleting out from under
 *     it corrupts the profile rather than uninstalling anything.
 *   - **It does not touch Chromium's `Secure Preferences`.** That file carries
 *     an HMAC per setting precisely so that outside processes cannot rewrite
 *     the extension registry. Editing it would make Chrome detect tampering
 *     and reset settings — a worse outcome than the one we are fixing. The
 *     consequence is stated rather than hidden: a Web Store extension that is
 *     in your Chrome sync account can be reinstalled at the next launch, and
 *     {@link ExtensionRemovalTarget.mayReturn} says which ones those are.
 */

/** The roots an extension is allowed to live under, per browser. */
const EXTENSION_ROOTS: Record<string, string[]> = {
  Chrome: [path.join(HOME, 'Library/Application Support/Google/Chrome')],
  Edge: [path.join(HOME, 'Library/Application Support/Microsoft Edge')],
  Brave: [path.join(HOME, 'Library/Application Support/BraveSoftware/Brave-Browser')],
  Arc: [path.join(HOME, 'Library/Application Support/Arc/User Data')],
  Firefox: [path.join(HOME, 'Library/Application Support/Firefox/Profiles')],
}

/** Where each browser's own extensions page lives, and what to open it with. */
const EXTENSION_PAGES: Record<string, { app: string, url: string }> = {
  Chrome: { app: 'Google Chrome', url: 'chrome://extensions' },
  Edge: { app: 'Microsoft Edge', url: 'edge://extensions' },
  Brave: { app: 'Brave Browser', url: 'brave://extensions' },
  Arc: { app: 'Arc', url: 'chrome://extensions' },
  Firefox: { app: 'Firefox', url: 'about:addons' },
}

export function extensionsPage(browser: string): { app: string, url: string } | null {
  return EXTENSION_PAGES[browser] ?? null
}

/**
 * A Chromium Web Store id is exactly 32 characters from `a`–`p`.
 *
 * Anything else — an unpacked extension loaded from a folder, a sideloaded
 * crx — has no Web Store entry to sync from, so deleting it is final.
 */
export function isWebStoreId(extId: string): boolean {
  return /^[a-p]{32}$/.test(extId)
}

/**
 * Whether `target` really sits inside the browser's extension directory.
 *
 * The removal endpoint already refuses anything a fresh scan did not produce.
 * This is the second gate, and the one that does not depend on the scan being
 * correct: a resolved path outside these roots is never deleted, whatever
 * claimed to have found it.
 */
export function isExtensionPath(browser: string, target: string): boolean {
  const roots = EXTENSION_ROOTS[browser]
  if (!roots)
    return false

  const resolved = path.resolve(target)
  return roots.some(root => resolved.startsWith(`${root}${path.sep}`))
}

/** Size of one extension on disk: a directory for Chromium, a file for Firefox. */
export function extensionSize(target: string): number {
  const stat = safeStat(target)
  if (!stat)
    return 0
  if (!stat.isDirectory())
    return stat.size

  let total = 0
  const stack = [target]

  while (stack.length > 0) {
    const dir = stack.pop()!
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    }
    catch {
      continue
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      try {
        if (entry.isDirectory())
          stack.push(full)
        else if (entry.isFile())
          total += fs.statSync(full).size
      }
      catch {
        // Unreadable entries contribute nothing rather than failing the size.
      }
    }
  }

  return total
}

/** Every installed extension, with its size on disk. */
export function sizeExtensions(extensions: ExtensionInfo[]): Record<string, number> {
  const sizes: Record<string, number> = {}
  for (const extension of extensions)
    sizes[extension.id] = extensionSize(extension.path)
  return sizes
}

export interface ExtensionRemovalTarget extends ExtensionInfo {
  sizeBytes: number
  sizeFormatted: string
  /**
   * True when the browser could reinstall this from a sync account after it is
   * deleted — see the note at the top of this file.
   */
  mayReturn: boolean
}

export interface ExtensionRemovalOutcome {
  removed: Array<{ id: string, name: string, browser: string, mayReturn: boolean }>
  skipped: Array<{ id: string, reason: string }>
  failed: Array<{ id: string, error: string }>
  freedBytes: number
  freedFormatted: string
}

/**
 * Delete the files of every extension named, if its browser is closed.
 *
 * Ids are resolved against a fresh scan rather than trusted from the caller, so
 * the endpoint cannot be turned into "delete any path you name" — the same rule
 * the uninstaller and the orphan sweep use.
 */
export async function removeExtensions(ids: string[]): Promise<ExtensionRemovalOutcome> {
  const wanted = new Set(ids)
  const installed = getAllExtensions().filter(extension => wanted.has(extension.id))
  const busy = new Set(await runningBrowsers())

  const outcome: ExtensionRemovalOutcome = {
    removed: [],
    skipped: [],
    failed: [],
    freedBytes: 0,
    freedFormatted: '0 B',
  }

  const found = new Set(installed.map(extension => extension.id))
  for (const id of wanted) {
    if (!found.has(id))
      outcome.skipped.push({ id, reason: 'No longer installed — the list is out of date' })
  }

  for (const extension of installed) {
    const blocked = blockedByRunningBrowser(extension.browser, busy, 'remove')
    if (blocked) {
      outcome.skipped.push({ id: extension.id, reason: blocked })
      continue
    }

    if (!isExtensionPath(extension.browser, extension.path)) {
      outcome.skipped.push({ id: extension.id, reason: 'Not inside a known browser extension folder' })
      continue
    }

    const size = extensionSize(extension.path)

    try {
      fs.rmSync(extension.path, { recursive: true, force: true })

      // Firefox keeps its own registry beside the files, and an entry with no
      // xpi behind it shows up as a broken add-on until it is pruned. Chromium
      // registers extensions in a MAC-protected file that must not be edited —
      // see the note at the top of this file.
      if (extension.browser === 'Firefox')
        pruneFirefoxRegistry(extension.path, extension.extId)

      outcome.freedBytes += size
      outcome.removed.push({
        id: extension.id,
        name: extension.name,
        browser: extension.browser,
        mayReturn: extension.browser !== 'Firefox' && isWebStoreId(extension.extId),
      })
    }
    catch (err) {
      outcome.failed.push({ id: extension.id, error: err instanceof Error ? err.message : String(err) })
    }
  }

  outcome.freedFormatted = formatBytes(outcome.freedBytes)
  return outcome
}

/**
 * Drop an add-on from Firefox's `extensions.json`.
 *
 * Best effort on purpose: a malformed or unexpected registry is left exactly as
 * it was. Firefox recovers from an entry whose file is missing on its own, so
 * failing to prune costs a stale row, while writing a broken registry would
 * cost the profile.
 */
function pruneFirefoxRegistry(xpiPath: string, extId: string): void {
  // `<profile>/extensions/<id>.xpi` → `<profile>/extensions.json`
  const profileDir = path.dirname(path.dirname(xpiPath))
  const registry = path.join(profileDir, 'extensions.json')

  try {
    const raw = fs.readFileSync(registry, 'utf8')
    const parsed = JSON.parse(raw) as { addons?: Array<{ id?: string }> }
    if (!Array.isArray(parsed.addons))
      return

    const kept = parsed.addons.filter(addon => addon.id !== extId)
    if (kept.length === parsed.addons.length)
      return

    fs.writeFileSync(registry, JSON.stringify({ ...parsed, addons: kept }), 'utf8')
  }
  catch {
    // Unreadable, unparseable, or unwritable. Leave it alone.
  }
}
