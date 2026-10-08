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
   * A clean that freed bytes must refresh, even when it reports failure.
   *
   * `/clean-dir` returns `success: result.errors.length === 0`, so a single
   * entry it could not remove turns a clean that freed gigabytes into
   * `success: false` with `freedBytes` well above zero. Gating the refresh on
   * that flag left the row at its pre-delete size under a "Clean failed"
   * toast - the original stale-number symptom, on the path where it is most
   * likely rather than least: a live `~/Library/Caches` always holds a few
   * files open by whatever is running, so the partial failure is the common
   * case.
   *
   * The guard has to consider what was actually freed. `if (r.success)` alone
   * is the bug.
   */
  it('refreshes after a partial clean, not only a flawless one', async () => {
    const source = await Bun.file(CLEANUP).text()
    const offenders: string[] = []

    for (const handler of handlers(source)) {
      const drop = handler.body.indexOf('removeItem(CACHE_KEY)')
      if (drop === -1) continue

      // The condition guarding the cache drop: the last `if (...)` above it.
      const before = handler.body.slice(0, drop)
      const open = before.lastIndexOf('if (')
      if (open === -1) {
        offenders.push(`${handler.name} drops CACHE_KEY under no condition at all`)
        continue
      }

      let depth = 0
      let close = open + 3
      for (; close < before.length; close++) {
        if (before[close] === '(') depth++
        else if (before[close] === ')' && --depth === 0) break
      }
      const condition = before.slice(open + 4, close).trim()

      // doCleanSelected guards on the completion counter, not the response -
      // it refreshes once every target has settled, success or not.
      if (/done <|done ===|targets\.length/.test(condition)) continue

      // Resolve a bare identifier back to what it was assigned, so a guard
      // written as `if (removed)` is judged on what `removed` actually means.
      // Testing the whole body instead would pass on the broken version,
      // which mentions freedBytes in its toast.
      let expr = condition
      if (/^[A-Za-z_$][\w$]*$/.test(condition)) {
        const assigned = handler.body.match(new RegExp(`var\\s+${condition}\\s*=\\s*([^;]+);`))
        if (assigned) expr = assigned[1]
      }

      if (!/freedBytes|freed\b|measured/.test(expr))
        offenders.push(`${handler.name} guards the refresh on "${expr}" without considering what was freed`)
    }

    expect(handlers(source).filter(h => h.body.includes('removeItem(CACHE_KEY)')).length)
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
