import { afterAll, describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import process from 'node:process'
import {
  BkTree,
  batchByUniqueBasename,
  findSimilarImages,
  hammingDistance,
  hashBmp,
  isLossless,
  pruneThumbnailCache,
  sweepStagingDirs,
} from '@system-cleaner/disk'

/**
 * Similar images — stacksjs/system-cleaner#34.
 *
 * The hash is a contract. Every stored distance, every group and every
 * keeper suggestion depends on the exact bit order `hashBmp` produces, so a
 * silent change to it would not fail loudly — it would quietly reclassify
 * every photo on the machine. Most of what follows pins that, and pins the
 * BK-tree against the brute-force answer it is an optimisation of.
 */

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-simimg-test-'))
afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }))

/** A 24-bit, top-down, uncompressed BMP — the shape `sips -z 8 9` writes. */
function makeBmp(width: number, height: number, pixel: (x: number, y: number) => number): Uint8Array {
  const stride = Math.ceil((width * 3) / 4) * 4
  const bytes = new Uint8Array(54 + stride * height)
  const dv = new DataView(bytes.buffer)
  bytes[0] = 0x42
  bytes[1] = 0x4D
  dv.setUint32(2, bytes.length, true)
  dv.setUint32(10, 54, true)
  dv.setUint32(14, 40, true)
  dv.setInt32(18, width, true)
  dv.setInt32(22, -height, true) // negative: top-down
  dv.setUint16(26, 1, true)
  dv.setUint16(28, 24, true)
  dv.setUint32(30, 0, true)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = Math.max(0, Math.min(255, Math.round(pixel(x, y))))
      const i = 54 + y * stride + x * 3
      bytes[i] = v // B
      bytes[i + 1] = v // G
      bytes[i + 2] = v // R
    }
  }
  return bytes
}

describe('hashBmp', () => {
  it('reads the 9x8 grid sips produces', () => {
    // Brightness increasing left to right: every pixel is darker than its
    // right-hand neighbour, so every comparison is false and the hash is 0.
    const hash = hashBmp(makeBmp(9, 8, x => x * 28))
    expect(hash).toBe(0n)
  })

  it('sets every bit when brightness decreases to the right', () => {
    // 8 rows x 8 comparisons, all true.
    const hash = hashBmp(makeBmp(9, 8, x => 255 - x * 28))
    expect(hash).toBe((1n << 64n) - 1n)
  })

  /**
   * The bit order is the contract. Row-major, left to right, most
   * significant bit first — a change here silently rewrites every hash.
   */
  it('packs the first comparison into the most significant bit', () => {
    // Only pixel (0,0) is brighter than (1,0); everything else is flat.
    const hash = hashBmp(makeBmp(9, 8, (x, y) => (y === 0 && x === 0 ? 255 : 0)))
    expect(hash).toBe(1n << 63n)
  })

  it('reads bottom-up rows the right way up', () => {
    const topDown = makeBmp(9, 8, (_x, y) => y * 30)
    // Same image stored bottom-up: flip the sign of the height and reverse
    // the row order. The hash must be identical.
    const dv = new DataView(topDown.buffer)
    dv.setInt32(22, 8, true)
    const stride = Math.ceil((9 * 3) / 4) * 4
    const rows: Uint8Array[] = []
    for (let y = 0; y < 8; y++)
      rows.push(topDown.slice(54 + y * stride, 54 + (y + 1) * stride))
    const bottomUp = new Uint8Array(topDown)
    rows.reverse().forEach((row, y) => bottomUp.set(row, 54 + y * stride))

    expect(hashBmp(bottomUp)).toBe(hashBmp(makeBmp(9, 8, (_x, y) => y * 30)))
  })

  it('refuses anything that is not the grid it expects', () => {
    // A hash computed from the wrong pixels is worse than no hash: it groups
    // images that have nothing to do with each other.
    expect(hashBmp(new Uint8Array(10))).toBeNull()
    expect(hashBmp(makeBmp(8, 8, () => 0)), '8 wide, not 9').toBeNull()
    expect(hashBmp(makeBmp(9, 9, () => 0)), '9 tall, not 8').toBeNull()
    const truncated = makeBmp(9, 8, () => 0).slice(0, 100)
    expect(hashBmp(truncated), 'pixel data cut short').toBeNull()
  })
})

