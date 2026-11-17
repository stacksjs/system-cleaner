import { describe, expect, it } from 'bun:test'
import { DAY_MS, shouldAnnounce, shouldCheck } from '../resources/lib/update-schedule'

const now = Date.parse('2026-11-17T12:00:00Z')
const ago = (ms: number): string => new Date(now - ms).toISOString()

describe('automatic update check', () => {
  it('never asks while the switch is off', () => {
    expect(shouldCheck({ enabled: false, lastCheckedAt: '', now })).toBe(false)
  })

  it('asks on a first launch, then at most once a day', () => {
    expect(shouldCheck({ enabled: true, lastCheckedAt: '', now })).toBe(true)
    expect(shouldCheck({ enabled: true, lastCheckedAt: ago(DAY_MS - 60_000), now })).toBe(false)
    expect(shouldCheck({ enabled: true, lastCheckedAt: ago(DAY_MS + 60_000), now })).toBe(true)
  })

  it('never asks from a build that cannot update itself', () => {
    expect(shouldCheck({ enabled: true, lastCheckedAt: '', stage: 'unsupported', now })).toBe(false)
  })
})

describe('update notification', () => {
  it('speaks once per version, and only when asked to', () => {
    expect(shouldAnnounce({ enabled: true, stage: 'available', version: '0.4.0', notifiedVersion: '' })).toBe(true)
    expect(shouldAnnounce({ enabled: true, stage: 'available', version: '0.4.0', notifiedVersion: '0.4.0' })).toBe(false)
    expect(shouldAnnounce({ enabled: false, stage: 'available', version: '0.4.0', notifiedVersion: '' })).toBe(false)
  })

  it('stays quiet when there is nothing new on offer', () => {
    expect(shouldAnnounce({ enabled: true, stage: 'up-to-date', version: null, notifiedVersion: '' })).toBe(false)
    expect(shouldAnnounce({ enabled: true, stage: 'ready', version: '0.4.0', notifiedVersion: '' })).toBe(false)
  })
})
