import { describe, expect, it } from 'bun:test'
import { describeMacosRelease, isBetaBuild, parseSoftwareUpdateList, parseUpdateBuild } from '@system-cleaner/core'

/**
 * Telling one macOS beta from another.
 *
 * `sw_vers -productVersion` reports `27.0` on every beta of 27.0 and on the
 * release itself, so an updates screen built on it says "macOS 27.0, 1 update
 * available" and leaves the reader with no way to tell which beta they are on
 * or which one is being offered. The build number is the only local signal:
 * Apple numbers pre-release builds from 5000 up.
 */

describe('isBetaBuild', () => {
  it('recognises a pre-release build', () => {
    expect(isBetaBuild('26A5416b')).toBe(true)
    expect(isBetaBuild('26A5421a')).toBe(true)
    expect(isBetaBuild('24A5264n')).toBe(true)
  })

  it('recognises a shipped build', () => {
    expect(isBetaBuild('26A335')).toBe(false)
    expect(isBetaBuild('23B81')).toBe(false)
    // 4999 is the last non-beta number in Apple's scheme; 5000 is the first beta.
    expect(isBetaBuild('26A4999')).toBe(false)
    expect(isBetaBuild('26A5000')).toBe(true)
  })

  it('says no rather than guessing when there is no build to read', () => {
    expect(isBetaBuild(null)).toBe(false)
    expect(isBetaBuild(undefined)).toBe(false)
    expect(isBetaBuild('')).toBe(false)
    expect(isBetaBuild('not-a-build')).toBe(false)
  })
})

describe('describeMacosRelease', () => {
  it('names the build and the beta, because the version alone cannot', () => {
    expect(describeMacosRelease('27.0', '26A5416b')).toEqual({
      version: '27.0',
      build: '26A5416b',
      beta: true,
      label: '27.0 (26A5416b, beta)',
    })
  })

  it('names the build but not a beta on a shipped release', () => {
    expect(describeMacosRelease('26.4', '25E248').label).toBe('26.4 (25E248)')
  })

  it('falls back to the bare version when the build is unavailable', () => {
    expect(describeMacosRelease('27.0', null).label).toBe('27.0')
  })
})

describe('parseUpdateBuild', () => {
  it('reads the target build off a softwareupdate label', () => {
    expect(parseUpdateBuild('macOS 27 Beta 7-26A5421a')).toBe('26A5421a')
    expect(parseUpdateBuild('macOS Sequoia 15.3.1-24D70')).toBe('24D70')
  })

  it('returns null for a label carrying no build', () => {
    expect(parseUpdateBuild('Command Line Tools for Xcode 27.0 beta 6-27.0')).toBeNull()
    expect(parseUpdateBuild('Safari')).toBeNull()
  })
})

describe('parseSoftwareUpdateList', () => {
  // Real output from a Mac on 27.0 beta 6, where both entries claim
  // "Version: 27.0" and only the label distinguishes them.
  const output = `Software Update Tool

Software Update found the following new or updated software:
* Label: Command Line Tools for Xcode 27.0 beta 6-27.0
\tTitle: Command Line Tools for Xcode 27.0 beta 6, Version: 27.0, Size: 518467KiB, Recommended: YES,
* Label: macOS 27 Beta 7-26A5421a
\tTitle: macOS 27 Beta 7, Version: 27.0, Size: 2825153KiB, Recommended: YES, Action: restart,
`

  it('carries the target build through to each update', () => {
    const updates = parseSoftwareUpdateList(output)
    const macos = updates.find(u => u.kind === 'macos')

    expect(macos?.buildVersion).toBe('26A5421a')
    // Without the build these two rows both read "27.0", which is why the
    // build has to reach the UI.
    expect(macos?.version).toBe('27.0')
  })

  it('leaves the build null when the label has none', () => {
    const updates = parseSoftwareUpdateList(output)
    expect(updates.find(u => u.kind === 'cltools')?.buildVersion).toBeNull()
  })
})
