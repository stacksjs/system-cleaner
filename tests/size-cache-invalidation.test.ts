import { describe, expect, it } from 'bun:test'

/**
 * A route that deletes must forget the sizes it measured.
 *
 * `/dir-sizes` caches measured directory sizes for five minutes, keyed on the
 * sorted path list, and the cleanup screen sends the same ~76 paths every time
 * — so one entry answers every rescan for the whole window. A delete that does
 * not clear it leaves the screen showing pre-delete numbers: the row keeps its
 * old size, "Space Recoverable" never moves, and the button looks broken while
 * having worked perfectly. `~/.bun/install/cache` and `~/.cache/codex-runtimes`
 * were both empty on disk while the UI still showed 245 MB and 1.7 GB.
 *
 * v0.3.4 added the call to six routes and missed five more — /app-uninstall,
 * /privacy-clean, /clean-orphans, /schedule-run and /run-maintenance — which is
 * the same bug still reachable from four other screens. Nothing caught that:
 * every route typechecks, lints and returns a cheerful `success: true` with the
 * freed byte count in it. The omission is only visible in the UI, one screen
 * away from the button that was pressed.
 *
 * So assert the invariant directly against the source. These are static checks
 * because the fault is a missing call, not a wrong result: there is no return
 * value to inspect and no amount of exercising the handler reveals it.
 */

const API = 'routes/api.ts'

/**
 * Anything that removes bytes from disk, by the name a route calls it under.
 *
 * `fs.rmSync` and `fs.unlinkSync` are the direct ones; the rest are this
 * project's own helpers, each of which ends in one of those.
 */
const DELETERS = [
  'fs.rmSync',
  'fs.unlinkSync',
  'cleanDirectory',
  'emptyTrash',
  'bulkDelete',
  'uninstall',
  'cleanPrivacyItems',
  'shredPaths',
  'removeExtensions',
  'runScheduledClean',
  'cleanDsStoreFiles',
  'cleanIncompleteDownloads',
  'runMaintenanceTask',
]

/**
 * Routes that remove bytes `/dir-sizes` could never have measured.
 *
 * The invariant is about user data. `/dir-sizes` refuses any path outside
 * HOME, so a route whose only removals are scratch files it wrote itself under
 * `os.tmpdir()` has no measured size to forget. Each entry is re-checked
 * below rather than taken on trust, so adding a real delete to one of these
 * routes fails here instead of silently inheriting the exemption.
 */
const TEMP_ONLY: Record<string, string> = {
  '/user-profile': 'removes only the sips scratch files it writes to os.tmpdir()',
}

/** Each `router.post('/x', ...)` handler, split out with its body. */
function routeBlocks(source: string): { path: string, body: string }[] {
  const blocks: { path: string, body: string }[] = []
  const starts = [...source.matchAll(/router\.post\(\s*'([^']+)'/g)]

  for (let i = 0; i < starts.length; i++) {
    const from = starts[i].index!
    const to = i + 1 < starts.length ? starts[i + 1].index! : source.length
    blocks.push({ path: starts[i][1], body: source.slice(from, to) })
  }

  return blocks
}

describe('size cache invalidation', () => {
  it('every route that deletes something calls invalidateSizeCaches', async () => {
    const source = await Bun.file(API).text()
    const offenders: string[] = []

    for (const route of routeBlocks(source)) {
      const deleter = DELETERS.find(name => route.body.includes(`${name}(`))
      if (!deleter) continue
      if (route.path in TEMP_ONLY) continue
      if (!route.body.includes('invalidateSizeCaches()'))
        offenders.push(`${route.path} calls ${deleter}() but never invalidateSizeCaches()`)
    }

    expect(offenders).toEqual([])
  })

  it('the temp-only exemptions really are temp-only', async () => {
    const source = await Bun.file(API).text()

    for (const [path, reason] of Object.entries(TEMP_ONLY)) {
      const route = routeBlocks(source).find(r => r.path === path)
      expect(route, `${path} still exists`).toBeDefined()
      expect(route!.body, `${path} ${reason}`).toContain('tmpdir()')
      expect(route!.body, `${path} must not reach into HOME`).not.toContain('HOME')
    }
  })

  /**
   * A delete that throws part-way still freed whatever it got through.
   *
   * `fs.rmSync(dir, { recursive: true })` is not atomic. One undeletable entry
   * — EPERM, an immutable flag, a file held open — throws after the other nine
   * are already gone, so the error path can have freed gigabytes. Invalidating
   * only on success caches the old size for five minutes on exactly the
   * deletes that are hardest to explain to the user.
   */
  it('invalidates on the error path of a partial delete too', async () => {
    const source = await Bun.file(API).text()
    const deletePath = routeBlocks(source).find(r => r.path === '/delete-path')
    expect(deletePath).toBeDefined()

    // Inside the catch, not merely somewhere after the rm - the success path
    // invalidates either way, so anything looser passes on the broken code.
    const errorBranch = deletePath!.body.match(/catch \(err: any\) \{[\s\S]*?\n {4}\}/)
    expect(errorBranch, 'the delete has a catch block').not.toBeNull()
    expect(errorBranch![0]).toContain('invalidateSizeCaches()')
  })

  /**
   * The invalidation cannot sit behind a step that is allowed to fail.
   *
   * `/remove-extensions` and `/shred-paths` write a `CleanupRun` history row
   * after doing the work. A rejected insert — locked database, unapplied
   * migration, full disk — would take the invalidation down with it, leaving
   * the files gone and their sizes cached.
   */
  it('invalidates before the history write, not after', async () => {
    const source = await Bun.file(API).text()

    for (const path of ['/remove-extensions', '/shred-paths']) {
      const route = routeBlocks(source).find(r => r.path === path)
      expect(route, path).toBeDefined()

      const invalidateAt = route!.body.indexOf('invalidateSizeCaches()')
      const historyAt = route!.body.indexOf('CleanupRun.create(')
      expect(invalidateAt, `${path} invalidates`).toBeGreaterThan(-1)
      expect(historyAt, `${path} records history`).toBeGreaterThan(-1)
      expect(invalidateAt, `${path} invalidates before CleanupRun.create`).toBeLessThan(historyAt)
    }
  })

  /**
   * Clearing the map does not reach a walk that is already running.
   *
   * `/dir-sizes` reads the cache, spends tens of seconds measuring ~76
   * directories, then stores what it found. A delete landing inside that
   * window clears an entry the walk is not holding, and the walk then writes
   * its pre-delete measurement under a fresh five-minute TTL — reinstating the
   * stale number the clear existed to remove. The generation has to be
   * captured before the walk and checked before the store.
   */
  it('does not cache a walk that something invalidated mid-flight', async () => {
    const source = await Bun.file(API).text()
    const dirSizes = routeBlocks(source).find(r => r.path === '/dir-sizes')
    expect(dirSizes).toBeDefined()

    const capture = dirSizes!.body.indexOf('sizeCacheGeneration;')
    const store = dirSizes!.body.indexOf('dirSizesCache.set(')
    expect(capture, 'captures the generation').toBeGreaterThan(-1)
    expect(capture, 'captures it before the walk stores anything').toBeLessThan(store)

    // The store has to be conditional on the generation still matching.
    const guarded = /if\s*\(\s*\w+\s*\)\s*dirSizesCache\.set\(/.test(dirSizes!.body)
      || /sizeCacheGeneration\s*===\s*\w+[\s\S]{0,200}?dirSizesCache\.set\(/.test(dirSizes!.body)
    expect(guarded, 'the store is guarded by the generation check').toBe(true)

    expect(source).toContain('sizeCacheGeneration++')
  })
})
