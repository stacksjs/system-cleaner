import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { scanDirectory } from '../src/scanner'

const TMP_ROOT = fs.realpathSync(os.tmpdir())
let ROOT: string

function safeCleanup(p: string): void {
  const resolved = fs.realpathSync(p)
  if (!resolved.startsWith(`${TMP_ROOT}${path.sep}`))
    throw new Error(`refusing to rm outside tmpdir: ${resolved}`)
  fs.rmSync(resolved, { recursive: true, force: true })
}

beforeAll(() => {
  ROOT = fs.mkdtempSync(path.join(TMP_ROOT, 'system-cleaner-scanner-'))
})

afterAll(() => {
  safeCleanup(ROOT)
})

describe('scanDirectory', () => {
  it('builds a size-annotated tree for a known directory', async () => {
    const dir = path.join(ROOT, 'simple')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a'.repeat(1024))
    fs.writeFileSync(path.join(dir, 'b.txt'), 'b'.repeat(2048))
    fs.mkdirSync(path.join(dir, 'sub'))
    fs.writeFileSync(path.join(dir, 'sub', 'c.txt'), 'c'.repeat(512))

    const r = await scanDirectory(dir)
    expect(r.totalFiles).toBe(3)
    expect(r.tree.sizeBytes).toBeGreaterThan(0)
    expect(r.aborted).toBe(false)

    // Children sorted by size descending
    const sizes = (r.tree.children ?? []).map(c => c.sizeBytes)
    for (let i = 1; i < sizes.length; i++)
      expect(sizes[i - 1]).toBeGreaterThanOrEqual(sizes[i])
  })

  it('honors maxDepth (does not recurse below)', async () => {
    const dir = path.join(ROOT, 'deep')
    let cur = dir
    fs.mkdirSync(cur, { recursive: true })
    for (let i = 0; i < 5; i++) {
      cur = path.join(cur, `level${i}`)
      fs.mkdirSync(cur, { recursive: true })
      fs.writeFileSync(path.join(cur, 'f.txt'), `level${i}`)
    }

    const r = await scanDirectory(dir, { maxDepth: 2 })
    function depthOf(entry: { children?: any[], path?: string }, base: string): number {
      const rel = entry.path ? path.relative(base, entry.path) : ''
      return rel ? rel.split(path.sep).length : 0
    }
    const queue = [r.tree]
    while (queue.length) {
      const e = queue.shift()!
      expect(depthOf(e, dir)).toBeLessThanOrEqual(2)
      for (const c of e.children ?? [])
        queue.push(c as any)
    }
  })

  it('skips symlinks (refuses to follow)', async () => {
    const dir = path.join(ROOT, 'sym')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'real.txt'), 'real')
    try { fs.symlinkSync(path.join(dir, 'real.txt'), path.join(dir, 'link.txt')) }
    catch { return /* sandboxed CI without symlink perms */ }

    const r = await scanDirectory(dir)
    const names = (r.tree.children ?? []).map(c => c.name)
    expect(names).toContain('real.txt')
    expect(names).not.toContain('link.txt')
  })

  it('respects maxEntries — bails out when the cap is exceeded', async () => {
    // Regression for audit M4: huge directories used to load every
    // entry synchronously before the timeoutMs check could fire. With a
    // small maxEntries the scan must mark itself aborted instead of
    // OOMing.
    const dir = path.join(ROOT, 'big')
    fs.mkdirSync(dir, { recursive: true })
    for (let i = 0; i < 600; i++)
      fs.writeFileSync(path.join(dir, `f${i}.txt`), '.')

    const r = await scanDirectory(dir, { maxEntries: 100 })
    expect(r.aborted).toBe(true)
  })

  it('records its scan duration in scanTimeMs', async () => {
    // We can't reliably trigger the timeout-abort path with `timeoutMs: 0`
    // because `>0` is exclusive — a sub-millisecond scan never trips it.
    // Instead, just sanity-check that the wall-clock timing is recorded
    // (the cap-abort path is covered by the maxEntries test above, which
    // shares the same `aborted = true; break` machinery).
    const dir = path.join(ROOT, 'timing')
    fs.mkdirSync(dir, { recursive: true })
    for (let i = 0; i < 50; i++)
      fs.writeFileSync(path.join(dir, `f${i}.txt`), '.')
    const r = await scanDirectory(dir)
    expect(r.scanTimeMs).toBeGreaterThanOrEqual(0)
    expect(r.aborted).toBe(false)
  })

  // The bug this scanner exists to fix: a walk that stops early used to report
  // everything it had not reached as zero, so a 294 GB home directory came back
  // as 39.9 GB and the chart's proportions were false rather than incomplete.
  it('sizes directories below the walk from du, not from zero', async () => {
    const dir = path.join(ROOT, 'below')
    const deep = path.join(dir, 'a', 'b', 'c', 'd', 'e')
    fs.mkdirSync(deep, { recursive: true })
    fs.writeFileSync(path.join(deep, 'payload.bin'), Buffer.alloc(3 * 1024 * 1024))

    // One level of walking, so everything under `a` is measured by `du`.
    const r = await scanDirectory(dir, { structureDepth: 1, maxDepth: 6 })

    expect(r.tree.sizeBytes).toBeGreaterThanOrEqual(3 * 1024 * 1024)
    expect(r.unmeasuredFolders).toBe(0)

    const a = (r.tree.children ?? []).find(c => c.name === 'a')
    expect(a?.sizeBytes).toBeGreaterThanOrEqual(3 * 1024 * 1024)
    // …and the detail below it is still there to drill into.
    expect((a?.children ?? []).some(c => c.name === 'b')).toBe(true)
  })

  it('counts folded directories whole without listing what is inside them', async () => {
    const dir = path.join(ROOT, 'folded')
    const pkg = path.join(dir, 'project', 'node_modules', 'left-pad')
    fs.mkdirSync(pkg, { recursive: true })
    fs.writeFileSync(path.join(pkg, 'index.js'), Buffer.alloc(2 * 1024 * 1024))

    const r = await scanDirectory(dir, { maxDepth: 6 })
    const project = (r.tree.children ?? []).find(c => c.name === 'project')
    const modules = (project?.children ?? []).find(c => c.name === 'node_modules')

    expect(modules?.sizeBytes).toBeGreaterThanOrEqual(2 * 1024 * 1024)
    expect(modules?.children ?? []).toHaveLength(0)
    expect(r.tree.sizeBytes).toBeGreaterThanOrEqual(2 * 1024 * 1024)
  })

  it('marks folders it ran out of time to measure instead of calling them empty', async () => {
    const dir = path.join(ROOT, 'rushed')
    fs.mkdirSync(path.join(dir, 'sub'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'sub', 'f.bin'), Buffer.alloc(1024))

    // A budget already spent before the first `readdir`, so nothing can be
    // measured and every folder involved has to say so. A positive timeout
    // races the scan on a directory this small and proves nothing either way.
    const r = await scanDirectory(dir, { structureDepth: 1, timeoutMs: -1 })
    expect(r.aborted).toBe(true)
    expect(r.unmeasuredFolders).toBeGreaterThan(0)
    // The point of the flag: zero bytes here means "nobody looked", and the
    // tree has to carry that rather than presenting it as an empty folder.
    expect(r.tree.sizeBytes).toBe(0)
    expect(r.tree.unmeasured).toBe(true)
  })
})