describe('hammingDistance', () => {
  it('counts differing bits', () => {
    expect(hammingDistance(0n, 0n)).toBe(0)
    expect(hammingDistance(0b1011n, 0b1001n)).toBe(1)
    expect(hammingDistance(0n, (1n << 64n) - 1n)).toBe(64)
  })

  it('is symmetric', () => {
    const a = 0xDEADBEEFCAFEBABEn
    const b = 0x0123456789ABCDEFn
    expect(hammingDistance(a, b)).toBe(hammingDistance(b, a))
  })
})

describe('BkTree', () => {
  /**
   * The whole reason the tree exists is that all-pairs does not survive a
   * real library — 40,000 images is 800 million comparisons. An index that
   * misses neighbours would not look like a bug, it would look like a
   * scanner that found fewer duplicates, so this checks it against the
   * brute-force answer it replaces.
   */
  it('returns exactly what brute force would, over random hashes', () => {
    let seed = 42
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF
      return seed
    }
    const hashes: bigint[] = []
    for (let i = 0; i < 400; i++)
      hashes.push((BigInt(rand()) << 32n) ^ BigInt(rand()))

    const tree = new BkTree()
    hashes.forEach((h, i) => tree.add(h, i))

    for (const threshold of [0, 3, 10, 20]) {
      for (let i = 0; i < hashes.length; i += 17) {
        const brute = hashes
          .map((h, j) => [hammingDistance(hashes[i], h), j] as const)
          .filter(([d]) => d <= threshold)
          .map(([, j]) => j)
          .sort((a, b) => a - b)
        const found = tree.search(hashes[i], threshold).sort((a, b) => a - b)
        expect(found, `threshold ${threshold}, item ${i}`).toEqual(brute)
      }
    }
  })

  it('keeps duplicate hashes rather than overwriting them', () => {
    // Children are keyed by distance, so two identical hashes collide at
    // distance 0. Losing one would drop a real duplicate from its group.
    const tree = new BkTree()
    tree.add(0xABCDn, 1)
    tree.add(0xABCDn, 2)
    tree.add(0xABCDn, 3)
    expect(tree.search(0xABCDn, 0).sort()).toEqual([1, 2, 3])
  })

  it('finds nothing in an empty tree', () => {
    expect(new BkTree().search(1n, 10)).toEqual([])
  })
})

describe('batchByUniqueBasename', () => {
  /**
   * `sips --out <dir>` names each output after its input's basename, so two
   * `IMG_0001.jpg` in one batch would write to the same file and one photo
   * would silently receive the other's hash.
   */
  it('never puts two files with the same basename in one batch', () => {
    const paths = [
      '/a/IMG_0001.jpg', '/b/IMG_0001.jpg', '/c/IMG_0001.jpg',
      '/a/IMG_0002.jpg', '/b/IMG_0002.jpg',
    ]
    for (const batch of batchByUniqueBasename(paths, 10)) {
      const names = batch.map(p => path.basename(p).toLowerCase())
      expect(new Set(names).size).toBe(names.length)
    }
  })

  it('treats basenames case-insensitively, as the filesystem does', () => {
    // APFS is case-insensitive by default, so `photo.jpg` and `PHOTO.JPG`
    // are the same output path.
    for (const batch of batchByUniqueBasename(['/a/photo.jpg', '/b/PHOTO.JPG'], 10))
      expect(batch.length).toBe(1)
  })

  it('loses nothing and duplicates nothing', () => {
    const paths = Array.from({ length: 97 }, (_, i) => `/dir${i % 7}/file${i % 13}.png`)
    const flat = batchByUniqueBasename(paths, 8).flat()
    expect(flat.length).toBe(paths.length)
    expect(flat.slice().sort()).toEqual(paths.slice().sort())
  })

  it('respects the batch size', () => {
    const paths = Array.from({ length: 50 }, (_, i) => `/a/f${i}.png`)
    for (const batch of batchByUniqueBasename(paths, 8))
      expect(batch.length).toBeLessThanOrEqual(8)
  })

  it('handles an empty list', () => {
    expect(batchByUniqueBasename([], 8)).toEqual([])
  })
})

