import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import process from 'node:process'
import { measureTree, measureTreeAsync, NEEDS_PORTABLE_SIZER, sizeOfTree } from '../src/dirsize'

/**
 * A size of zero and "I could not measure" have to be different answers.
 *
 * Every size in this app came from `du`, which Windows does not have. The
 * spawn failed ENOENT, the error was swallowed, and the size came back 0 — so
 * Disk Usage drew an empty chart and Developer Junk found nothing, both of
 * which read as "your machine is clean" rather than "this build cannot see".
 * That is the exact failure the capability map exists to prevent, which is why
 * `diskScan` and `developerJunk` could not honestly be turned on for Windows
 * until this walker existed.
 *
 * The test that matters is agreement with `du` itself, asserted exactly rather
 * than within a tolerance. A tolerance would have hidden the first real bug
 * here: `blocks > 0 ? blocks * 512 : size` reads "occupies no blocks" as "this
 * platform does not report blocks", and on APFS a directory reports exactly
 * that, so every folder contributed 96 bytes of phantom size. It came to 0.3%
 * across a 323 MB tree — comfortably inside any tolerance anyone would have
 * picked, and wrong.
 *
 * See stacksjs/system-cleaner#23.
 */

const POSIX = process.platform !== 'win32'

let root = ''

function write(p: string, bytes: number): void {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, Buffer.alloc(bytes, 7))
}

/** `du -x -k -d n`, as bytes keyed by path. Null where there is no `du`. */
function du(target: string, depth: number): Map<string, number> | null {
  if (!POSIX)
    return null
  const bin = fs.existsSync('/usr/bin/du') ? '/usr/bin/du' : 'du'
  const r = spawnSync(bin, ['-x', '-k', '-d', String(depth), target], { encoding: 'utf8' })
  if (r.status !== 0 && !r.stdout)
    return null
  const out = new Map<string, number>()
  for (const line of r.stdout.split('\n')) {
    const tab = line.indexOf('\t')
    if (tab <= 0) continue
    out.set(line.slice(tab + 1), Number.parseInt(line.slice(0, tab), 10) * 1024)
  }
  return out
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-dirsize-'))

  write(path.join(root, 'top.bin'), 100 * 1024)
  write(path.join(root, 'a/one.bin'), 64 * 1024)
  write(path.join(root, 'a/b/two.bin'), 37 * 1024)
  write(path.join(root, 'a/b/c/three.bin'), 8 * 1024)
  write(path.join(root, 'empty/.keep'), 0)
})

afterAll(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true })
})

describe('measureTree agrees with du', () => {
  it('reports the same bytes for every directory, exactly', () => {
    const expected = du(root, 9)
    if (!expected) return

    const { records } = measureTree(root, { maxDepth: 9 })
    expect(records.length).toBe(expected.size)

    for (const record of records) {
      expect(expected.has(record.path), `du reported ${record.path}`).toBe(true)
      expect(record.bytes, `${record.path} bytes`).toBe(expected.get(record.path)!)
    }
  })

  it('agrees on a real tree with symlinks and hard links in it', () => {
    const expected = du('packages', 3)
    if (!expected) return

    const { records } = measureTree('packages', { maxDepth: 3 })
    const mine = new Map(records.map(r => [r.path, r.bytes]))
    for (const [p, bytes] of expected)
      expect(mine.get(p) ?? -1, `${p} bytes`).toBe(bytes)
  })

  it('reports only to the requested depth, while still counting below it', () => {
    const deep = measureTree(root, { maxDepth: 9 })
    const shallow = measureTree(root, { maxDepth: 0 })

    expect(shallow.records.length).toBe(1)
    // The number is the same; only the detail is dropped. A depth limit that
    // also truncated the total is how a 294 GB home directory came back as
    // 39.9 GB.
    expect(shallow.records[0].bytes).toBe(deep.records.find(r => r.path === root)!.bytes)
  })
})

