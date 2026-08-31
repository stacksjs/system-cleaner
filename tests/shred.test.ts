import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { HOME } from '../packages/core/src/paths'
import { shredPaths } from '../packages/disk/src/shred'

/**
 * Secure erase is the least recoverable action in the app, so these tests
 * check the two things that make it safe rather than just that it deletes:
 * it goes through the same path allow-list as every other delete, and the
 * bytes really are overwritten before the file is unlinked.
 *
 * The overwrite test has to run under HOME, because `isPathSafe` refuses
 * everything else — which is the point. It uses a dedicated dot-directory and
 * a cleanup that refuses to remove anything outside it.
 */

let ROOT: string

beforeAll(() => {
  ROOT = fs.mkdtempSync(path.join(HOME, '.system-cleaner-shred-test-'))
})

afterAll(() => {
  const resolved = fs.realpathSync(ROOT)
  if (!resolved.startsWith(`${fs.realpathSync(HOME)}${path.sep}.system-cleaner-shred-test-`))
    throw new Error(`refusing to rm outside the test directory: ${resolved}`)
  fs.rmSync(resolved, { recursive: true, force: true })
})

describe('shredPaths', () => {
  it('refuses paths outside the home directory', () => {
    const outside = path.join(fs.realpathSync(os.tmpdir()), 'system-cleaner-shred-outside.txt')
    fs.writeFileSync(outside, 'not yours to erase')

    try {
      const outcome = shredPaths([outside])

      expect(outcome.shredded).toEqual([])
      expect(outcome.skipped).toHaveLength(1)
      expect(outcome.skipped[0].reason).toContain('outside home')
      // The refusal must not have deleted it anyway.
      expect(fs.existsSync(outside)).toBe(true)
    }
    finally {
      fs.rmSync(outside, { force: true })
    }
  })

  it('overwrites the contents before unlinking', () => {
    const target = path.join(ROOT, 'secret.txt')
    const secret = 'the quick brown fox jumps over the lazy dog'
    fs.writeFileSync(target, secret)

    const outcome = shredPaths([target])

    expect(outcome.shredded).toEqual([target])
    expect(outcome.failed).toEqual([])
    expect(outcome.bytesOverwritten).toBe(secret.length)
    expect(fs.existsSync(target)).toBe(false)
    // The rename means the old directory entry is gone too, not just its
    // contents — the filename is data as much as the file is.
    expect(fs.readdirSync(ROOT)).not.toContain('secret.txt')
  })

  it('erases a directory and everything under it', () => {
    const dir = path.join(ROOT, 'folder')
    fs.mkdirSync(path.join(dir, 'nested'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'a.txt'), 'aaaa')
    fs.writeFileSync(path.join(dir, 'nested', 'b.txt'), 'bbbbbb')

    const outcome = shredPaths([dir])

    expect(outcome.shredded).toEqual([dir])
    expect(outcome.bytesOverwritten).toBe(10)
    expect(fs.existsSync(dir)).toBe(false)
  })

  // An honest refusal beats a UI that looks hung for four minutes.
  it('refuses a file larger than the size ceiling', () => {
    const target = path.join(ROOT, 'big.bin')
    fs.writeFileSync(target, Buffer.alloc(4096))

    const outcome = shredPaths([target], { maxFileBytes: 1024 })

    expect(outcome.shredded).toEqual([])
    expect(outcome.skipped[0].reason).toContain('delete it permanently instead')
    expect(fs.existsSync(target)).toBe(true)
  })

  it('reports a missing path as skipped rather than failed', () => {
    const outcome = shredPaths([path.join(ROOT, 'never-existed')])

    expect(outcome.failed).toEqual([])
    expect(outcome.skipped).toHaveLength(1)
  })
})
