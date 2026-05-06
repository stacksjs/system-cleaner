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
  it('builds a size-annotated tree for a known directory', () => {
    const dir = path.join(ROOT, 'simple')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a'.repeat(1024))
    fs.writeFileSync(path.join(dir, 'b.txt'), 'b'.repeat(2048))
    fs.mkdirSync(path.join(dir, 'sub'))
    fs.writeFileSync(path.join(dir, 'sub', 'c.txt'), 'c'.repeat(512))

    const r = scanDirectory(dir)
    expect(r.totalFiles).toBe(3)
    expect(r.tree.sizeBytes).toBeGreaterThan(0)
    expect(r.aborted).toBe(false)

    // Children sorted by size descending
    const sizes = (r.tree.children ?? []).map(c => c.sizeBytes)
    for (let i = 1; i < sizes.length; i++)
      expect(sizes[i - 1]).toBeGreaterThanOrEqual(sizes[i])
  })

  it('honors maxDepth (does not recurse below)', () => {
    const dir = path.join(ROOT, 'deep')
    let cur = dir
    fs.mkdirSync(cur, { recursive: true })
    for (let i = 0; i < 5; i++) {
      cur = path.join(cur, `level${i}`)
      fs.mkdirSync(cur, { recursive: true })
      fs.writeFileSync(path.join(cur, 'f.txt'), `level${i}`)
    }

    const r = scanDirectory(dir, { maxDepth: 2 })
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

  it('skips symlinks (refuses to follow)', () => {
    const dir = path.join(ROOT, 'sym')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'real.txt'), 'real')
    try { fs.symlinkSync(path.join(dir, 'real.txt'), path.join(dir, 'link.txt')) }
    catch { return /* sandboxed CI without symlink perms */ }

    const r = scanDirectory(dir)
    const names = (r.tree.children ?? []).map(c => c.name)
    expect(names).toContain('real.txt')
    expect(names).not.toContain('link.txt')
  })

  it('respects maxEntries — bails out when the cap is exceeded', () => {
    // Regression for audit M4: huge directories used to load every
    // entry synchronously before the timeoutMs check could fire. With a
    // small maxEntries the scan must mark itself aborted instead of
    // OOMing.
    const dir = path.join(ROOT, 'big')
    fs.mkdirSync(dir, { recursive: true })
    for (let i = 0; i < 600; i++)
      fs.writeFileSync(path.join(dir, `f${i}.txt`), '.')

    const r = scanDirectory(dir, { maxEntries: 100 })
    expect(r.aborted).toBe(true)
  })

  it('records its scan duration in scanTimeMs', () => {
    // We can't reliably trigger the timeout-abort path with `timeoutMs: 0`
    // because `>0` is exclusive — a sub-millisecond scan never trips it.
    // Instead, just sanity-check that the wall-clock timing is recorded
    // (the cap-abort path is covered by the maxEntries test above, which
    // shares the same `aborted = true; break` machinery).
    const dir = path.join(ROOT, 'timing')
    fs.mkdirSync(dir, { recursive: true })
    for (let i = 0; i < 50; i++)
      fs.writeFileSync(path.join(dir, `f${i}.txt`), '.')
    const r = scanDirectory(dir)
    expect(r.scanTimeMs).toBeGreaterThanOrEqual(0)
    expect(r.aborted).toBe(false)
  })
})
