import { describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * The two guards that keep a glanced link from freezing the window.
 *
 * The stx router prefetches links as they come into view, up to a byte budget.
 * A job already queued when the budget runs out skipped the fetch — and with
 * it the `finally` that gives the key back, so `prefetching[key]` was left
 * holding a promise that resolves with nothing cached behind it. Clicking that
 * link then sent `navigate()` into the branch that waits for an in-flight
 * prefetch, which re-entered itself on every microtask: the main thread at
 * full tilt, the window frozen, no error and no request to show for it. On the
 * Cleanup page it was the third tool every time.
 *
 * Both are patched into the dependency (`patches/@stacksjs%2Fstx@*.patch`), so
 * these read the installed runtime rather than any source of ours. If an
 * install or an upgrade drops the patch, this fails here instead of in a
 * frozen app — and the e2e walk, which is what caught it, costs eight minutes
 * to say the same thing.
 */

function routerRuntime(): { file: string, source: string } {
  const dir = path.join(import.meta.dir, '..', 'node_modules', '@stacksjs', 'stx', 'dist')
  // Found by what it contains, not by name: the chunk is named by content hash
  // and is renamed by any release that touches it.
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.js')) continue
    const source = fs.readFileSync(path.join(dir, name), 'utf8')
    if (source.includes('function sightBudget()') && source.includes('function prefetchLink('))
      return { file: name, source }
  }
  throw new Error(`no stx chunk in ${dir} holds the router's prefetch runtime`)
}

describe('the stx router\'s prefetch bookkeeping', () => {
  const { source } = routerRuntime()

  it('gives the key back when the sight budget stops a queued prefetch', () => {
    const guard = source.match(/if\(glance\)\{var spent=sightBudget\(\);[^\n]*/)?.[0]
    expect(guard).toBeDefined()
    // The whole fix: the early return releases what the job registered.
    expect(guard).toContain('delete prefetching[key]')
  })

  it('does not wait twice on a prefetch that settled without caching', () => {
    // The hand-off: navigate() awaits an in-flight prefetch and then re-enters
    // itself. It may only do that once, so the stale entry has to go first.
    const handoff = source.match(/return prefetching\[awaitedKey\]\.then\(function\(\)\{[\s\S]{0,900}?\n {6}\}\);/)?.[0]
    expect(handoff).toBeDefined()
    expect(handoff).toContain('delete prefetching[awaitedKey]')
    const dropsIt = handoff!.indexOf('delete prefetching[awaitedKey]')
    const reEnters = handoff!.indexOf('return navigate(url,pushState,force)')
    expect(dropsIt).toBeGreaterThan(-1)
    expect(reEnters).toBeGreaterThan(dropsIt)
  })
})
