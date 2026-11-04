import type { FileCategory } from '@system-cleaner/core'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { formatBytes, HOME, isMacOS } from '@system-cleaner/core'
import { BUNDLE_SUFFIXES, SKIP_DIRS } from './large-files'

/**
 * Photos that look the same without being the same file.
 *
 * `duplicates.ts` is exact-match by construction: its first pass buckets by
 * byte size, so two JPEGs of one scene never reach the hashing passes at all.
 * That is the right default and the wrong ceiling for a photo library, where
 * the redundancy is almost never bitwise — the burst of nine frames where one
 * was wanted, the HEIC and its JPEG export, the screenshot taken twice a
 * second apart, the image re-saved by an editor at a different quality.
 *
 * See stacksjs/system-cleaner#34.
 *
 * ## How an image becomes 64 bits
 *
 * `sips -s format bmp -z 8 9` resamples to exactly 9x8 — aspect ratio
 * deliberately ignored, which is what a perceptual hash wants — and BMP is
 * the output format because it is uncompressed: a 54-byte header and then
 * rows of BGR triples. PNG would mean inflate plus unfilter plus depalette
 * for a 278-byte file. `sips` itself is already how this project renders app
 * icons (`core/src/icons.ts`), so it adds no dependency.
 *
 * The hash is a dHash: each pixel compared with the one to its right, 8 rows
 * of 8 comparisons, 64 bits. Gradients rather than absolute brightness, which
 * is what makes it survive re-encoding.
 *
 * Measured on a 2048x1320 source, distance from the original:
 *
 *     JPEG re-encode q90      0
 *     JPEG re-encode q20      1
 *     downscaled to 1024px    0
 *     downscaled to 320px     0
 *     cropped                13
 *     same image, dark theme 41
 *
 * Re-encodes and resizes land at 0-1 and an unrelated image at 41, so the
 * default threshold has an enormous margin. Crops sit awkwardly in between
 * and are not reliably caught; that is a known limit of dHash and not worth
 * loosening the threshold for, because 13 is also where genuinely different
 * photographs of the same scene start to appear.
 *
 * ## Why there is a minimum dimension
 *
 * The same measurement on a 100x100 source put a *lossless* PNG conversion at
 * distance 14 — resampling a tiny image to 9x8 is mostly noise, and noise
 * produces both misses and false matches. Thumbnails, favicons and sprite
 * sheets are excluded rather than reported unreliably.
 */

/**
 * Formats that store every pixel they were given.
 *
 * Used only to break a tie between two images of identical resolution, where
 * the lossless one is the better original whatever the file sizes say.
 */
const LOSSLESS_EXTENSIONS = new Set(['.png', '.tiff', '.tif', '.bmp'])

export function isLossless(filePath: string): boolean {
  return LOSSLESS_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

/** Extensions worth decoding. Matches the `image` category, minus the vectors. */
const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.tif',
  '.webp', '.heic', '.heif', '.avif',
])

/**
 * Below this on the shorter side, the hash is noise. See the header.
 *
 * Also removes the bulk of what a home folder actually contains — icons,
 * favicons, avatars, UI assets — which is most of the win in scan time.
 */
const DEFAULT_MIN_DIMENSION = 256

/**
 * Bits that may differ before two images are called different.
 *
 * 10 of 64. Comfortably above the 0-1 that re-encodes and resizes produce,
 * and far below the 30+ where unrelated images sit.
 */
const DEFAULT_THRESHOLD = 10

/**
 * Files handed to one `sips` invocation, and how many run at once.
 *
 * Both measured rather than guessed, on 200 images:
 *
 *     one spawn per image            112 ms/image
 *     batched, serial                 37 ms/image
 *     batched, 4 in parallel          15 ms/image
 *     batched, 8 in parallel          14 ms/image
 *     batched, 10 in parallel         16 ms/image
 *
 * It plateaus at 8 on a 10-core machine and gets worse past it, so the
 * concurrency is capped there rather than set to the core count.
 */
