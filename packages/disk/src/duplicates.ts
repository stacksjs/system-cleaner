import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { formatBytes, HOME } from '@system-cleaner/core'
import { BUNDLE_SUFFIXES, DEPENDENCY_DIRS, SKIP_DIRS } from './large-files'

/**
 * Duplicate file finder.
 *
 * The one feature in CCleaner's Mac build that had no counterpart here at all,
 * and the whole product Gemini sells on its own.
 *
 * Three passes, cheapest first, because the expensive one must never run on
 * more than it has to:
 *
 *   1. **Size.** Two files of different lengths cannot be duplicates. This
 *      pass is a `lstat` per file and discards the overwhelming majority.
 *   2. **Signature.** Head and tail of each same-size candidate. Files that
 *      differ usually differ in their first block — a header, a magic number,
 *      an EXIF timestamp — so this pass costs two reads and kills most of what
 *      pass one let through.
 *   3. **Full hash.** Only for files that survived both. This is the pass that
 *      makes the answer trustworthy, and the only one where deleting on a
 *      wrong result would lose data.
 *
 * A group is only ever reported once every one of its files has been hashed in
 * full. If the byte budget or the deadline stops that from happening, the
 * group is dropped and `truncated` is set — an unverified "duplicate" is worse
 * than a missing one, because the user acts on it.
 */
export interface DuplicateFile {
  path: string
  name: string
  directory: string
  sizeBytes: number
  modifiedAt: string
  /** True for the copy the scan suggests keeping. */
  keep: boolean
}

export interface DuplicateGroup {
  /** The content hash, which is also a stable id for the group. */
  id: string
  sizeBytes: number
  sizeFormatted: string
  count: number
  /** What deleting every copy but one would free. */
  wastedBytes: number
  wastedFormatted: string
  files: DuplicateFile[]
}

export interface DuplicateScanOptions {
  roots?: string[]
  /** Ignore files smaller than this. Defaults to 1 MB. */
  minSizeBytes?: number
  /** Maximum number of groups to return, most wasteful first. */
  limit?: number
  timeoutMs?: number
  maxEntries?: number
  /** Ceiling on bytes read during hashing. Defaults to 24 GB. */
  hashBudgetBytes?: number
  includeDependencies?: boolean
  onProgress?: (scanned: number, currentPath: string) => void
}

export interface DuplicateScanResult {
  groups: DuplicateGroup[]
  /** Entries visited during the walk. */
  scanned: number
  /** Groups found, which may exceed `groups.length`. */
  groupCount: number
  /** Redundant copies found across every group. */
  duplicateCount: number
  wastedBytes: number
  wastedFormatted: string
  truncated: boolean
  scanTimeMs: number
}

const PROGRESS_INTERVAL_MS = 250
const DEFAULT_MIN_SIZE = 1024 * 1024
const DEFAULT_LIMIT = 200
const DEFAULT_TIMEOUT_MS = 45_000
const DEFAULT_MAX_ENTRIES = 2_000_000
const DEFAULT_HASH_BUDGET = 24 * 1024 * 1024 * 1024

/** Bytes read from each end of a file for its signature. */
const SIGNATURE_CHUNK = 64 * 1024

function isBundle(name: string): boolean {
  const lower = name.toLowerCase()
  return BUNDLE_SUFFIXES.some(suffix => lower.endsWith(suffix))
}

/**
 * Hash the first and last {@link SIGNATURE_CHUNK} bytes.
 *
 * Returns null when the file cannot be read, which drops it from the run
 * rather than grouping it with whatever else failed the same way.
 */
function signature(file: string, size: number): string | null {
  let fd: number | null = null
  try {
    fd = fs.openSync(file, 'r')
    const hash = crypto.createHash('sha1')
    const chunk = Buffer.allocUnsafe(Math.min(SIGNATURE_CHUNK, size))

    const head = fs.readSync(fd, chunk, 0, chunk.length, 0)
    hash.update(chunk.subarray(0, head))

    if (size > SIGNATURE_CHUNK) {
      const tail = fs.readSync(fd, chunk, 0, chunk.length, Math.max(0, size - SIGNATURE_CHUNK))
      hash.update(chunk.subarray(0, tail))
    }

    return hash.digest('hex')
  }
  catch {
    return null
  }
  finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd)
      }
      catch {
        // Already closed.
      }
    }
  }
}

/** Hash a whole file in 1 MB blocks, so a 4 GB video does not become a 4 GB buffer. */
function fullHash(file: string): string | null {
  let fd: number | null = null
  try {
    fd = fs.openSync(file, 'r')
    const hash = crypto.createHash('sha256')
    const buffer = Buffer.allocUnsafe(1024 * 1024)

    for (;;) {
      const read = fs.readSync(fd, buffer, 0, buffer.length, null)
      if (read <= 0)
        break
      hash.update(buffer.subarray(0, read))
    }

    return hash.digest('hex')
  }
  catch {
    return null
  }
  finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd)
      }
      catch {
        // Already closed.
      }
    }
  }
}

/**
 * Which copy to keep.
 *
 * The oldest one, by modification time. It is the copy the others were made
 * from, so it is the one whose path other things are most likely to reference —
 * and on a tie the shallowest path wins, which prefers `~/Documents/tax.pdf`
 * over `~/Downloads/tax (3).pdf`.
 */
