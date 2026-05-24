import { describe, expect, it } from 'bun:test'
import { isNewerVersion, normalizePkgVersion, parseSoftwareUpdateList } from '../src/updates'

describe('parseSoftwareUpdateList', () => {
  it('returns empty for no updates', () => {
    expect(parseSoftwareUpdateList('Software Update Tool\n\nNo new software available.')).toEqual([])
  })

  it('parses Command Line Tools updates', () => {
    const output = `Software Update Tool

Software Update found the following new or updated software:
* Label: Command Line Tools for Xcode 26.5-26.5
	Title: Command Line Tools for Xcode 26.5, Version: 26.5, Size: 920416KiB, Recommended: YES, 
`
    const updates = parseSoftwareUpdateList(output)
    expect(updates).toHaveLength(1)
    expect(updates[0].kind).toBe('cltools')
    expect(updates[0].title).toBe('Command Line Tools for Xcode 26.5')
    expect(updates[0].version).toBe('26.5')
    expect(updates[0].recommended).toBe(true)
    expect(updates[0].sizeBytes).toBeGreaterThan(900_000_000)
  })

  it('parses macOS updates with restart flag', () => {
    const output = `* Label: macOS Tahoe 26.5-25F71
	Title: macOS Tahoe 26.5, Version: 26.5, Size: 17872251KiB, Recommended: YES, Action: restart,
`
    const updates = parseSoftwareUpdateList(output)
    expect(updates).toHaveLength(1)
    expect(updates[0].kind).toBe('macos')
    expect(updates[0].restartRequired).toBe(true)
  })

  it('parses multiple updates', () => {
    const output = `* Label: Safari 26.5-12345
	Title: Safari, Version: 26.5, Size: 204800KiB, Recommended: YES,
* Label: Command Line Tools for Xcode 26.5-26.5
	Title: Command Line Tools for Xcode 26.5, Version: 26.5, Size: 920416KiB, Recommended: YES,
`
    const updates = parseSoftwareUpdateList(output)
    expect(updates).toHaveLength(2)
    expect(updates.map(u => u.kind)).toEqual(['safari', 'cltools'])
  })
})

describe('isNewerVersion', () => {
  it('compares semver-like strings', () => {
    expect(isNewerVersion('26.5', '26.4.1')).toBe(true)
    expect(isNewerVersion('26.4.1', '26.5')).toBe(false)
    expect(isNewerVersion('1.10.0', '1.9.0')).toBe(true)
  })
})

describe('normalizePkgVersion', () => {
  it('strips build suffix from pkgutil versions', () => {
    expect(normalizePkgVersion('26.4.1.0.1775747724')).toBe('26.4.1')
  })
})
