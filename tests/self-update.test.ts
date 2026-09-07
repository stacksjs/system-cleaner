import { describe, expect, it } from 'bun:test'
import {
  checkForUpdate,
  downloadUpdate,
  installUpdate,
  updateStatus,
} from '../app/Support/Update/self-update'

/**
 * Updating SystemCleaner with SystemCleaner.
 *
 * The one thing every test here asserts is the same thing: the update flow
 * refuses to act when it cannot act *safely*. It is the only feature in the
 * app whose failure mode is having no app afterwards, so "declines loudly" is
 * the behaviour worth pinning down — the happy path needs a signed bundle, a
 * release, and a network, none of which belong in a unit test.
 *
 * These run out of the source tree, which is itself the first case: a `bun
 * test` process is not inside an `.app`, so there is nothing to replace.
 */
describe('self-update outside an installed bundle', () => {
  it('reports itself unsupported rather than guessing at a path', async () => {
    const status = await updateStatus()
    expect(status.stage).toBe('unsupported')
    expect(status.unsupportedReason).toMatch(/source tree|macOS/)
  })

  it('knows which version it is', async () => {
    const status = await updateStatus()
    // Falls back to package.json when there is no Info.plist to read.
    expect(status.currentVersion).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('declines to check', async () => {
    expect((await checkForUpdate()).stage).toBe('unsupported')
  })

  it('declines to download', async () => {
    expect((await downloadUpdate()).stage).toBe('unsupported')
  })

  it('declines to install', async () => {
    // The dangerous one: an install that ran here would swap a directory in
    // the source tree for a downloaded bundle.
    expect((await installUpdate()).stage).toBe('unsupported')
  })

  it('never reports progress it does not have', async () => {
    const status = await updateStatus()
    expect(status.percent).toBe(0)
    expect(status.latestVersion).toBeNull()
  })
})