describe('isLossless', () => {
  it('knows which formats keep every pixel', () => {
    // Only used to break a resolution tie, where the lossless file is the
    // better original whatever the sizes say.
    expect(isLossless('/x/a.png')).toBe(true)
    expect(isLossless('/x/a.TIFF')).toBe(true)
    expect(isLossless('/x/a.jpg')).toBe(false)
    expect(isLossless('/x/a.heic')).toBe(false)
  })
})

describe('findSimilarImages', () => {
  it.skipIf(process.platform === 'darwin')('reports unsupported rather than clean off macOS', async () => {
    // `sips` is Apple's and there is no other decoder here. Zero groups
    // would read as "no similar images", which is the #23 capability lesson.
    const result = await findSimilarImages({ roots: [scratch] })
    expect(result.supported).toBe(false)
    expect(result.groups).toEqual([])
  })

  it.skipIf(process.platform !== 'darwin')('groups re-encodes and resizes, and nothing else', async () => {
    const dir = path.join(scratch, 'corpus')
    fs.mkdirSync(dir, { recursive: true })

    // The fixture has to have *large-scale* structure, because the hash only
    // ever sees a 9x8 reduction. A first attempt used a 32px checkerboard:
    // at 512 wide each output pixel averages ~57 source pixels, nearly two
    // whole cells, so the pattern reduced to mush and its own JPEG landed 10
    // bits away. A low-frequency wave survives the reduction the way a
    // photograph does.
    const source = path.join(dir, 'a-source.bmp')
    fs.writeFileSync(source, makeBmp(512, 512, (x, y) =>
      128 + 120 * Math.sin((x / 512) * 3 * Math.PI) * Math.cos((y / 512) * 2 * Math.PI)))

    const sips = (args: string[]) => spawnSync('sips', args, { stdio: 'ignore' })
    sips(['-s', 'format', 'png', source, '--out', path.join(dir, 'b-lossless.png')])
    sips(['-s', 'format', 'jpeg', '-s', 'formatOptions', '85', source, '--out', path.join(dir, 'c-jpeg.jpg')])
    sips(['-s', 'format', 'png', '-Z', '300', source, '--out', path.join(dir, 'd-smaller.png')])
    // A different picture entirely. A linear ramp measures 32 bits from the
    // wave — half the hash — so this asserts real separation rather than a
    // near miss. The same measurement rejected a radial pattern, which came
    // out at 12 and would have been one threshold tweak from flaking.
    const other = path.join(dir, 'z-unrelated.bmp')
    fs.writeFileSync(other, makeBmp(512, 512, (x, y) => 20 + 200 * ((x / 512) * 0.7 + (y / 512) * 0.3)))

    const result = await findSimilarImages({ roots: [dir], timeoutMs: 120_000 })

    expect(result.supported).toBe(true)
    expect(result.groups.length, 'one group, not one per pair').toBe(1)

    const group = result.groups[0]
    const names = group.files.map(f => f.name).sort()
    expect(names).toEqual(['a-source.bmp', 'b-lossless.png', 'c-jpeg.jpg', 'd-smaller.png'])
    expect(names, 'an unrelated image must never be grouped').not.toContain('z-unrelated.bmp')

    // The keeper is full resolution and lossless, and is never one of the
    // files the screen would offer to delete.
    const keeper = group.files.find(f => f.path === group.keeperPath)!
    expect(keeper.width).toBe(512)
    expect(isLossless(keeper.path)).toBe(true)

    // Wasted space excludes the keeper, or the screen would promise to free
    // more than deleting could.
    const total = group.files.reduce((sum, f) => sum + f.sizeBytes, 0)
    expect(group.wastedBytes).toBe(total - keeper.sizeBytes)
  }, 180_000)

  it.skipIf(process.platform !== 'darwin')('ignores images too small to hash reliably', async () => {
    // Resampling a tiny image to 9x8 is mostly noise: measured on a 100x100
    // source, a *lossless* format change came out at distance 14, which is
    // further than some genuinely different photographs.
    const dir = path.join(scratch, 'tiny')
    fs.mkdirSync(dir, { recursive: true })
    for (const n of ['a', 'b'])
      fs.writeFileSync(path.join(dir, `${n}.bmp`), makeBmp(64, 64, x => x * 4))

    const result = await findSimilarImages({ roots: [dir], timeoutMs: 60_000 })
    expect(result.candidates).toBe(0)
    expect(result.groups).toEqual([])
  }, 120_000)
})

