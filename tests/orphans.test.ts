import { describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { readAppInfoPlist } from '@system-cleaner/core'
import { findOrphanedAppData, KNOWN_APP_DIRS, SYSTEM_DIR_NAMES } from '@system-cleaner/clean'

/**
 * These guard the Application Support scan added for #26.
 *
 * The risk this feature carries is not missing an orphan — it is reporting
 * live data as one. Chrome keeps 7.7 GB of profile (history, bookmarks,
 * saved passwords) in a directory called `Google`, which matches no installed
 * app name; `MobileSync` holds every iPhone backup on the machine and has no
 * owning `.app` at all. Both must stay unreachable from this scan.
 */
describe('orphan attribution', () => {
  it('maps vendor directory names to the apps that actually own them', () => {
    // The directory name is not the app name for any of these, which is the
    // whole reason the map exists.
    expect(KNOWN_APP_DIRS.Google).toContain('Google Chrome')
    expect(KNOWN_APP_DIRS.Mozilla).toContain('Firefox')
    expect(KNOWN_APP_DIRS.BraveSoftware).toContain('Brave Browser')
    expect(KNOWN_APP_DIRS.Code).toContain('Visual Studio Code')
  })

  it('treats macOS-owned directories as system data, not orphans', () => {
    // None of these has an owning `.app`, so any "is the app installed?"
    // test reports them as orphaned unless they are excluded outright.
    for (const name of ['mobilesync', 'addressbook', 'clouddocs', 'knowledge', 'fileprovider'])
      expect(SYSTEM_DIR_NAMES.has(name)).toBe(true)
  })

  it('has no directory listed as both system-owned and app-owned', () => {
    for (const dir of Object.keys(KNOWN_APP_DIRS))
      expect(SYSTEM_DIR_NAMES.has(dir.toLowerCase())).toBe(false)
  })
})

describe('findOrphanedAppData', () => {
  it('never reports a directory whose owning app is installed', async () => {
    const items = await findOrphanedAppData()
    const reported = new Set(items.map(item => item.bundleId))

    // Walk the map rather than hardcoding app names: whatever is installed on
    // the machine running the suite, its support directory must not appear.
    for (const [dir, owners] of Object.entries(KNOWN_APP_DIRS)) {
      const installed = owners.some(owner =>
        ['/Applications', `${process.env.HOME}/Applications`]
          .some(base => Bun.file(`${base}/${owner}.app/Contents/Info.plist`).size > 0),
      )
      if (installed)
        expect(reported.has(dir)).toBe(false)
    }
  }, 120_000)

  it('never reports a macOS-owned directory', async () => {
    const items = await findOrphanedAppData()
    for (const item of items)
      expect(SYSTEM_DIR_NAMES.has(item.bundleId.toLowerCase())).toBe(false)
  }, 120_000)

  /**
   * Nothing in /Applications is an orphan, whatever Spotlight thinks.
   *
   * `getInstalledApps` asked `mdfind` and nothing else. An index can be
   * stale or partial, and here it was: the query returned 290 bundles of
   * which one was in /Applications, while 44 were installed there. Firefox,
   * Notion, Postman and TeamViewer were all running and all reported as
   * uninstalled, so their Application Support directories appeared on the
   * Leftover Data screen with a delete button.
   *
   * The `appNames.size === 0` guard did not catch it — that covers Spotlight
   * being off, and a partial index still returns plenty of names. The test
   * above only fails on a machine whose index happens to be broken; this one
   * states the invariant directly, so a healthy machine asserts it too.
   */
  it('never reports an app that is sitting in /Applications', async () => {
    const installed = new Set<string>()
    for (const entry of fs.readdirSync('/Applications')) {
      if (!entry.endsWith('.app')) continue
      try {
        const info = readAppInfoPlist(path.join('/Applications', entry))
        const bundleId = info.CFBundleIdentifier
        if (typeof bundleId === 'string' && bundleId)
          installed.add(bundleId.toLowerCase())
      }
      catch { /* unreadable bundle; the name-based cases cover it */ }
    }

    // Guard against the loop above finding nothing and asserting nothing.
    expect(installed.size).toBeGreaterThan(0)

    const items = await findOrphanedAppData()
    const wrong = items.filter(item => installed.has(item.bundleId.toLowerCase()))
    expect(wrong.map(item => item.path)).toEqual([])
  }, 120_000)

  it('marks Application Support and Container hits as holding user data', async () => {
    const items = await findOrphanedAppData()
    for (const item of items) {
      if (item.type === 'app-support' || item.type === 'container')
        expect(item.holdsUserData).toBe(true)
      if (item.type === 'cache' || item.type === 'log')
        expect(item.holdsUserData).toBe(false)
    }
  }, 120_000)
})
