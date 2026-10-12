import { describe, expect, it } from 'bun:test'
import * as path from 'node:path'
import process from 'node:process'
import { capabilities, PLATFORM } from '@system-cleaner/core'
import { BROWSER_PROBE_FAILED, blockedByRunningBrowser, detectBrowserProfiles, runningBrowsers } from '../packages/clean/src/browser'
import { scanPrivacyItems } from '../packages/clean/src/privacy'

/**
 * Privacy on Windows.
 *
 * The feature is pure filesystem work — `privacy.ts` shells out nowhere — so
 * what stood between it and Windows was the paths, and one safety check that
 * would have failed in the dangerous direction.
 *
 * `runningBrowsers` asked `pgrep` whether each browser was open. There is no
 * `pgrep` on Windows, and `exec` runs everything through `sh -c`, which is not
 * there either: the probe returned nothing, nothing read as "no browser is
 * open", and every clean would have been permitted against a live profile.
 * This module's own first rule is that writing into one does not clear
 * history, it corrupts the profile, and the damage surfaces at the next launch
 * long after anyone would connect it to this app.
 *
 * It failed open on macOS too, just more rarely: `pgrep` exits 1 when it
 * matches nothing and 127 when it is missing, and both produced empty output.
 *
 * See stacksjs/system-cleaner#23.
 */

describe('the browser gate fails closed', () => {
  it('refuses when the probe could not answer', () => {
    const blocked = blockedByRunningBrowser('Chrome', [BROWSER_PROBE_FAILED], 'clear')
    expect(blocked).not.toBeNull()
    // And says which it is, rather than naming a browser that may not even be
    // installed.
    expect(blocked).toContain('Could not tell')
  })

  it('refuses for both actions, not just cleaning', () => {
    expect(blockedByRunningBrowser('Chrome', [BROWSER_PROBE_FAILED], 'remove')).not.toBeNull()
  })

  it('still permits a browser that is genuinely closed', () => {
    // A gate that refuses everything is as useless as one that refuses
    // nothing.
    expect(blockedByRunningBrowser('Chrome', ['Firefox'], 'clear')).toBeNull()
    expect(blockedByRunningBrowser('Chrome', [], 'clear')).toBeNull()
  })

  it('still names the browser when one really is open', () => {
    expect(blockedByRunningBrowser('Chrome', ['Chrome'], 'clear')).toContain('Quit Chrome')
  })
})

describe('runningBrowsers', () => {
  it('answers without a shell, on whichever platform this is', async () => {
    const running = await runningBrowsers()
    expect(Array.isArray(running)).toBe(true)
    // The probe must actually work here. A sentinel on a healthy machine means
    // the process list could not be read, which would block every clean.
    expect(running, 'the process probe failed on this machine').not.toContain(BROWSER_PROBE_FAILED)
  }, 15_000)

  it('reaches no shell to do it', async () => {
    const src = await Bun.file('packages/clean/src/browser.ts').text()
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    // `exec` wraps everything in `sh -c`, which Windows does not have.
    expect(code).not.toMatch(/\bexec\(/)
    expect(code).not.toMatch(/'(?:sh|bash|cmd(?:\.exe)?)'/)
  })
})

describe('browser profiles resolve for this platform', () => {
  it('names absolute paths and never a foreign platform root', () => {
    for (const profile of detectBrowserProfiles()) {
      expect(path.isAbsolute(profile.profilePath) || path.win32.isAbsolute(profile.profilePath), profile.profilePath).toBe(true)
      for (const group of [profile.cachePaths, profile.cookiePaths, profile.historyPaths])
        expect(group.length, `${profile.browser} has no paths in a group`).toBeGreaterThan(0)

      if (PLATFORM === 'windows')
        expect(profile.profilePath, 'a macOS path leaked into a Windows profile').not.toContain('/Library/')
    }
  })

  it('finds Chromium profiles under the Windows profile roots', () => {
    if (PLATFORM !== 'windows') return
    const local = (process.env.LOCALAPPDATA || '').toLowerCase()
    const roaming = (process.env.APPDATA || '').toLowerCase()

    for (const profile of detectBrowserProfiles()) {
      const p = profile.profilePath.toLowerCase()
      expect(p.startsWith(local) || p.startsWith(roaming), `${profile.browser}: ${profile.profilePath}`).toBe(true)
    }
  })
})

describe('system privacy items follow the platform', () => {
  // Ids carry a source prefix - `macos::shell-history` - so these match on the
  // suffix. The first version of this compared against the bare id, found
  // nothing, and passed without asserting anything at all.
  const systemItems = () => scanPrivacyItems().filter(i => i.kind === 'system')
  const bySuffix = (suffix: string) => systemItems().find(i => i.id.endsWith(suffix))

  it('finds the system items at all', () => {
    // Guards every other assertion here against passing vacuously.
    expect(systemItems().length, 'no system privacy items were produced').toBeGreaterThan(0)
  })

  it('names them for the system they came from', () => {
    // The prefix was a hardcoded `macos::`, which would have labelled a
    // Windows machine's PowerShell history as a macOS item - in the id the UI
    // keys its selections off.
    const expected = PLATFORM === 'windows' ? 'windows::' : 'macos::'
    for (const item of systemItems()) {
      expect(item.id.startsWith(expected), `${item.id} should start with ${expected}`).toBe(true)
      expect(item.browser).toBe(PLATFORM === 'windows' ? 'Windows' : 'macOS')
    }
  })

  it('offers only what this platform actually has', () => {
    const quarantine = bySuffix('quarantine-log')

    if (PLATFORM === 'windows') {
      // Windows records a download's origin in a Zone.Identifier stream per
      // file rather than one log, so there is nothing to clear - and a path
      // invented to fill the gap would clear something else.
      expect(quarantine, 'macOS-only item offered on Windows').toBeUndefined()
    }
    else {
      expect(quarantine, 'the macOS download log should be offered here').toBeDefined()
    }
  })

  it('points shell history at the history this platform keeps', () => {
    const shell = bySuffix('shell-history')
    expect(shell, 'shell history is offered on every platform').toBeDefined()

    const joined = shell!.paths.join(' ')
    if (PLATFORM === 'windows')
      expect(joined, 'PowerShell history is the one that matters here').toContain('ConsoleHost_history.txt')
    else
      expect(joined).toContain('.zsh_history')
  })
})

describe('the capability map', () => {
  it('claims privacy only where the paths and the gate exist', () => {
    if (PLATFORM === 'windows')
      expect(capabilities.privacy).toBe(true)
  })
})