const DEFAULT_BATCH = 25
const DEFAULT_CONCURRENCY = 8

const DEFAULT_LIMIT = 200
const DEFAULT_TIMEOUT_MS = 10 * 60_000
const DEFAULT_MAX_ENTRIES = 200_000

export interface SimilarImage {
  path: string
  name: string
  sizeBytes: number
  sizeFormatted: string
  width: number
  height: number
  modifiedAt: Date
  /** The dHash as hex, so a group's membership can be explained. */
  hash: string
  /** Bits differing from the group's keeper. 0 means visually identical. */
  distance: number
}

export interface SimilarImageGroup {
  id: string
  count: number
  /**
   * The copy this screen suggests keeping — never deleted, never selectable.
   *
   * Highest pixel count, then lossless over lossy, then largest file, then
   * oldest, then shallowest path.
   *
   * A different rule from `duplicates.ts`, which keeps the *oldest* copy:
   * there every file is byte-identical so age is the only meaningful
   * tiebreak, whereas here the candidates differ in quality and the
   * full-resolution original is the one worth keeping.
   *
   * Format outranks file size because size is not a quality proxy across
   * formats. Measured on a real pair: a 2048x1320 JPEG at 247 KB beside the
   * 2048x1320 PNG it was exported from at 132 KB — ranking on size alone
   * suggested keeping the lossy copy and deleting the lossless original.
   */
  keeperPath: string
  /** The widest distance in the group — how loose this match is. */
  spread: number
  /** What deleting everything but the keeper would free. */
  wastedBytes: number
  wastedFormatted: string
  files: SimilarImage[]
}

export interface SimilarImageScanOptions {
  roots?: string[]
  minDimension?: number
  /** Maximum differing bits. Defaults to 10 of 64. */
  threshold?: number
  limit?: number
  timeoutMs?: number
  maxEntries?: number
  concurrency?: number
  includeDependencies?: boolean
  onProgress?: (hashed: number, total: number, currentPath: string) => void
}

export interface SimilarImageScanResult {
  groups: SimilarImageGroup[]
  /** Image files found that were worth hashing. */
  candidates: number
  /** Of those, how many produced a hash. */
  hashed: number
  /** Images in at least one group. */
  grouped: number
  totalWastedBytes: number
  totalWastedFormatted: string
  truncated: boolean
  scanTimeMs: number
  /** False off macOS, where there is no `sips`. */
  supported: boolean
}

/* ── the hash ─────────────────────────────────────────────── */

/**
 * Decode a 9x8 24-bit BMP into greyscale, then dHash it.
 *
 * Exported for the tests, which build BMPs by hand rather than shelling out
 * to `sips` — the bit order is the contract between this and every stored
 * hash, and a silent change to it would reclassify every image on the next
 * scan.
 */
export function hashBmp(bytes: Uint8Array): bigint | null {
  if (bytes.length < 54 || bytes[0] !== 0x42 || bytes[1] !== 0x4D)
    return null

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const pixelOffset = view.getUint32(10, true)
  const width = view.getInt32(18, true)
  const rawHeight = view.getInt32(22, true)
  const height = Math.abs(rawHeight)
  const bpp = view.getUint16(28, true)
  const compression = view.getUint32(30, true)

  // Only the shape `sips` actually writes. Anything else is a BMP this was
  // not asked to read, and guessing at it would produce a plausible-looking
  // hash for the wrong pixels.
  if (width !== 9 || height !== 8 || bpp !== 24 || compression !== 0)
    return null

  // Rows are padded to a 4-byte boundary, and a negative height means the
  // rows are stored top-down rather than BMP's usual bottom-up.
  const stride = Math.ceil((width * 3) / 4) * 4
  const topDown = rawHeight < 0
  if (pixelOffset + stride * height > bytes.length)
    return null

  const grey = new Float64Array(width * height)
  for (let y = 0; y < height; y++) {
    const row = pixelOffset + (topDown ? y : height - 1 - y) * stride
    for (let x = 0; x < width; x++) {
      const i = row + x * 3
      // BGR, and the usual luma weights.
      grey[y * width + x] = 0.114 * bytes[i] + 0.587 * bytes[i + 1] + 0.299 * bytes[i + 2]
    }
  }

  let hash = 0n
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width - 1; x++)
      hash = (hash << 1n) | (grey[y * width + x] > grey[y * width + x + 1] ? 1n : 0n)
  }
  return hash
}

