import { describe, expect, it } from 'bun:test'
import { needsConfirmation, scheduledRunAction, shouldNotifyAway } from '../resources/lib/interruptions'

describe('Confirm before deleting', () => {
  it('asks before a move to the Trash while the switch is on', () => {
    expect(needsConfirmation({ recoverable: true }, true)).toBe(true)
  })

  it('skips the question for a move to the Trash once it is off', () => {
    expect(needsConfirmation({ recoverable: true }, false)).toBe(false)
  })

  it('always asks before anything that cannot be put back', () => {
    expect(needsConfirmation({ recoverable: false }, false)).toBe(true)
    expect(needsConfirmation({}, false)).toBe(true)
  })
})

describe('When a long scan finishes', () => {
  const long = { elapsedMs: 45_000, focused: false }

  it('speaks after a long scan the user looked away from', () => {
    expect(shouldNotifyAway({ enabled: true, ...long })).toBe(true)
  })

  it('stays quiet once the switch is off', () => {
    expect(shouldNotifyAway({ enabled: false, ...long })).toBe(false)
  })

  it('stays quiet for a short scan or a window in front', () => {
    expect(shouldNotifyAway({ enabled: true, elapsedMs: 4_000, focused: false })).toBe(false)
    expect(shouldNotifyAway({ enabled: true, elapsedMs: 45_000, focused: true })).toBe(false)
    expect(shouldNotifyAway({ enabled: true, elapsedMs: 4_000, minMs: 2_000, focused: false })).toBe(true)
  })
})

describe('When scheduled cleaning runs', () => {
  const run = '2026-11-17T03:00:04.000Z'
  const earlier = '2026-11-10T03:00:02.000Z'

  it('announces a run nobody has seen, while the switch is on', () => {
    expect(scheduledRunAction({ enabled: true, lastRunAt: run, seenRunAt: earlier })).toBe('announce')
    expect(scheduledRunAction({ enabled: true, lastRunAt: run, seenRunAt: '' })).toBe('announce')
  })

  it('notes the run without a word once the switch is off', () => {
    expect(scheduledRunAction({ enabled: false, lastRunAt: run, seenRunAt: earlier })).toBe('remember')
  })

  it('announces each run once', () => {
    expect(scheduledRunAction({ enabled: true, lastRunAt: run, seenRunAt: run })).toBe('ignore')
  })

  it('takes a baseline on the first look instead of announcing old news', () => {
    expect(scheduledRunAction({ enabled: true, lastRunAt: earlier, seenRunAt: null })).toBe('remember')
    expect(scheduledRunAction({ enabled: true, lastRunAt: null, seenRunAt: null })).toBe('remember')
  })

  it('has nothing to say before the schedule has ever run', () => {
    expect(scheduledRunAction({ enabled: true, lastRunAt: null, seenRunAt: '' })).toBe('ignore')
  })
})