function chooseKeeper(files: Array<{ path: string, mtimeMs: number }>): string {
  let best = files[0]
  for (const file of files.slice(1)) {
    if (file.mtimeMs < best.mtimeMs) {
      best = file
      continue
    }
    if (file.mtimeMs === best.mtimeMs && file.path.split('/').length < best.path.split('/').length)
      best = file
  }
  return best.path
}

export function findDuplicates(options: DuplicateScanOptions = {}): DuplicateScanResult {
  const roots = options.roots?.length ? options.roots : [HOME]
  const minSize = options.minSizeBytes ?? DEFAULT_MIN_SIZE
  const limit = options.limit ?? DEFAULT_LIMIT
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
  const includeDependencies = options.includeDependencies ?? false
  let hashBudget = options.hashBudgetBytes ?? DEFAULT_HASH_BUDGET

  const started = Date.now()
  const deadline = started + timeoutMs
  const onProgress = options.onProgress
  let nextProgressAt = onProgress ? started + PROGRESS_INTERVAL_MS : Number.POSITIVE_INFINITY

  let scanned = 0
  let entriesLeft = maxEntries
  let truncated = false

  // ── Pass 1: group by size ──────────────────────────────────
  const bySize = new Map<number, Array<{ path: string, mtimeMs: number }>>()
  const stack: string[] = [...roots]

  while (stack.length > 0) {
    if (Date.now() > deadline || entriesLeft <= 0) {
      truncated = true
      break
    }

    const dir = stack.pop()!

    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    }
    catch {
      continue
    }

    for (const entry of entries) {
      if (--entriesLeft <= 0) {
        truncated = true
        break
      }

      const full = path.join(dir, entry.name)
      scanned++

      const now = Date.now()
      if (now >= nextProgressAt) {
        onProgress?.(scanned, full)
        nextProgressAt = now + PROGRESS_INTERVAL_MS
      }

      if (entry.isSymbolicLink())
        continue

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name))
          continue
        if (!includeDependencies && DEPENDENCY_DIRS.has(entry.name))
          continue
        // A bundle is one document to the user. Its insides are identical
        // across two copies of the same app, which would bury every real
        // duplicate under a thousand framework headers.
        if (isBundle(entry.name))
          continue
        stack.push(full)
        continue
      }

      if (!entry.isFile())
        continue

      let stat: fs.Stats
      try {
        stat = fs.lstatSync(full)
      }
      catch {
        continue
      }

      if (stat.size < minSize)
        continue

      const group = bySize.get(stat.size)
      if (group)
        group.push({ path: full, mtimeMs: stat.mtimeMs })
      else
        bySize.set(stat.size, [{ path: full, mtimeMs: stat.mtimeMs }])
    }
  }

  // ── Pass 2: signature, then pass 3: full hash ──────────────
  const groups: DuplicateGroup[] = []
  let duplicateCount = 0
  let wastedBytes = 0

  for (const [size, candidates] of bySize) {
    if (candidates.length < 2)
      continue
    if (Date.now() > deadline) {
      truncated = true
      break
    }

    const bySignature = new Map<string, Array<{ path: string, mtimeMs: number }>>()
    for (const candidate of candidates) {
      const sig = signature(candidate.path, size)
      if (!sig)
        continue
      const bucket = bySignature.get(sig)
      if (bucket)
        bucket.push(candidate)
      else
        bySignature.set(sig, [candidate])
    }

    for (const bucket of bySignature.values()) {
      if (bucket.length < 2)
        continue

      // Hashing every file in this bucket costs `size * bucket.length`. If
      // that does not fit in what is left of the budget the bucket is dropped
      // whole: a half-hashed bucket cannot be reported honestly.
      const cost = size * bucket.length
      if (cost > hashBudget) {
        truncated = true
        continue
      }
      hashBudget -= cost

      const byHash = new Map<string, Array<{ path: string, mtimeMs: number }>>()
      for (const candidate of bucket) {
        const hash = fullHash(candidate.path)
        if (!hash)
          continue
        const matched = byHash.get(hash)
        if (matched)
          matched.push(candidate)
        else
          byHash.set(hash, [candidate])

        onProgress?.(scanned, candidate.path)
      }

      for (const [hash, identical] of byHash) {
        if (identical.length < 2)
          continue

        const keeper = chooseKeeper(identical)
        const wasted = size * (identical.length - 1)
        duplicateCount += identical.length - 1
        wastedBytes += wasted

        groups.push({
          id: hash,
          sizeBytes: size,
          sizeFormatted: formatBytes(size),
          count: identical.length,
          wastedBytes: wasted,
          wastedFormatted: formatBytes(wasted),
          files: identical
            .slice()
            .sort((a, b) => a.mtimeMs - b.mtimeMs)
            .map(file => ({
              path: file.path,
              name: path.basename(file.path),
              directory: path.dirname(file.path),
              sizeBytes: size,
              modifiedAt: new Date(file.mtimeMs).toISOString(),
              keep: file.path === keeper,
            })),
        })
      }
    }
  }

  groups.sort((a, b) => b.wastedBytes - a.wastedBytes)
  const groupCount = groups.length

  return {
    groups: groups.slice(0, limit),
    scanned,
    groupCount,
    duplicateCount,
    wastedBytes,
    wastedFormatted: formatBytes(wastedBytes),
    truncated: truncated || groupCount > limit,
    scanTimeMs: Date.now() - started,
  }
}