/** Differing bits between two hashes. */
export function hammingDistance(a: bigint, b: bigint): number {
  let v = a ^ b
  let n = 0
  while (v) {
    v &= v - 1n
    n++
  }
  return n
}

/* ── grouping ─────────────────────────────────────────────── */

interface BkNode {
  hash: bigint
  index: number
  children: Map<number, BkNode>
}

/**
 * A BK-tree over Hamming distance.
 *
 * All-pairs is the obvious way to group these and it does not survive a real
 * library: 40,000 images is 800 million comparisons. A BK-tree exploits the
 * triangle inequality to visit only the branches that could contain a match,
 * which for a threshold of 10 on 64 bits is a small fraction of the tree.
 *
 * Exported so the suite can check it returns exactly what a brute-force
 * scan would — a structure that silently misses neighbours would look like
 * a scanner that found fewer duplicates, not like a bug.
 */
export class BkTree {
  private root: BkNode | null = null

  add(hash: bigint, index: number): void {
    if (!this.root) {
      this.root = { hash, index, children: new Map() }
      return
    }

    let node = this.root
    for (;;) {
      const d = hammingDistance(hash, node.hash)
      // An exact duplicate of a hash already in the tree: BK-trees key
      // children by distance, and distance 0 would otherwise overwrite the
      // node. Walk into it instead, so both are findable.
      const next = node.children.get(d)
      if (!next) {
        node.children.set(d, { hash, index, children: new Map() })
        return
      }
      node = next
    }
  }

  /** Every index whose hash is within `threshold` bits of `hash`. */
  search(hash: bigint, threshold: number): number[] {
    const found: number[] = []
    if (!this.root)
      return found

    const stack: BkNode[] = [this.root]
    while (stack.length > 0) {
      const node = stack.pop()!
      const d = hammingDistance(hash, node.hash)
      if (d <= threshold)
        found.push(node.index)

      // The triangle inequality: a child at distance `k` from this node can
      // only hold a match if `k` is within `threshold` of `d`.
      for (const [k, child] of node.children) {
        if (k >= d - threshold && k <= d + threshold)
          stack.push(child)
      }
    }
    return found
  }
}

/** Union-find, to merge overlapping neighbourhoods into one group each. */
class DisjointSet {
  private parent: number[]

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i)
  }

  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]]
      i = this.parent[i]
    }
    return i
  }

  union(a: number, b: number): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb)
      this.parent[rb] = ra
  }
}

/* ── walking ──────────────────────────────────────────────── */

interface Candidate {
  path: string
  sizeBytes: number
  modifiedAt: Date
  width: number
  height: number
}

function isBundle(name: string): boolean {
  return BUNDLE_SUFFIXES.some(suffix => name.endsWith(suffix))
}

