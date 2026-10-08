import { describe, expect, it } from 'bun:test'
import * as path from 'node:path'
import { buildWinPaths, capabilities, macPaths, PLATFORM, supports, unsupportedReason } from '@system-cleaner/core'

/**
 * The app has to know what it cannot do.
 *
 * Today there is exactly one `process.platform` check in the whole codebase.
 * Everything else assumes macOS and shells out to `launchctl`, `mdfind`,
 * `osascript` and `diskutil`. On Windows those are not found, the error is
 * swallowed, and the screen renders an empty result — so Quick Clean reports
 * 0 B recoverable and the machine looks clean rather than unsupported. For a
 * tool whose whole claim is "here is what you can reclaim", answering "nothing"
 * when the truth is "I cannot see" is the worst available failure.
 *
 * These tests pin the two halves of the fix: a capability map that is honest
 * about what is implemented, and a Windows path map whose gaps are explicit
 * nulls rather than plausible-looking directories that nothing would find.
 *
 * See stacksjs/system-cleaner#23.
 */

describe('platform capabilities', () => {
  it('reports a platform it recognises', () => {
    expect(['macos', 'linux', 'windows', 'unsupported']).toContain(PLATFORM)
  })

  it('claims everything on macOS, which is the platform it was built against', () => {
    if (PLATFORM !== 'macos') return
    for (const [feature, enabled] of Object.entries(capabilities))
      expect(enabled, `${feature} on macOS`).toBe(true)
  })

  /**
   * The honesty check. Windows has no path or command layer yet, so every
   * capability must be false — a single true here is a screen that renders
   * and finds nothing.
   *
   * Flip these one at a time as each lands, and this test turns into the
   * record of what actually shipped.
   */
  it('claims nothing on Windows until the implementation exists', () => {
    if (PLATFORM !== 'windows') return
    for (const [feature, enabled] of Object.entries(capabilities))
      expect(enabled, `${feature} on Windows`).toBe(false)
  })

  it('claims only filesystem work on Linux', () => {
    if (PLATFORM !== 'linux') return
    expect(capabilities.diskScan).toBe(true)
    expect(capabilities.developerJunk).toBe(true)
    // These lean on launchctl, .app bundles and osascript.
    expect(capabilities.startupItems).toBe(false)
    expect(capabilities.appUninstall).toBe(false)
    expect(capabilities.maintenance).toBe(false)
  })

  it('gives a reason that names both the feature and the platform', () => {
    const reason = unsupportedReason('startupItems')
    expect(reason).toContain('Startup Items')
    expect(reason.length).toBeGreaterThan(20)
    // "Not supported" with no subject reads as a bug to anyone who has not
    // read the release notes.
    expect(reason).not.toBe('Not supported')
  })

  it('agrees with itself', () => {
    for (const feature of Object.keys(capabilities) as (keyof typeof capabilities)[])
      expect(supports(feature)).toBe(capabilities[feature])
  })
})

describe('windows paths', () => {
  const env = {
    USERPROFILE: 'C:\\Users\\glenn',
    LOCALAPPDATA: 'C:\\Users\\glenn\\AppData\\Local',
    APPDATA: 'C:\\Users\\glenn\\AppData\\Roaming',
    PROGRAMDATA: 'C:\\ProgramData',
    ProgramFiles: 'C:\\Program Files',
    SystemRoot: 'C:\\Windows',
    SystemDrive: 'C:',
    TEMP: 'C:\\Users\\glenn\\AppData\\Local\\Temp',
  }

  it('resolves the real Windows locations from the environment', () => {
    const w = buildWinPaths(env)
    expect(w.localAppData).toBe('C:\\Users\\glenn\\AppData\\Local')
    expect(w.roamingAppData).toBe('C:\\Users\\glenn\\AppData\\Roaming')
    expect(w.temp).toBe('C:\\Users\\glenn\\AppData\\Local\\Temp')
    expect(w.windowsTemp).toBe('C:\\Windows\\Temp')
    expect(w.prefetch).toBe('C:\\Windows\\Prefetch')
    expect(w.crashReports).toBe('C:\\Users\\glenn\\AppData\\Local\\CrashDumps')
    expect(w.recycleBin).toBe('C:\\$Recycle.Bin')
    expect(w.systemApplications).toBe('C:\\Program Files')
  })

  /**
   * Every fallback must be absolute. A bare `process.env.LOCALAPPDATA` on a
   * machine without it yields undefined, and a path built from undefined is a
   * relative path rooted at the CWD — which, in a tool that deletes what it
   * scans, points the cleaner at the repository it is running from.
   */
  it('falls back to absolute paths when the environment is empty', () => {
    const w = buildWinPaths({})
    for (const [key, value] of Object.entries(w)) {
      if (value === null) continue
      expect(path.win32.isAbsolute(value) || path.isAbsolute(value), `${key} = ${value}`).toBe(true)
    }
  })

  /**
   * The gaps are the point. Mapping "saved application state" onto some
   * plausible Windows folder would make the cleaner scan something that was
   * never the thing it meant.
   */
  it('returns null for concepts Windows does not have', () => {
    const w = buildWinPaths(env)
    const absent = ['libraryDir', 'logs', 'preferences', 'cookies', 'launchAgents',
      'savedState', 'httpStorages', 'webkit', 'containers', 'groupContainers',
      'systemLaunchAgents', 'systemLaunchDaemons'] as const
    for (const key of absent)
      expect(w[key], `${key} must be null, not a guess`).toBeNull()
  })

  it('never returns a macOS path', () => {
    const w = buildWinPaths(env)
    for (const [key, value] of Object.entries(w)) {
      if (value === null) continue
      expect(value, `${key} leaked a POSIX path`).not.toContain('/Library/')
      expect(value, `${key} leaked HOME`).not.toContain(macPaths.libraryDir)
    }
  })
})
