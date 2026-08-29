import type { FileCategory, LargeFile } from './types'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { formatBytes, HOME } from '@system-cleaner/core'
import { categorizeFile } from './categories'

/**
 * Directories that are never worth walking: system bookkeeping, volume
 * snapshots, and the Trash (which has its own screen and its own "empty"
 * action).
 */
const SKIP_DIRS = new Set([
  '.Spotlight-V100', '.fseventsd', '.DocumentRevisions-V100', '.TemporaryItems',
  '.PKInstallSandboxManager', '.PKInstallSandboxManager-SystemSoftware',
  '.Trashes', '.Trash', '.vol', '.file', '.MobileBackups',

  // Cloud-backed providers (iCloud Drive, Dropbox, OneDrive, Google Drive).
  // Excluded on the merits, not as a workaround: a file that lives in the
  // cloud is not occupying the local disk the user is trying to reclaim, and
  // stat-ing a dataless placeholder asks macOS to materialise it — which is a
  // download, and a `readdirSync` that can block for minutes with no way for
  // the scan's own deadline to interrupt it.
  'CloudStorage', 'Mobile Documents',
])

/**
 * Dependency and build directories pruned by default.
 *
 * These are where the file *count* lives — a developer's home directory is
 * mostly `node_modules` and `.git` by inode — while almost never holding an
 * individually deletable large file. Walking them turned a full-home scan from
 * seconds into minutes on a machine with a few dozen checkouts.
 *
 * Nothing is lost by skipping them here: a bloated `node_modules` or
 * `DerivedData` is not something you clear one file at a time, and the Disk
 * Usage view already sizes and offers the whole directory. Pass
 * `includeDependencies` to walk them anyway.
 */
const DEPENDENCY_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg',
  'DerivedData', 'Pods', 'Carthage', '.build',
  'target', '.gradle', '.m2', '.cargo', '.rustup',
  '__pycache__', '.venv', 'venv', '.tox', '.mypy_cache', '.pytest_cache',
  'vendor', '.bundle', '.dart_tool', '.pub-cache',
  '.npm', '.pnpm-store', '.yarn', '.bun', '.deno',
  '.zig-cache', 'zig-cache', '.turbo', '.parcel-cache',
  '.next', '.nuxt', '.svelte-kit', '.angular', '.stx',
  '.terraform', '.serverless', '.nx',
])

/**
 * Directory suffixes macOS presents as a single document. Descending into one
 * produces a list of a hundred anonymous chunk files instead of the 80 GB
 * Photos library the user is actually looking for, so each is reported as one
 * entry whose size is the sum of everything inside it.
 */
const BUNDLE_SUFFIXES = [
  '.app', '.photoslibrary', '.sparsebundle', '.framework', '.bundle',
  '.xcarchive', '.imovielibrary', '.fcpbundle', '.logicx', '.band',
  '.rtfd', '.aplibrary', '.tvlibrary', '.musiclibrary', '.pbproj',
  '.theater', '.mpkg', '.docset', '.lproj',
]

/** How often progress is reported while a scan runs. */
const PROGRESS_INTERVAL_MS = 250

/** Default floor for "large". Below this the list is noise, not signal. */
const DEFAULT_MIN_SIZE = 100 * 1024 * 1024

const DEFAULT_LIMIT = 200
const DEFAULT_TIMEOUT_MS = 45_000
const DEFAULT_MAX_ENTRIES = 2_000_000


export interface LargeFileScanOptions {
  /** Directories to walk. Defaults to the user's home directory. */
  roots?: string[]
  /** Ignore anything smaller than this. Defaults to 100 MB. */
  minSizeBytes?: number
  /** Maximum number of results to return, largest first. Defaults to 200. */
  limit?: number
  /** Abort the walk after this long and return what was found. */
  timeoutMs?: number
  /** Abort the walk after visiting this many entries. */
  maxEntries?: number
  /** Restrict results to these categories. Empty or omitted means all. */
  categories?: FileCategory[]
  /**
   * Walk dependency and build directories too (`node_modules`, `.git`,
   * `DerivedData`, ...). Off by default — see {@link DEPENDENCY_DIRS}.
   */
  includeDependencies?: boolean
  /**
   * Called while the walk runs, at most a few times a second. A full-home scan
   * takes tens of seconds, and a progress bar that never moves is
   * indistinguishable from a hang.
   */
  onProgress?: (scanned: number, currentPath: string) => void
}