function collectImages(
  roots: string[],
  includeDependencies: boolean,
  maxEntries: number,
  deadline: number,
): { files: { path: string, sizeBytes: number, modifiedAt: Date }[], truncated: boolean } {
  const files: { path: string, sizeBytes: number, modifiedAt: Date }[] = []
  const queue = [...roots]
  const seen = new Set<string>()
  let visited = 0

  while (queue.length > 0) {
    if (visited >= maxEntries || Date.now() > deadline)
      return { files, truncated: true }

    const dir = queue.pop()!
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    }
    catch {
      continue
    }

    for (const entry of entries) {
      visited++
      const full = path.join(dir, entry.name)

      if (entry.isSymbolicLink())
        continue

      if (entry.isDirectory()) {
        // A `.photoslibrary` is the interesting case and the dangerous one:
        // it is full of images, and every one of them is owned by Photos
        // rather than by the user. Deleting from inside one corrupts the
        // library, so the whole bundle is skipped.
        if (isBundle(entry.name))
          continue
        if (!includeDependencies && SKIP_DIRS.has(entry.name))
          continue
        if (entry.name.startsWith('.'))
          continue
        if (seen.has(full))
          continue
        seen.add(full)
        queue.push(full)
        continue
      }

      if (!entry.isFile())
        continue
      if (!IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
        continue

      try {
        const stat = fs.statSync(full)
        files.push({ path: full, sizeBytes: stat.size, modifiedAt: stat.mtime })
      }
      catch { /* vanished between readdir and stat */ }
    }
  }

  return { files, truncated: false }
}

/* ── decoding ─────────────────────────────────────────────── */

async function runSips(args: string[], timeoutMs: number): Promise<boolean> {
  try {
    const proc = Bun.spawn(['sips', ...args], {
      stdout: 'ignore',
      stderr: 'ignore',
      stdin: 'ignore',
    })
    const timer = setTimeout(() => proc.kill(), timeoutMs)
    try {
      return (await proc.exited) === 0
    }
    finally {
      clearTimeout(timer)
    }
  }
  catch {
    return false
  }
}

/**
 * Read every candidate's dimensions in one pass.
 *
 * One `sips -g` invocation per batch rather than per file, for the same
 * reason the decode is batched. Images below the minimum are dropped here,
 * before anything is resampled, which is where most of the scan time is
 * saved on a real home folder full of icons.
 */
async function readDimensions(
  paths: string[],
  timeoutMs: number,
): Promise<Map<string, { width: number, height: number }>> {
  const out = new Map<string, { width: number, height: number }>()
  try {
    const proc = Bun.spawn(['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', ...paths], {
      stdout: 'pipe',
      stderr: 'ignore',
      stdin: 'ignore',
    })
    const timer = setTimeout(() => proc.kill(), timeoutMs)
    let text: string
    try {
      text = await new Response(proc.stdout).text()
      await proc.exited
    }
    finally {
      clearTimeout(timer)
    }

    // `sips -g` prints each path on its own line — bare, with no trailing
    // colon — then one indented `key: value` per property:
    //
    //     /path/to/a.png
    //       pixelWidth: 2048
    //       pixelHeight: 1320
    //
    // The indent is the only thing separating a property from a path, which
    // is why this keys on `startsWith(' ')` rather than on punctuation.
    let current = ''
    let width = 0
    let height = 0
    for (const line of text.split('\n')) {
      if (line.length > 0 && !line.startsWith(' ')) {
        if (current && width > 0 && height > 0)
          out.set(current, { width, height })
        current = line.endsWith(':') ? line.slice(0, -1) : line
        width = 0
        height = 0
        continue
      }
      const w = /pixelWidth:\s*(\d+)/.exec(line)
      if (w) width = Number(w[1])
      const h = /pixelHeight:\s*(\d+)/.exec(line)
      if (h) height = Number(h[1])
    }
    if (current && width > 0 && height > 0)
      out.set(current, { width, height })
  }
  catch { /* the whole batch is simply unmeasured */ }

  return out
}

/**
 * Batches in which no two files share a basename.
 *
 * `sips --out <dir>` names each output after its input's basename, so two
 * `IMG_0001.jpg` from different folders in one batch would write to the same
 * file and the second would win — silently giving one photo the other's
 * hash. Splitting them across batches costs nothing and removes the whole
 * class of mistake.
 */
