import { describe, expect, it } from 'bun:test'

// Sanity check that the test runner is wired up. Real tests live next to the
// modules they cover under packages/*/test/.
describe('test runner', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
