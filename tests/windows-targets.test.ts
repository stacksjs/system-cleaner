import { describe, expect, it } from 'bun:test'
import * as path from 'node:path'
import process from 'node:process'
import { isCleanable, isPathSafe, PLATFORM } from '@system-cleaner/core'
import { buildWindowsTargets } from '../packages/clean/src/categories-windows'
import { CLEAN_TARGETS } from '../packages/clean/src/categories'

/**
 * The Windows Quick Clean table.
 *
 * Driven through `buildWindowsTargets(env)` rather than the exported array, so
 * the real Windows shapes can be asserted from any platform. Built from
 * `process.env` on macOS the table is a set of hybrid nonsense paths —
 * `/Users/glenn/AppData/Local\npm-cache` — harmless, because the selector
 * never picks it off Windows, but useless to test.
 *
 * The promise this file enforces is the one in the table's own header: every
 * entry is user-scope. The admin-scope wins are absent on purpose, because the
 * agent cannot elevate and a Clean button that can only ever fail is worse
 * than an absent one.
 *
 * See stacksjs/system-cleaner#23.
 */

const ENV = {
  USERPROFILE: 'C:\\Users\\glenn',
  LOCALAPPDATA: 'C:\\Users\\glenn\\AppData\\Local',
  APPDATA: 'C:\\Users\\glenn\\AppData\\Roaming',
  PROGRAMDATA: 'C:\\ProgramData',
  ProgramFiles: 'C:\\Program Files',
  SystemRoot: 'C:\\Windows',
  SystemDrive: 'C:',
  TEMP: 'C:\\Users\\glenn\\AppData\\Local\\Temp',
}

const targets = buildWindowsTargets(ENV)