export function batchByUniqueBasename(paths: string[], batchSize: number): string[][] {
  const batches: string[][] = []
  const pending = [...paths]

  while (pending.length > 0) {
    const batch: string[] = []
    const taken = new Set<string>()
    const leftover: string[] = []

    for (const p of pending) {
      const base = path.basename(p).toLowerCase()
      if (batch.length < batchSize && !taken.has(base)) {
        taken.add(base)
        batch.push(p)
      }
      else {
        leftover.push(p)
      }
    }

    batches.push(batch)
    pending.length = 0
    pending.push(...leftover)
  }

  return batches
}

/* ── the scan ─────────────────────────────────────────────── */

export async function findSimilarImages(
  options: SimilarImageScanOptions = {},
): Promise<SimilarImageScanResult> {
  const startedAt = Date.now()
  const empty = (supported: boolean): SimilarImageScanResult => ({
    groups: [],
    candidates: 0,
    hashed: 0,
    grouped: 0,
    totalWastedBytes: 0,
    totalWastedFormatted: formatBytes(0),
    truncated: false,
    scanTimeMs: Date.now() - startedAt,
    supported,
  })

  // `sips` is Apple's, and the decode has no other implementation here.
  // Reporting zero groups on Linux would read as "no similar images".
  if (!isMacOS)
    return empty(false)

  // A scan is both the moment this module's caches are about to grow and the
  // only moment it reliably runs, so it tidies up after itself here rather
  // than leaving a tool that reclaims disk space quietly accruing some.
  pruneThumbnailCache()
  sweepStagingDirs()

  const roots = options.roots?.length ? options.roots : [os.homedir()]
  const minDimension = options.minDimension ?? DEFAULT_MIN_DIMENSION
  const threshold = options.threshold ?? DEFAULT_THRESHOLD
  const limit = options.limit ?? DEFAULT_LIMIT
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY)
  const deadline = startedAt + timeoutMs

  const walked = collectImages(
    roots,
    options.includeDependencies === true,
    options.maxEntries ?? DEFAULT_MAX_ENTRIES,
    deadline,
  )
  let truncated = walked.truncated

  // Dimensions first, so the resample never runs for an icon.
  //
  // Keyed by the resolved path as well as the one we walked, because `sips`
  // echoes back a *canonical* path: on macOS `/var/folders/...` is a symlink
  // to `/private/var/folders/...`, and `/tmp` to `/private/tmp`. Keying on
  // the original alone meant every lookup missed and the scan reported no
  // candidates at all for anything under a symlinked directory — which is
  // every temporary directory on the system, and any home folder where
  // Pictures has been moved to another volume and linked back.
  const candidates: Candidate[] = []
  const sized = batchByUniqueBasename(walked.files.map(f => f.path), 200)
  const byPath = new Map<string, typeof walked.files[number]>()
  for (const file of walked.files) {
    byPath.set(file.path, file)
    try {
      const real = fs.realpathSync(file.path)
      if (real !== file.path)
        byPath.set(real, file)
    }
    catch { /* vanished; the walked path is still registered */ }
  }
  for (const batch of sized) {
    if (Date.now() > deadline) {
      truncated = true
      break
    }
    const dims = await readDimensions(batch, 30_000)
    for (const [p, { width, height }] of dims) {
      const file = byPath.get(p)
      if (!file)
        continue
      if (Math.min(width, height) < minDimension)
        continue
      candidates.push({ ...file, width, height })
    }
  }

  if (candidates.length === 0)
    return { ...empty(true), truncated }

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-simimg-'))
  const hashes: (bigint | null)[] = Array.from({ length: candidates.length }, () => null)
  const indexByPath = new Map(candidates.map((c, i) => [c.path, i]))
  let hashed = 0

  try {
    const batches = batchByUniqueBasename(candidates.map(c => c.path), DEFAULT_BATCH)

    for (let i = 0; i < batches.length; i += concurrency) {
      if (Date.now() > deadline) {
        truncated = true
        break
      }

      const slice = batches.slice(i, i + concurrency)
      await Promise.all(slice.map(async (batch, n) => {
        const outDir = path.join(staging, `b${i + n}`)
        try {
          fs.mkdirSync(outDir, { recursive: true })
        }
        catch {
          return
        }

        // `-z 8 9` is height then width, and forces both — the aspect ratio
        // is deliberately discarded so every image lands on the same grid.
        await runSips(['-s', 'format', 'bmp', '-z', '8', '9', ...batch, '--out', outDir], 60_000)

        for (const file of batch) {
          const produced = path.join(outDir, `${path.basename(file, path.extname(file))}.bmp`)
          let bytes: Uint8Array
          try {
            bytes = new Uint8Array(fs.readFileSync(produced))
          }
          catch {
            // sips named it something else, or refused the file. Either way
            // it contributes no hash rather than a wrong one.
            continue
          }
          const hash = hashBmp(bytes)
          const index = indexByPath.get(file)
          if (hash !== null && index !== undefined) {
            hashes[index] = hash
            hashed++
          }
        }

        try {
          fs.rmSync(outDir, { recursive: true, force: true })
        }
        catch { /* the whole staging dir goes at the end anyway */ }
      }))

      options.onProgress?.(hashed, candidates.length, batches[Math.min(i, batches.length - 1)][0] ?? '')
    }
  }
  finally {
    try {
      fs.rmSync(staging, { recursive: true, force: true })
    }
    catch { /* a temp dir macOS will clear itself */ }
  }

  // Group.
  const tree = new BkTree()
  const live: number[] = []
  for (let i = 0; i < hashes.length; i++) {
    if (hashes[i] !== null) {
      tree.add(hashes[i]!, i)
      live.push(i)
    }
  }

  const sets = new DisjointSet(candidates.length)
  for (const i of live) {
    for (const j of tree.search(hashes[i]!, threshold)) {
      if (i !== j)
        sets.union(i, j)
    }
  }

  const byRoot = new Map<number, number[]>()
  for (const i of live) {
    const root = sets.find(i)
    const members = byRoot.get(root)
    if (members)
      members.push(i)
    else
      byRoot.set(root, [i])
  }

  const groups: SimilarImageGroup[] = []
  let grouped = 0
  let totalWastedBytes = 0

  for (const members of byRoot.values()) {
    if (members.length < 2)
      continue

    // Highest resolution, then lossless, then file size, then age, then
    // path depth. See the note on `keeperPath`.
    const keeperIndex = members.reduce((best, i) => {
      const a = candidates[i]
      const b = candidates[best]
      const pa = a.width * a.height
      const pb = b.width * b.height
      if (pa !== pb) return pa > pb ? i : best
      const la = isLossless(a.path)
      const lb = isLossless(b.path)
      if (la !== lb) return la ? i : best
      if (a.sizeBytes !== b.sizeBytes) return a.sizeBytes > b.sizeBytes ? i : best
      if (a.modifiedAt.getTime() !== b.modifiedAt.getTime())
        return a.modifiedAt < b.modifiedAt ? i : best
      return a.path.split(path.sep).length < b.path.split(path.sep).length ? i : best
    }, members[0])

    const keeperHash = hashes[keeperIndex]!
    let spread = 0
    const files: SimilarImage[] = members.map((i) => {
      const c = candidates[i]
      const distance = hammingDistance(keeperHash, hashes[i]!)
      if (distance > spread)
        spread = distance
      return {
        path: c.path,
        name: path.basename(c.path),
        sizeBytes: c.sizeBytes,
        sizeFormatted: formatBytes(c.sizeBytes),
        width: c.width,
        height: c.height,
        modifiedAt: c.modifiedAt,
        hash: hashes[i]!.toString(16).padStart(16, '0'),
        distance,
      }
    })

    files.sort((a, b) => {
      if (a.path === candidates[keeperIndex].path) return -1
      if (b.path === candidates[keeperIndex].path) return 1
      return a.distance - b.distance || b.sizeBytes - a.sizeBytes
    })

    const wastedBytes = files.reduce((sum, f) => sum + f.sizeBytes, 0)
      - candidates[keeperIndex].sizeBytes

    grouped += members.length
    totalWastedBytes += wastedBytes

    groups.push({
      id: crypto.createHash('sha1').update(files.map(f => f.path).sort().join('\0')).digest('hex').slice(0, 16),
      count: files.length,
      keeperPath: candidates[keeperIndex].path,
      spread,
      wastedBytes,
      wastedFormatted: formatBytes(wastedBytes),
      files,
    })
  }

  groups.sort((a, b) => b.wastedBytes - a.wastedBytes)

  return {
    groups: groups.slice(0, limit),
    candidates: candidates.length,
    hashed,
    grouped,
    totalWastedBytes,
    totalWastedFormatted: formatBytes(totalWastedBytes),
    truncated: truncated || groups.length > limit,
    scanTimeMs: Date.now() - startedAt,
    supported: true,
  }
}

