import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { findDuplicates } from '../packages/disk/src/duplicates'

/**
 * The duplicate finder decides which files a user is about to delete, so the
 * property that matters is not "finds duplicates" but "never calls two
 * different files identical". Same-size-different-content is the case that
 * would slip past a cheaper implementation, and it has its own test below.
 */

const TMP_ROOT = fs.realpathSync(os.tmpdir())
let ROOT: string

function write(relative: string, contents: Buffer | string, mtimeSeconds?: number): string {
  const full = path.join(ROOT, relative)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, contents)
  if (mtimeSeconds !== undefined)
    fs.utimesSync(full, mtimeSeconds, mtimeSeconds)
  return full
}

/** A buffer of `size` bytes filled deterministically from `seed`. */
function bytes(size: number, seed: number): Buffer {
  const buffer = Buffer.allocUnsafe(size)
  for (let i = 0; i < size; i++)
    buffer[i] = (i * 31 + seed) % 251
  return buffer
}

beforeAll(() => {
  ROOT = fs.mkdtempSync(path.join(TMP_ROOT, 'system-cleaner-duplicates-'))
})

afterAll(() => {
  const resolved = fs.realpathSync(ROOT)
  if (!resolved.startsWith(`${TMP_ROOT}${path.sep}`))
    throw new Error(`refusing to rm outside tmpdir: ${resolved}`)
  fs.rmSync(resolved, { recursive: true, force: true })
})

describe('findDuplicates', () => {
  it('groups files with identical contents', () => {
    const payload = bytes(200_000, 7)
    write('same/a.bin', payload)
    write('same/nested/b.bin', payload)

    const result = findDuplicates({ roots: [path.join(ROOT, 'same')], minSizeBytes: 1024 })

    expect(result.groupCount).toBe(1)
    expect(result.duplicateCount).toBe(1)
    expect(result.wastedBytes).toBe(200_000)
    expect(result.groups[0].files.map(file => file.name).sort()).toEqual(['a.bin', 'b.bin'])
  })

  // The case a size-only or signature-only implementation gets wrong. Both
  // files are the same length and share their first and last block; only a
  // full hash separates them.
  it('does not group same-size files that differ in the middle', () => {
    const size = 300_000
    const first = bytes(size, 3)
    const second = Buffer.from(first)
    second[Math.floor(size / 2)] = second[Math.floor(size / 2)] ^ 0xFF

    write('sneaky/one.bin', first)
    write('sneaky/two.bin', second)

    const result = findDuplicates({ roots: [path.join(ROOT, 'sneaky')], minSizeBytes: 1024 })

    expect(result.groupCount).toBe(0)
    expect(result.wastedBytes).toBe(0)
  })

  it('suggests the oldest copy as the keeper', () => {
    const payload = bytes(150_000, 11)
    write('ages/new.bin', payload, 1_800_000_000)
    write('ages/old.bin', payload, 1_600_000_000)

    const result = findDuplicates({ roots: [path.join(ROOT, 'ages')], minSizeBytes: 1024 })

    const keeper = result.groups[0].files.find(file => file.keep)
    expect(keeper?.name).toBe('old.bin')
    expect(result.groups[0].files.filter(file => file.keep)).toHaveLength(1)
  })

  it('ignores files below the minimum size', () => {
    const payload = bytes(4096, 13)
    write('small/a.bin', payload)
    write('small/b.bin', payload)

    const result = findDuplicates({ roots: [path.join(ROOT, 'small')], minSizeBytes: 1024 * 1024 })

    expect(result.groupCount).toBe(0)
  })

  // Two checkouts share thousands of identical dependency files, and deleting
  // one breaks whatever depends on it.
  it('skips dependency directories', () => {
    const payload = bytes(120_000, 17)
    write('deps/node_modules/pkg/index.js', payload)
    write('deps/other/node_modules/pkg/index.js', payload)

    const result = findDuplicates({ roots: [path.join(ROOT, 'deps')], minSizeBytes: 1024 })

    expect(result.groupCount).toBe(0)
  })

  // A bundle is one document to the user; descending into two copies of an app
  // would bury every real finding under identical framework files.
  it('does not descend into document bundles', () => {
    const payload = bytes(120_000, 19)
    write('bundles/One.app/Contents/MacOS/binary', payload)
    write('bundles/Two.app/Contents/MacOS/binary', payload)

    const result = findDuplicates({ roots: [path.join(ROOT, 'bundles')], minSizeBytes: 1024 })

    expect(result.groupCount).toBe(0)
  })

  it('reports three copies as two redundant ones', () => {
    const payload = bytes(90_000, 23)
    write('triple/a.bin', payload, 1_600_000_000)
    write('triple/b.bin', payload, 1_700_000_000)
    write('triple/c.bin', payload, 1_800_000_000)

    const result = findDuplicates({ roots: [path.join(ROOT, 'triple')], minSizeBytes: 1024 })

    expect(result.groups[0].count).toBe(3)
    expect(result.duplicateCount).toBe(2)
    expect(result.wastedBytes).toBe(180_000)
  })
})
