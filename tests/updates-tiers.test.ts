import { describe, expect, it } from 'bun:test'
import { updatesCacheKey } from '../routes/updates-check'

/**
 * Keeping a quick tier from answering for a full one.
 *
 * The Updates page loads in two passes: a `quick` call that skips desktop app
 * enumeration so the macOS and Homebrew numbers appear immediately, then a
 * `full` call that fills the Desktop Apps table. Deep Scan runs the same pair
 * with `fullScan: true`.
 *
 * When the key ignored the tier, that second pass hit the first pass's cache
 * entry and got back `desktopApps: []` — so Deep Scan reported "0 apps
 * scanned" and emptied a table that had just been correct.
 */
describe('updatesCacheKey', () => {
  it('never lets the two tiers share an entry', () => {
    for (const fullScan of [true, false])
      expect(updatesCacheKey(fullScan, 'quick')).not.toBe(updatesCacheKey(fullScan, 'full'))
  })

  it('never lets a scanned and an unscanned result share an entry', () => {
    for (const tier of ['quick', 'full'] as const)
      expect(updatesCacheKey(true, tier)).not.toBe(updatesCacheKey(false, tier))
  })

  it('gives all four combinations distinct keys', () => {
    const keys = [
      updatesCacheKey(false, 'quick'),
      updatesCacheKey(false, 'full'),
      updatesCacheKey(true, 'quick'),
      updatesCacheKey(true, 'full'),
    ]
    expect(new Set(keys).size).toBe(4)
  })

  it('leaves the full-scan full-tier key where getUpdatesSummary reads it', () => {
    expect(updatesCacheKey(true, 'full')).toBe('full')
  })
})