export type { FileCategory }

/* ── thumbnails ───────────────────────────────────────────── */

/**
 * Where rendered thumbnails live.
 *
 * `~/Library/Caches`, not `os.tmpdir()`. Two reasons, and the second is the
 * one that matters: macOS only sweeps `/var/folders` for files untouched for
 * three days and then only under disk pressure, so a tool whose entire
 * purpose is reclaiming space would have been quietly accruing a few hundred
 * megabytes of JPEGs somewhere nobody thinks to look. Here it sits under the
 * `user-caches` target this app already offers to clean, so Quick Clean
 * sweeps it like any other application's cache — including its own.
 *
 * It is still pruned automatically; see `pruneThumbnailCache`.
 */
export const THUMBNAIL_CACHE_DIR: string = path.join(
  HOME,
  'Library/Caches/org.stacksjs.system-cleaner/thumbnails',
)

/** A week, after which a thumbnail is cheaper to re-render than to keep. */
const THUMBNAIL_MAX_AGE_MS = 7 * 24 * 60 * 60_000

/** Ceiling on the cache. At ~8 KB a thumbnail this is some 12,000 of them. */
const THUMBNAIL_MAX_BYTES = 100 * 1024 * 1024

export interface PruneResult {
  removed: number
  freedBytes: number
}