describe('the four behaviours the scanner depends on', () => {
  it('counts a hard link once, not once per name', () => {
    if (!POSIX) return
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-hardlink-'))
    try {
      write(path.join(dir, 'original.bin'), 200 * 1024)
      const before = sizeOfTree(dir)
      fs.linkSync(path.join(dir, 'original.bin'), path.join(dir, 'second-name.bin'))
      // A second name for the same blocks costs nothing, and `du` says so.
      expect(sizeOfTree(dir)).toBe(before)
    }
    finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not follow a symlink, however large its target', () => {
    if (!POSIX) return
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-symlink-'))
    try {
      write(path.join(dir, 'real/big.bin'), 300 * 1024)
      const before = sizeOfTree(dir)
      fs.symlinkSync(path.join(dir, 'real'), path.join(dir, 'pointer'))
      // Following it would double-count the tree, and a link to an ancestor
      // would not terminate at all.
      expect(sizeOfTree(dir)).toBe(before)
    }
    finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('counts an unreadable directory rather than throwing', () => {
    if (!POSIX || process.getuid?.() === 0) return
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-denied-'))
    try {
      write(path.join(dir, 'readable/f.bin'), 16 * 1024)
      fs.mkdirSync(path.join(dir, 'locked'))
      write(path.join(dir, 'locked/hidden.bin'), 16 * 1024)
      fs.chmodSync(path.join(dir, 'locked'), 0o000)

      const result = measureTree(dir, { maxDepth: 9 })
      // One wall must not abort the other nine hundred folders, and it has to
      // leave a trace: in bulk this is the Full Disk Access prompt.
      expect(result.unreadable).toBeGreaterThanOrEqual(1)
      expect(result.records.find(r => r.path === dir)!.bytes).toBeGreaterThan(0)
    }
    finally {
      fs.chmodSync(path.join(dir, 'locked'), 0o700)
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('stops at the deadline and says it was cut short', () => {
    // A deadline already past: the walk must report timedOut rather than
    // present a partial figure as a complete one.
    const result = measureTree(root, { maxDepth: 9, deadline: Date.now() - 1 })
    expect(result.timedOut).toBe(true)
  })
})

/**
 * `du` ran in another process, so a 15-second measure cost this one nothing.
 * An in-process walk is the opposite: `getDirSize` is awaited from a dozen
 * HTTP handlers and the scanner runs it under a progress ticker, so a
 * synchronous walk would freeze the agent that serves the UI for as long as it
 * takes — no progress, no other request answered. On Windows that is the only
 * sizer there is, which would have made Disk Usage look hung rather than slow.
 */
describe('the async walk does not starve the event loop', () => {
  it('reports exactly what the synchronous walk reports', async () => {
    const sync = measureTree('packages', { maxDepth: 3 })
    const async_ = await measureTreeAsync('packages', { maxDepth: 3 })

    // Identical, not merely close. Both decide every byte through the same
    // `classify` and `finishDir`, and this is what keeps them from drifting.
    expect(async_.records).toEqual(sync.records)
    expect(async_.unreadable).toBe(sync.unreadable)
  })

  it('hands control back before it has finished', async () => {
    // A tree comfortably past one yield interval, so the race below is
    // decided by whether the walk pauses and not by how fast the disk is.
    const big = 'node_modules'
    if (!fs.existsSync(big)) return

    const walk = measureTreeAsync(big, { maxDepth: 2 }).then(() => 'walk' as const)
    const tick = new Promise<'tick'>(resolve => setImmediate(() => resolve('tick')))

    // A blocking walk wins this race every time, however long it runs,
    // because nothing else gets a turn until it returns.
    expect(await Promise.race([walk, tick])).toBe('tick')
    await walk
  })

  it('still honours a deadline', async () => {
    const result = await measureTreeAsync(root, { maxDepth: 9, deadline: Date.now() - 1 })
    expect(result.timedOut).toBe(true)
  })
})

describe('the platform decides which sizer runs', () => {
  it('needs the portable walker exactly on Windows', () => {
    expect(NEEDS_PORTABLE_SIZER).toBe(process.platform === 'win32')
  })

  it('measures a non-empty tree as non-empty on every platform', () => {
    // The whole point. On Windows this was 0, and 0 renders as a clean
    // machine.
    expect(sizeOfTree(root)).toBeGreaterThan(200 * 1024)
  })

  it('returns 0 for something that is not a directory, rather than throwing', () => {
    expect(sizeOfTree(path.join(root, 'no-such-place'))).toBe(0)
    expect(sizeOfTree(path.join(root, 'top.bin'))).toBe(0)
  })
})
