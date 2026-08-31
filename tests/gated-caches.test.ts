import { describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { isCleanable } from '../packages/core/src/paths'

/**
 * Caches macOS gates behind a media-library permission.
 *
 * These do not fail to clean, they hang: a process touching
 * `~/Library/Caches/com.apple.Music` without consent parks in a syscall the
 * kernel will not return from, ignoring its own timeout and SIGKILL. Because
 * the clean measured the directory before deleting anything, one gated
 * subdirectory took the whole operation down and the button did nothing at all,
 * silently, on the largest category the app offers.
 */
describe('permission-gated caches', () => {
  const home = os.homedir()

  test('refuses the Music cache rather than hanging on it', () => {
    const check = isCleanable(path.join(home, 'Library/Caches/com.apple.Music'))
    expect(check.safe).toBe(false)
    expect(check.reason).toMatch(/permission/i)
  })

  test('refuses anything beneath it', () => {
    const check = isCleanable(path.join(home, 'Library/Caches/com.apple.Music/SubStore'))
    expect(check.safe).toBe(false)
  })

  test('covers the other gated media caches', () => {
    for (const gated of ['com.apple.TV', 'com.apple.podcasts', 'com.apple.photolibraryd'])
      expect(isCleanable(path.join(home, 'Library/Caches', gated)).safe).toBe(false)
  })

  test('does not refuse a name that merely starts the same way', () => {
    // `com.apple.Musicality` is not `com.apple.Music`, and prefix matching
    // without the separator would have swallowed it.
    const check = isCleanable(path.join(home, 'Library/Caches/com.apple.Musicality'))
    expect(check.reason).not.toMatch(/permission/i)
  })

  // Asserted on the *reason*, not on `safe`. The gate has to not swallow the
  // parent of the directories it guards — that is the regression this catches.
  // Asking for `safe === true` instead made the test depend on the macOS
  // directory layout existing, so it failed on the Linux CI runner for a
  // reason that had nothing to do with gating.
  test('does not treat the caches directory itself as gated', () => {
    const check = isCleanable(path.join(home, 'Library/Caches'))
    // `?? ''` because a cleanable path carries no reason at all, and
    // `toMatch` on undefined throws rather than passing.
    expect(check.reason ?? '').not.toMatch(/permission/i)
  })

  test('leaves an ordinary directory cleanable', () => {
    const dir = fs.mkdtempSync(path.join(home, '.system-cleaner-gated-test-'))
    try {
      expect(isCleanable(dir).safe).toBe(true)
    }
    finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