/**
 * Keep the thumbnail cache bounded, by age and then by size.
 *
 * Runs at the start of every scan, which is both the moment the cache is
 * about to grow and the only moment this module reliably gets. Age first
 * because a thumbnail for a photo nobody has looked at in a week is dead
 * weight; size second, evicting least-recently-used, because a single scan
 * of a large library can mint thousands in one sitting.
 *
 * Eviction is by mtime, and `renderImageThumbnail` touches a file when it
 * serves it from cache, so "oldest" means least recently *used* rather than
 * least recently created.
 */
export function pruneThumbnailCache(options: {
  maxAgeMs?: number
  maxBytes?: number
  now?: number
  /** Overridden only by the suite, which must not touch the real cache. */
  dir?: string
} = {}): PruneResult {
  const maxAgeMs = options.maxAgeMs ?? THUMBNAIL_MAX_AGE_MS
  const maxBytes = options.maxBytes ?? THUMBNAIL_MAX_BYTES
  const now = options.now ?? Date.now()
  const dir = options.dir ?? THUMBNAIL_CACHE_DIR

  let entries: { path: string, size: number, mtimeMs: number }[]
  try {
    entries = fs.readdirSync(dir)
      .filter(name => name.endsWith('.jpg'))
      .flatMap((name) => {
        const full = path.join(dir, name)
        try {
          const stat = fs.statSync(full)
          return [{ path: full, size: stat.size, mtimeMs: stat.mtimeMs }]
        }
        catch {
          return []
        }
      })
  }
  catch {
    // No cache directory yet, which is the common case on a first scan.
    return { removed: 0, freedBytes: 0 }
  }

  let removed = 0
  let freedBytes = 0
  const drop = (entry: { path: string, size: number }): void => {
    try {
      fs.rmSync(entry.path, { force: true })
      removed++
      freedBytes += entry.size
    }
    catch { /* someone else's to worry about */ }
  }

  const surviving: typeof entries = []
  for (const entry of entries) {
    if (now - entry.mtimeMs > maxAgeMs)
      drop(entry)
    else
      surviving.push(entry)
  }

  let total = surviving.reduce((sum, e) => sum + e.size, 0)
  if (total > maxBytes) {
    surviving.sort((a, b) => a.mtimeMs - b.mtimeMs)
    for (const entry of surviving) {
      if (total <= maxBytes)
        break
      drop(entry)
      total -= entry.size
    }
  }

  return { removed, freedBytes }
}