export interface LargeFileScanResult {
  files: LargeFile[]
  /** Entries visited, whether or not they qualified. */
  scanned: number
  /** Total size of every qualifying item found, not just the returned page. */
  totalBytes: number
  /** Number of qualifying items found, which may exceed `files.length`. */
  matched: number
  /** True when a cap or the timeout cut the walk short. */
  truncated: boolean
  scanTimeMs: number
}

function isBundle(name: string): boolean {
  const lower = name.toLowerCase()
  return BUNDLE_SUFFIXES.some(suffix => lower.endsWith(suffix))
}

/**
 * Total size of a bundle directory, walked iteratively.
 *
 * Deliberately not `du`: this runs inside the same walk as everything else,
 * and shelling out per bundle turned a home directory with a few hundred
 * `.app`s into a scan measured in minutes.
 */
function bundleSize(root: string, budget: { entries: number }, deadline: number): number {
  let total = 0
  const stack: string[] = [root]

  while (stack.length > 0) {
    const dir = stack.pop()!
    if (budget.entries <= 0)
      break
    // The wallclock has to be checked in here too, not only in the outer walk.
    // A single 200 GB Photos library kept this loop busy well past the scan's
    // timeout, so the caller's deadline passed with no result to return.
    if (Date.now() > deadline)
      break

    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    }
    catch {
      continue
    }

    for (const entry of entries) {
      budget.entries--
      if (budget.entries <= 0)
        break
      if (Date.now() > deadline)
        return total
      const full = path.join(dir, entry.name)
      try {
        const stat = fs.lstatSync(full)
        if (stat.isSymbolicLink())
          continue
        if (stat.isDirectory())
          stack.push(full)
        else
          total += stat.size
      }
      catch {
        // Unreadable entries contribute nothing rather than failing the bundle.
      }
    }
  }

  return total
}

/**
 * Find the largest files (and document bundles) under one or more roots.
 *
 * Separate from `scanDirectory`, which builds a depth-limited tree for the
 * sunburst and folds `node_modules`-style directories into a single sized
 * node. That shape answers "where did my disk go"; this one answers "which
 * individual items can I delete", which needs the opposite trade-offs: no
 * depth limit, hidden directories included, and no tree retained — just a
 * bounded top-N heap, so the walk costs the same on a 40 GB home directory
 * as on a 4 TB one.
 */
