import { describe, expect, it } from 'bun:test'

/**
 * A clean handler has to drop the client's own size cache as well.
 *
 * The server forgetting its measurements is only half the fix. The cleanup
 * screen keeps a second five-minute copy in `localStorage` under
 * `systemcleaner:dir-sizes` so a revisit paints instantly, and reads it before
 * asking the server anything. A handler that cleans without dropping that
 * entry leaves the next render drawing pre-delete numbers out of storage: the
 * toast says 12 GB freed, the row still shows 12 GB, and the server-side
 * invalidation is invisible from the screen that needed it.
 *
 * `doEmptyTrash` shipped that way while `doCleanDir` and `doCleanSelected`
 * both did it correctly, which is what makes this worth asserting rather than
 * remembering — the right version was already on screen, twice, in the same
 * file.
 */

const CLEANUP = 'resources/views/app/cleanup.stx'

/** The `function name(...) { ... }` body for each top-level handler. */
function handlers(source: string): { name: string, body: string }[] {
  const found: { name: string, body: string }[] = []
  const starts = [...source.matchAll(/^(?:async )?function (\w+)\(/gm)]

  for (let i = 0; i < starts.length; i++) {
    const from = starts[i].index!
    const to = i + 1 < starts.length ? starts[i + 1].index! : source.length
    found.push({ name: starts[i][1], body: source.slice(from, to) })
  }

  return found
}

/** Endpoints that remove bytes, as the cleanup screen calls them. */
const CLEANING = ['/api/clean-dir', '/api/empty-trash', '/api/bulk-delete']

describe('cleanup screen refresh', () => {
  it('every handler that cleans drops the cached sizes and rescans', async () => {
    const source = await Bun.file(CLEANUP).text()
    const offenders: string[] = []

    for (const handler of handlers(source)) {
      const endpoint = CLEANING.find(url => handler.body.includes(url))
      if (!endpoint) continue

      if (!handler.body.includes('removeItem(CACHE_KEY)'))
        offenders.push(`${handler.name} calls ${endpoint} but never drops CACHE_KEY`)
      if (!handler.body.includes('scanCleanupSizes(true)'))
        offenders.push(`${handler.name} calls ${endpoint} but never forces a rescan`)
    }

    // Guard against the matcher silently finding nothing to check.
    expect(handlers(source).filter(h => CLEANING.some(u => h.body.includes(u))).length)
      .toBeGreaterThan(0)
    expect(offenders).toEqual([])
  })

  /**
   * A forced rescan must supersede a walk already in flight.
   *
   * The scan is single-flighted, which is right for two cold loads racing and
   * wrong immediately after a clean: the one request that could report the new
   * size is the one being dropped, and the walk already running then lands
   * holding pre-delete numbers and writes them to the table and to storage.
   * Dedupe only when nothing was deleted.
   */
  it('a forced rescan is not swallowed by the single-flight guard', async () => {
    const source = await Bun.file(CLEANUP).text()
    const scan = handlers(source).find(h => h.name === 'scanCleanupSizes')
    expect(scan).toBeDefined()

    // The guard has to be reachable only when `force` is false.
    expect(scan!.body).toMatch(/else if \(window\._cleanupScanPromise\) return/)
    expect(scan!.body).not.toMatch(/if \(!window\._cleanupScanPromise\) \{/)

    // And a superseded result has to be dropped rather than applied.
    expect(scan!.body).toContain('_cleanupScanGen')
    const applyAt = scan!.body.indexOf('applySizes(r.sizes)')
    const guardAt = scan!.body.indexOf('gen !== (window._cleanupScanGen || 0)) return')
    expect(guardAt, 'checks for supersession').toBeGreaterThan(-1)
    expect(guardAt, 'checks before applying anything').toBeLessThan(applyAt)
  })
})
