import { describe, expect, it } from 'bun:test'
import * as path from 'node:path'
import process from 'node:process'
import { buildWinPaths, capabilities, HOME, isPathSafe, macPaths, PLATFORM, supports, unsupportedReason } from '@system-cleaner/core'

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

/**
 * The gate drives the built bundle, not the source, because what ships is
 * public/platform-gate.js and the bundler sits between the two.
 */
describe('the platform gate replaces a screen that cannot work', () => {
  const ALL_OFF = {
    cleanTargets: false, diskScan: false, developerJunk: false, appUninstall: false,
    startupItems: false, privacy: false, maintenance: false, processes: false, trash: false,
  }

  async function run(pathname: string, platform: string, caps: Record<string, boolean>, ok = true) {
    const src = await Bun.file('public/platform-gate.js').text()
    const main = {
      _html: '<table>real content</table>',
      _attrs: {} as Record<string, string>,
      getAttribute(k: string) { return this._attrs[k] ?? null },
      setAttribute(k: string, v: string) { this._attrs[k] = v },
      removeAttribute(k: string) { delete this._attrs[k] },
      set innerHTML(v: string) { this._html = v },
      get innerHTML() { return this._html },
    }
    const win = {
      location: { pathname },
      addEventListener() {},
      MutationObserver: class { observe() {} },
    }
    const doc = {
      readyState: 'complete',
      addEventListener() {},
      querySelector: (s: string) => (s === '[data-stx-content]' ? main : null),
    }
    const fetchStub = async () => ({
      json: async () => (ok ? { success: true, platform, capabilities: caps } : { success: false }),
    })
    // eslint-disable-next-line no-new-func
    new Function('window', 'document', 'fetch', 'MutationObserver', src)(win, doc, fetchStub, win.MutationObserver)
    await new Promise(r => setTimeout(r, 60))
    return main
  }

  it('replaces an unsupported screen and names the feature', async () => {
    const main = await run('/app/cleanup', 'windows', ALL_OFF)
    expect(main.getAttribute('data-platform-gated')).toBe('cleanTargets')
    expect(main.innerHTML).toContain('Quick Clean')
    expect(main.innerHTML).toContain('Windows')
    // The reassurance matters as much as the refusal: a cleaner that renders
    // an unexplained wall should say whether it touched anything.
    expect(main.innerHTML).toContain('No files were scanned')
  })

  it('leaves a supported screen completely alone', async () => {
    const main = await run('/app/cleanup', 'macos', { ...ALL_OFF, cleanTargets: true })
    expect(main.getAttribute('data-platform-gated')).toBeNull()
    expect(main.innerHTML).toBe('<table>real content</table>')
  })

  it('leaves an ungated route alone even when everything is off', async () => {
    const main = await run('/app', 'windows', ALL_OFF)
    expect(main.innerHTML).toBe('<table>real content</table>')
  })

  /**
   * An agent without the route is an older build, which only ever ran on
   * macOS. Gating on a missing endpoint would hide working features.
   */
  it('does nothing when the agent has no /platform route', async () => {
    const main = await run('/app/cleanup', 'windows', ALL_OFF, false)
    expect(main.innerHTML).toBe('<table>real content</table>')
  })
})

/**
 * `isPathSafe` is the one gate every destructive route passes through -
 * /delete-path, /shred-paths and bulkDelete all call it - and on Windows it
 * had no opinion about anything.
 *
 * Two faults, both found by the Windows CI leg on its first run:
 * the protected set listed `/System` and `/usr`, which do not exist there, so
 * nothing was protected; and the sensitive-segment scan split on '/', which on
 * a backslash path returns one segment and therefore matches nothing. An
 * `.ssh` directory passed the check completely, and Git for Windows puts keys
 * in ~/.ssh exactly like everywhere else.
 *
 * The Windows cases run on the windows-latest leg. The macOS ones pin the
 * behaviour that must not move while fixing them.
 */
describe('path safety is written for the platform it runs on', () => {
  it('refuses the home directory itself, everywhere', () => {
    expect(isPathSafe(HOME).safe).toBe(false)
  })

  it('refuses a sensitive directory wherever the separator falls', () => {
    const key = path.join(HOME, '.ssh', 'id_rsa')
    const check = isPathSafe(key)
    expect(check.safe, `${key} must never be deletable`).toBe(false)
  })

  it('refuses the system roots for this platform', () => {
    const roots = PLATFORM === 'windows'
      ? [process.env.SystemRoot || 'C:\\Windows', process.env.ProgramFiles || 'C:\\Program Files']
      : ['/System', '/usr', '/Library']
    for (const root of roots)
      expect(isPathSafe(root).safe, `${root} must be protected`).toBe(false)
  })

  it('still allows an ordinary cache directory', () => {
    // The app's whole job. A gate that refuses everything is as broken as one
    // that refuses nothing.
    const cache = PLATFORM === 'windows'
      ? path.join(process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local'), 'SomeApp', 'Cache')
      : path.join(HOME, 'Library', 'Caches', 'com.example.app')
    const check = isPathSafe(cache)
    // It may not exist on this machine, in which case the refusal is "Path
    // does not exist" rather than a safety verdict - which is still a pass for
    // what this test is about.
    if (!check.safe)
      expect(check.reason).toBe('Path does not exist')
  })

  it('treats a backslash as a separator only on Windows', () => {
    if (PLATFORM === 'windows') return
    // A backslash is a legal character in a macOS filename. Splitting on it
    // here would make this read as a path containing an `.ssh` segment.
    const odd = path.join(HOME, 'Library', 'Caches', 'notes\\.ssh')
    const check = isPathSafe(odd)
    if (!check.safe)
      expect(check.reason, 'a literal backslash must not read as a separator').not.toContain('sensitive directory')
  })

  it('folds case on Windows and does not on macOS', () => {
    if (PLATFORM !== 'windows') return
    const upper = path.join(HOME, '.SSH', 'id_rsa')
    expect(isPathSafe(upper).safe, 'Windows paths are case-insensitive').toBe(false)
  })
})