export function scanLargeFiles(options: LargeFileScanOptions = {}): LargeFileScanResult {
  const roots = options.roots?.length ? options.roots : [HOME]
  const minSize = options.minSizeBytes ?? DEFAULT_MIN_SIZE
  const limit = options.limit ?? DEFAULT_LIMIT
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
  const categoryFilter = options.categories?.length ? new Set(options.categories) : null
  const includeDependencies = options.includeDependencies ?? false

  const started = Date.now()
  const deadline = started + timeoutMs
  const budget = { entries: maxEntries }
  // Throttled by wallclock rather than entry count: entries are visited at
  // wildly different rates depending on the directory, so every-Nth-entry
  // reporting stalls exactly where the user most wants to see movement.
  const onProgress = options.onProgress
  let nextProgressAt = onProgress ? started + PROGRESS_INTERVAL_MS : Number.POSITIVE_INFINITY
  let scanned = 0
  let matched = 0
  let totalBytes = 0
  let truncated = false

  // Min-heap of the largest `limit` items seen. Kept as a heap rather than a
  // sorted array so a scan that visits a million files still costs O(n log k).
  const heap: LargeFile[] = []

  function push(file: LargeFile): void {
    if (heap.length < limit) {
      heap.push(file)
      let i = heap.length - 1
      while (i > 0) {
        const parent = (i - 1) >> 1
        if (heap[parent].sizeBytes <= heap[i].sizeBytes)
          break
        const tmp = heap[parent]
        heap[parent] = heap[i]
        heap[i] = tmp
        i = parent
      }
      return
    }

    if (file.sizeBytes <= heap[0].sizeBytes)
      return

    heap[0] = file
    let i = 0
    while (true) {
      const left = 2 * i + 1
      const right = 2 * i + 2
      let smallest = i
      if (left < heap.length && heap[left].sizeBytes < heap[smallest].sizeBytes)
        smallest = left
      if (right < heap.length && heap[right].sizeBytes < heap[smallest].sizeBytes)
        smallest = right
      if (smallest === i)
        break
      const tmp = heap[smallest]
      heap[smallest] = heap[i]
      heap[i] = tmp
      i = smallest
    }
  }

  function consider(
    fullPath: string,
    name: string,
    sizeBytes: number,
    modifiedAt: Date,
    isBundleEntry: boolean,
  ): void {
    if (sizeBytes < minSize)
      return

    const category = categorizeFile(name)
    if (categoryFilter && !categoryFilter.has(category))
      return

    matched++
    totalBytes += sizeBytes
    push({
      path: fullPath,
      name,
      sizeBytes,
      sizeFormatted: formatBytes(sizeBytes),
      modifiedAt,
      category,
      isBundle: isBundleEntry,
    })
  }

  // Checked on every entry, not every Nth. `Date.now()` costs a fraction of
  // the `lstat` that follows it, and sampling was the reason a scan with a 20s
  // budget ran for 44s: one slow directory of network-backed files can burn
  // through a whole sampling window between checks.
  function overBudget(currentPath?: string): boolean {
    const now = Date.now()
    if (now > deadline || budget.entries <= 0) {
      truncated = true
      return true
    }
    if (now >= nextProgressAt) {
      nextProgressAt = now + PROGRESS_INTERVAL_MS
      onProgress?.(scanned, currentPath ?? '')
    }
    return false
  }

  const stack: string[] = []
  for (const root of roots) {
    try {
      if (fs.lstatSync(root).isDirectory())
        stack.push(path.resolve(root))
    }
    catch {
      // A root that no longer exists is skipped rather than failing the scan;
      // the UI lets the user type an arbitrary path.
    }
  }

  // Guard against a root list like ['/Users/me', '/Users/me/Movies'] walking
  // the nested one twice and double-counting its bytes.
  const visited = new Set<string>()

  while (stack.length > 0) {
    const dir = stack.pop()!
    if (visited.has(dir))
      continue
    visited.add(dir)

    if (overBudget(dir))
      break

    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    }
    catch {
      continue
    }

    for (const entry of entries) {
      if (overBudget(dir))
        break

      if (SKIP_DIRS.has(entry.name))
        continue
      if (!includeDependencies && entry.isDirectory() && DEPENDENCY_DIRS.has(entry.name))
        continue

      const fullPath = path.join(dir, entry.name)
      budget.entries--
      scanned++

      let stat: fs.Stats
      try {
        stat = fs.lstatSync(fullPath)
      }
      catch {
        continue
      }

      // Never follow symlinks: they lead back out of the scan roots, and a
      // symlink is not what the user would be deleting anyway.
      if (stat.isSymbolicLink())
        continue

      if (stat.isDirectory()) {
        if (isBundle(entry.name)) {
          const size = bundleSize(fullPath, budget, deadline)
          scanned++
          consider(fullPath, entry.name, size, stat.mtime, true)
          continue
        }
        stack.push(fullPath)
        continue
      }

      if (stat.isFile())
        consider(fullPath, entry.name, stat.size, stat.mtime, false)
    }
  }

  if (budget.entries <= 0)
    truncated = true

  return {
    files: heap.sort((a, b) => b.sizeBytes - a.sizeBytes),
    scanned,
    totalBytes,
    matched,
    truncated,
    scanTimeMs: Date.now() - started,
  }
}
