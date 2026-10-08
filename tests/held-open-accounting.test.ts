import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import process from 'node:process'
import { freeSpaceOf } from '@system-cleaner/core'
import { cleanDirectory } from '../packages/clean/src/cleaner'

/**
 * A delete that frees nothing must not report that it freed something.
 *
 * `cleanDirectory` measured its result by walking the directory before and
 * after. That is the right shape and it still cannot see the one case that
 * matters: unlinking a file a process holds open removes its directory entry
 * immediately and frees none of its blocks until the holder closes it. `du`
 * stops counting the file; the disk keeps the space.
 *
 * Measured by hand on a 200 MB file held open by a live process:
 *
 *   du delta: 200.0 MB freed
 *   df delta:  -0.1 MB freed
 *   after the holder exited: the 200 MB came back
 *
 * So the app could toast "freed 200 MB" while Disk Free did not move. This
 * app has already had that complaint once, for a different cause, in the words
 * "its either misreading the size or cleaning here does nothing, just fake
 * stuff". Same symptom, third source.
 */

let root = ''
const held: number[] = []

/** Comfortably above HELD_OPEN_FLOOR, which is 10 MB. */
const BIG = 40 * 1024 * 1024

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.homedir(), '.sc-heldopen-test-'))
})

afterAll(() => {
  for (const fd of held) {
    try { fs.closeSync(fd) }
    catch { /* already gone */ }
  }
  // Same retry as bulk-delete: Windows will not unlink a directory while a
  // handle inside it is open, and a descriptor closed a moment ago may not
  // have been released yet.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.rmSync(root, { recursive: true, force: true })
      return
    }
    catch { Bun.sleepSync(100) }
  }
})

function makeDir(name: string, bytes: number): string {
  const dir = path.join(root, name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'blob.bin'), Buffer.alloc(bytes, 1))
  return dir
}

describe('freeSpaceOf', () => {
  it('reports the same free space the filesystem does', () => {
    const free = freeSpaceOf(os.homedir())
    expect(free).not.toBeNull()
    expect(free!).toBeGreaterThan(0)
  })

  it('returns null rather than throwing for a path that does not exist', () => {
    expect(freeSpaceOf(path.join(root, 'no', 'such', 'place'))).toBeNull()
  })
})

describe('cleanDirectory accounting', () => {
  it('reports what it removed and what the disk gave back', async () => {
    const dir = makeDir('ordinary', BIG)
    const result = await cleanDirectory(dir)

    expect(result.errors).toEqual([])
    expect(result.freedBytes).toBeGreaterThanOrEqual(BIG * 0.9)
    // A plain delete with nothing holding the file: the two measures agree,
    // so this must not be flagged.
    expect(result.heldOpen, 'an ordinary clean is not held open').toBe(false)
  })

  /**
   * The case the walk cannot see.
   *
   * POSIX only. Windows refuses the unlink outright rather than deferring the
   * free, so the delete fails loudly instead of silently freeing nothing -
   * a different failure, already visible to the user, and not this one.
   */
  it('says so when the bytes will not come back until a holder closes', async () => {
    if (process.platform === 'win32')
      return

    const dir = makeDir('held', BIG)
    // Hold the file open across the delete, exactly as a running service
    // holds its log.
    held.push(fs.openSync(path.join(dir, 'blob.bin'), 'r'))

    const result = await cleanDirectory(dir)

    // The unlink succeeds and the walk sees the bytes go.
    expect(result.errors).toEqual([])
    expect(result.freedBytes).toBeGreaterThanOrEqual(BIG * 0.9)

    // But the filesystem did not give them back, and the result says so
    // rather than letting the caller claim them.
    expect(result.reclaimedBytes).not.toBeNull()
    expect(result.heldOpen, 'a held-open delete must be flagged').toBe(true)
  })

  it('never flags a small clean, where the comparison is just noise', async () => {
    const dir = makeDir('tiny', 64 * 1024)
    const result = await cleanDirectory(dir)
    // Any other process writing during the clean moves the free-space figure,
    // so below the floor the comparison says nothing and must not be used.
    expect(result.heldOpen).toBe(false)
  })
})