/**
 * Remove staging directories a previous scan did not get to delete.
 *
 * Each scan stages its BMPs in `mkdtemp` and removes the tree in a `finally`,
 * so the only way one survives is the process being killed mid-scan — which
 * is exactly what happens when someone quits the app during a long scan of a
 * photo library. Anything older than an hour cannot belong to a scan running
 * now.
 */
export function sweepStagingDirs(
  olderThanMs = 60 * 60_000,
  now = Date.now(),
  /** Overridden only by the suite. */
  tmp: string = os.tmpdir(),
): number {
  let swept = 0
  let names: string[]
  try {
    names = fs.readdirSync(tmp)
  }
  catch {
    return 0
  }

  for (const name of names) {
    if (!name.startsWith('sc-simimg-'))
      continue
    const full = path.join(tmp, name)
    try {
      if (now - fs.statSync(full).mtimeMs <= olderThanMs)
        continue
      fs.rmSync(full, { recursive: true, force: true })
      swept++
    }
    catch { /* in use, or already gone */ }
  }
  return swept
}

/** Sizes the review screen asks for. Anything else is refused. */
export const THUMBNAIL_SIZES = [160, 320] as const
export type ThumbnailSize = typeof THUMBNAIL_SIZES[number]

/**
 * A cached JPEG thumbnail of an image, for the review screen.
 *
 * Similar images cannot be judged from a filename — the whole point of the
 * screen is seeing the photographs side by side — so the UI needs real
 * pixels. This renders them with the same `sips` already used for hashing
 * and app icons, and caches by path, mtime and size so scrolling a group
 * twice costs one render.
 *
 * Returns a path to the cached file, or null. The caller is responsible for
 * having established that this is a file the user asked about: nothing here
 * checks, because this module has no idea what the request was.
 */
export function renderImageThumbnail(imagePath: string, size: ThumbnailSize = 160): string | null {
  if (!isMacOS)
    return null
  if (!(THUMBNAIL_SIZES as readonly number[]).includes(size))
    return null

  let mtime: number
  try {
    mtime = fs.statSync(imagePath).mtimeMs
  }
  catch {
    return null
  }

  const key = crypto.createHash('sha1')
    .update(`${imagePath}\0${mtime}\0${size}`)
    .digest('hex')
    .slice(0, 32)

  const out = path.join(THUMBNAIL_CACHE_DIR, `${key}.jpg`)

  try {
    if (fs.existsSync(out)) {
      // Touch it, so pruning evicts what nobody is looking at rather than
      // whatever happens to be oldest on disk.
      try { fs.utimesSync(out, new Date(), new Date()) }
      catch { /* an unwritable cache still serves reads */ }
      return out
    }
    fs.mkdirSync(THUMBNAIL_CACHE_DIR, { recursive: true })
  }
  catch {
    return null
  }

  // `-Z` preserves aspect ratio here, unlike the hashing path: this is for a
  // person to look at, not for a hash to compare.
  const result = Bun.spawnSync(
    ['sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', '70', '-Z', String(size), imagePath, '--out', out],
    { stdout: 'ignore', stderr: 'ignore', stdin: 'ignore' },
  )

  return result.exitCode === 0 && fs.existsSync(out) ? out : null
}