describe('the windows table', () => {
  it('has entries, and enough of them to be worth shipping', () => {
    // A table with a handful of entries renders as "0 B recoverable" on most
    // machines, which is the empty result the capability gate exists to avoid.
    expect(targets.length).toBeGreaterThan(50)
  })

  it('has unique ids', () => {
    const ids = targets.map(t => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gives every entry a name, category and description', () => {
    for (const target of targets) {
      expect(target.name.length, target.id).toBeGreaterThan(0)
      expect(target.category.length, target.id).toBeGreaterThan(0)
      expect(target.description.length, target.id).toBeGreaterThan(0)
    }
  })

  it('names only absolute Windows paths', () => {
    for (const target of targets)
      expect(path.win32.isAbsolute(target.path), `${target.id} = ${target.path}`).toBe(true)
  })

  /**
   * A path built from an undefined environment variable is a *relative* path
   * rooted at the CWD — which, in a tool that deletes what it scans, points
   * the cleaner at whatever directory the agent happens to have been started
   * from.
   */
  it('stays absolute even when the environment is empty', () => {
    for (const target of buildWindowsTargets({}))
      expect(path.win32.isAbsolute(target.path) || path.isAbsolute(target.path), `${target.id} = ${target.path}`).toBe(true)
  })

  it('never leaks a macOS path', () => {
    for (const target of targets) {
      expect(target.path, `${target.id} leaked a Library path`).not.toContain('/Library/')
      expect(target.path, `${target.id} leaked a POSIX separator`).not.toContain('/')
    }
  })

  /**
   * The table's central promise. Anything outside these three roots needs
   * administrator rights the agent does not have, so it would list a Clean
   * button that can only ever fail.
   */
  it('keeps every entry inside the user profile', () => {
    const roots = [ENV.LOCALAPPDATA, ENV.APPDATA, ENV.USERPROFILE].map(r => r.toLowerCase())
    for (const target of targets) {
      const p = target.path.toLowerCase()
      const inside = roots.some(root => p === root || p.startsWith(`${root}\\`))
      expect(inside, `${target.id} = ${target.path} is not under the user profile`).toBe(true)
    }
  })

  it('never names a system root or a bare profile root', () => {
    const forbidden = new Set([
      'c:\\', 'c:\\windows', 'c:\\program files', 'c:\\programdata', 'c:\\users',
      ENV.USERPROFILE.toLowerCase(), ENV.LOCALAPPDATA.toLowerCase(), ENV.APPDATA.toLowerCase(),
    ])
    const offenders = targets.filter(t => forbidden.has(t.path.toLowerCase())).map(t => t.id)
    expect(offenders).toEqual([])
  })

  it('classifies the risk of every entry', () => {
    for (const target of targets)
      expect(['safe', 'caution'], target.id).toContain(target.risk)
  })

  /**
   * The same ids as the macOS table, because these tools are cross-platform
   * and the UI copy, the shared tests and the schedule specs all key off the
   * id rather than the path.
   */
  it('marks the stores nothing rebuilds as caution', () => {
    const mustBeCaution = ['claude-code-projects', 'codex-sessions', 'codex-archived-sessions', 'ollama-models', 'lmstudio-models', 'vagrant-boxes']
    for (const id of mustBeCaution) {
      const target = targets.find(t => t.id === id)
      expect(target, `${id} is missing from the Windows table`).toBeDefined()
      expect(target!.risk, id).toBe('caution')
    }
  })

  it('leaves plain caches safe', () => {
    for (const id of ['user-temp', 'npm-cache', 'chrome-cache']) {
      const target = targets.find(t => t.id === id)
      expect(target, `${id} is missing`).toBeDefined()
      expect(target!.risk, id).toBe('safe')
    }
  })

  /**
   * A Chromium cache directory sits one level below the profile, and the
   * profile holds history, logins and extensions. An entry that drifted up a
   * level would take all of it.
   */
  it('points browser entries at a cache, never at a whole profile', () => {
    for (const target of targets.filter(t => t.category === 'browser')) {
      if (target.id === 'firefox-cache') continue
      const tail = target.path.toLowerCase()
      const ok = tail.includes('cache') || tail.includes('cachestorage')
      expect(ok, `${target.id} = ${target.path} is not a cache directory`).toBe(true)
    }
  })

  it('removes contents rather than the directory for the ones apps expect to exist', () => {
    for (const id of ['user-temp', 'npm-cache']) {
      // %TEMP% itself going missing breaks installers and half the
      // toolchains on the machine.
      expect(targets.find(t => t.id === id)!.contentsOnly, id).toBe(true)
    }
  })
})

describe('the platform selector', () => {
  it('serves the table for the platform it is running on', () => {
    const ids = new Set(CLEAN_TARGETS.map(t => t.id))
    if (PLATFORM === 'windows') {
      expect(ids.has('user-temp'), 'Windows must get the Windows table').toBe(true)
      expect(ids.has('user-caches'), 'the macOS table must not be served on Windows').toBe(false)
    }
    else {
      expect(ids.has('user-caches'), 'macOS and Linux keep the macOS table').toBe(true)
      expect(ids.has('user-temp')).toBe(false)
    }
  })
})

/**
 * Only meaningful on the Windows leg, where HOME and the environment are real.
 * A target the guards refuse is a row in the UI with a button that cannot
 * work, which is the thing this whole platform effort is trying not to ship.
 */
describe('every windows target survives the safety guards', () => {
  it('is cleanable, or refused only for not existing', () => {
    if (PLATFORM !== 'windows') return

    const refused: string[] = []
    for (const target of CLEAN_TARGETS) {
      const check = isCleanable(target.path)
      // "Path does not exist" is the expected answer for most of these on any
      // given machine: nobody has all six browsers and every toolchain.
      if (!check.safe && check.reason !== 'Path does not exist')
        refused.push(`${target.id}: ${check.reason}`)
    }
    expect(refused).toEqual([])
  })

  it('is never a path the delete gate protects', () => {
    if (PLATFORM !== 'windows') return

    const protectedPaths: string[] = []
    for (const target of CLEAN_TARGETS) {
      const check = isPathSafe(target.path)
      if (!check.safe && check.reason !== 'Path does not exist' && !check.reason?.includes('symbolic'))
        protectedPaths.push(`${target.id}: ${check.reason}`)
    }
    expect(protectedPaths).toEqual([])
  })

  it('agrees with the environment it is running in', () => {
    if (PLATFORM !== 'windows') return
    const localAppData = process.env.LOCALAPPDATA!
    const npm = CLEAN_TARGETS.find(t => t.id === 'npm-cache')!
    expect(npm.path.toLowerCase().startsWith(localAppData.toLowerCase())).toBe(true)
  })
})