/**
 * The caches this feature creates, and the fact that it clears them.
 *
 * A tool whose entire purpose is reclaiming disk space must not quietly
 * accrue any. Thumbnails are small individually and a scan of a photo
 * library mints thousands of them in one sitting, so both bounds matter.
 */
describe('cache pruning', () => {
  function cacheWith(entries: { name: string, bytes: number, ageMs: number }[], now: number): string {
    const dir = fs.mkdtempSync(path.join(scratch, 'cache-'))
    for (const e of entries) {
      const full = path.join(dir, e.name)
      fs.writeFileSync(full, Buffer.alloc(e.bytes, 1))
      const when = new Date(now - e.ageMs)
      fs.utimesSync(full, when, when)
    }
    return dir
  }

  it('drops thumbnails nobody has looked at in a week', () => {
    const now = Date.now()
    const day = 24 * 60 * 60_000
    const dir = cacheWith([
      { name: 'fresh.jpg', bytes: 100, ageMs: day },
      { name: 'stale.jpg', bytes: 100, ageMs: 9 * day },
    ], now)

    const result = pruneThumbnailCache({ dir, now })
    expect(result.removed).toBe(1)
    expect(fs.readdirSync(dir)).toEqual(['fresh.jpg'])
  })

  it('evicts least recently used once the cache is too big', () => {
    // `renderImageThumbnail` touches a file when it serves it from cache, so
    // mtime order is use order, not creation order.
    const now = Date.now()
    const dir = cacheWith([
      { name: 'oldest.jpg', bytes: 1000, ageMs: 3000 },
      { name: 'middle.jpg', bytes: 1000, ageMs: 2000 },
      { name: 'newest.jpg', bytes: 1000, ageMs: 1000 },
    ], now)

    const result = pruneThumbnailCache({ dir, now, maxBytes: 2000, maxAgeMs: 60 * 60_000 })
    expect(result.removed).toBe(1)
    expect(result.freedBytes).toBe(1000)
    expect(fs.readdirSync(dir).sort()).toEqual(['middle.jpg', 'newest.jpg'])
  })

  it('leaves a cache that is within both bounds completely alone', () => {
    const now = Date.now()
    const dir = cacheWith([{ name: 'a.jpg', bytes: 10, ageMs: 1000 }], now)
    expect(pruneThumbnailCache({ dir, now })).toEqual({ removed: 0, freedBytes: 0 })
    expect(fs.readdirSync(dir)).toEqual(['a.jpg'])
  })

  it('touches nothing that is not a thumbnail', () => {
    const now = Date.now()
    const dir = cacheWith([{ name: 'ancient.jpg', bytes: 10, ageMs: 99 * 24 * 60 * 60_000 }], now)
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'not mine to delete')
    pruneThumbnailCache({ dir, now })
    expect(fs.existsSync(path.join(dir, 'notes.txt'))).toBe(true)
  })

  it('reports an empty result when there is no cache yet', () => {
    // The common case on a first scan, and it must not throw into the route.
    expect(pruneThumbnailCache({ dir: path.join(scratch, 'never-created') }))
      .toEqual({ removed: 0, freedBytes: 0 })
  })

  it('sweeps staging directories a killed scan left behind, but not live ones', () => {
    // A scan removes its staging tree in a `finally`, so the only way one
    // survives is the process dying mid-scan — quitting the app during a
    // long photo-library scan does exactly that.
    const now = Date.now()
    const tmp = fs.mkdtempSync(path.join(scratch, 'tmp-'))
    const stale = path.join(tmp, 'sc-simimg-stale')
    const live = path.join(tmp, 'sc-simimg-live')
    const other = path.join(tmp, 'someone-elses-dir')
    for (const d of [stale, live, other]) fs.mkdirSync(d)
    const old = new Date(now - 3 * 60 * 60_000)
    fs.utimesSync(stale, old, old)
    fs.utimesSync(other, old, old)

    expect(sweepStagingDirs(60 * 60_000, now, tmp)).toBe(1)
    expect(fs.existsSync(stale)).toBe(false)
    expect(fs.existsSync(live), 'a scan running right now').toBe(true)
    expect(fs.existsSync(other), 'not ours to delete').toBe(true)
  })
})
