import * as fs from 'node:fs'
import * as path from 'node:path'
import type { DiskEntry, ScanOptions, ScanResult } from './types'

const DEFAULT_MAX_DEPTH = 6
const DEFAULT_TIMEOUT_MS = 15_000
/**
 * How often progress is reported, in milliseconds.
 *
 * Throttled by wallclock rather than entry count: entries are visited at wildly
 * different rates depending on the directory, so every-Nth-entry reporting goes
 * quiet exactly where the user most wants to see movement — and floods the pipe
 * where the walk is cheap.
 */
const PROGRESS_INTERVAL_MS = 250
const MAX_HEAP_SIZE = 50

/**
 * Cap on total entries (files + folders) processed in a single scan.
 * Prevents heap exhaustion on directories with millions of entries —
 * `timeoutMs` alone isn't enough because `readdirSync` loads each
 * directory's entries synchronously before the timer can fire.
 */
const DEFAULT_MAX_ENTRIES = 750_000

/**
 * Hard cap on children kept on each non-folded directory. Without it the
 * tree pinned by the scanner can grow proportional to the entry count;
 * we already heap-track the global top-N so deeply-fanned directories
 * past this cap are summarized via their largest direct children.
 */
const MAX_CHILDREN_PER_DIR = 5_000

/** Directories that should never be recursed into — use `du` for size instead */
const FOLDED_DIRS = new Set([
  'node_modules', '.git', '__pycache__', '.cache', 'vendor', 'DerivedData',
  '.Spotlight-V100', '.fseventsd', 'CachedData', 'GPUCache', 'ShaderCache',
  '.npm', '.bun', '.Trash', '.next', '.nuxt', '.turbo',
  '.parcel-cache', 'target', '.zig-cache', 'zig-cache', 'zig-out',
  '.gradle', 'Pods', '.dart_tool', '.venv',
  'venv', '.tox', '.mypy_cache', '.pytest_cache', 'dist', 'build',
  '.angular', '.svelte-kit', 'coverage', '.nyc_output', '.stx',

  // Cloud providers (iCloud Drive, Dropbox, OneDrive, Google Drive). Folded
  // rather than skipped, because whatever has actually been downloaded does
  // occupy the disk — and `du` reports allocated blocks, so a dataless
  // placeholder correctly counts as nothing while `lstat` would report its
  // full logical size.
  //
  // Recursing was worse than inaccurate: stat-ing a placeholder asks macOS to
  // materialise it, and a walk through iCloud blocked in the kernel for minutes
  // past the scan's own deadline. That is why Scan Disk could sit at
  // "Scanning disk…" until the request timed out.
  'CloudStorage', 'Mobile Documents',
])

const SYSTEM_SKIP = new Set([
  '.Spotlight-V100', '.fseventsd', '.vol', '.file',
  '.DocumentRevisions-V100', '.PKInstallSandboxManager', '.Trashes',
])

/**
 * Scan a directory tree using concurrent workers, building a size-annotated tree.
 * Folded directories (node_modules, .git, etc.) are sized via `du` instead of recursing.
 *
 * Before reaching for a faster walker: it was measured, and the walker is not
 * the bottleneck. On a home directory whose permissions had not been granted,
 * this walk spent 87 minutes against a 180-second budget having visited 49
 * directories — and `du -x -d 6`, the same job in C, took 94 minutes at **1%
 * CPU** (103s of CPU across 143,140 directories). Both were parked in the
 * kernel, not computing. Replacing this with `du`, or with a thread pool, buys
 * nothing against the thing that actually stops it.
 *
 * What does help, and is implemented: report progress so a blocked scan is
 * visibly blocked rather than apparently slow, fold the directory trees that
 * cannot return promptly (cloud providers), and let the caller kill a scan that
 * has stopped responding.
 */
export function scanDirectory(rootPath: string, options: ScanOptions = {}): ScanResult {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
  const skipPatterns = options.skipPatterns ?? FOLDED_DIRS
  const includeHidden = options.includeHidden ?? false

  const scanStart = Date.now()
  const deadline = scanStart + timeoutMs
  const onProgress = options.onProgress
  let nextProgressAt = onProgress ? scanStart + PROGRESS_INTERVAL_MS : Number.POSITIVE_INFINITY
  let aborted = false
  let totalFiles = 0
  let totalFolders = 0

  function report(now: number, dirPath: string): void {
    if (now < nextProgressAt) return
    nextProgressAt = now + PROGRESS_INTERVAL_MS
    onProgress?.(totalFiles + totalFolders, dirPath)
  }

  // Min-heap tracking the top N largest entries for fast top-N retrieval
  const topEntries: DiskEntry[] = []

  function pushToHeap(entry: DiskEntry): void {
    if (topEntries.length < MAX_HEAP_SIZE) {
      topEntries.push(entry)
      // Bubble up
      let i = topEntries.length - 1
      while (i > 0) {
        const parent = (i - 1) >> 1
        if (topEntries[parent].sizeBytes <= topEntries[i].sizeBytes)
          break
        const temp = topEntries[parent]
        topEntries[parent] = topEntries[i]
        topEntries[i] = temp
        i = parent
      }
    }
    else if (entry.sizeBytes > topEntries[0].sizeBytes) {
      // Replace min
      topEntries[0] = entry
      // Sift down
      let i = 0
      while (true) {
        const left = 2 * i + 1
        const right = 2 * i + 2
        let smallest = i
        if (left < topEntries.length && topEntries[left].sizeBytes < topEntries[smallest].sizeBytes)
          smallest = left
        if (right < topEntries.length && topEntries[right].sizeBytes < topEntries[smallest].sizeBytes)
          smallest = right
        if (smallest === i)
          break
        const swp = topEntries[smallest]
        topEntries[smallest] = topEntries[i]
        topEntries[i] = swp
        i = smallest
      }
    }
  }

  /**
   * Directories discovered but not yet read.
   *
   * The walk is breadth-first, and that is the whole point. Depth-first spends
   * its budget on whatever it happens to enter first: a scan of `~/Code` that
   * ran out of time inside `Code/Home` returned Home at 36 GB and every one of
   * its siblings at zero, so the chart said all the space was in one folder
   * when it simply had not looked anywhere else. A sunburst is nothing but
   * proportions, and those were false rather than merely incomplete.
   *
   * Breadth-first, running out of time costs depth uniformly instead: every
   * sibling at the level you are looking at has been measured, and what is
   * missing is detail further down. That is the shape a truncated disk map
   * should have.
   */
  interface Pending { entry: DiskEntry, depth: number }

  const rootEntry: DiskEntry = {
    name: path.basename(rootPath) || '/',
    path: rootPath,
    sizeBytes: 0,
    isDirectory: true,
    children: [],
  }

  const queue: Pending[] = [{ entry: rootEntry, depth: 0 }]
  let head = 0

  while (head < queue.length) {
    const { entry: parent, depth } = queue[head]
    head++

    const now = Date.now()
    if (now > deadline || totalFiles + totalFolders > maxEntries) {
      aborted = true
      break
    }
    report(now, parent.path)

    if (depth >= maxDepth)
      continue

    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(parent.path, { withFileTypes: true })
    }
    catch {
      continue
    }

    const children: DiskEntry[] = []

    for (const entry of entries) {
      // Per-entry guards: the cap must trip on flat directories with millions
      // of children, and `readdirSync` cannot yield, so wallclock is checked
      // inside the loop too.
      const tick = Date.now()
      if (tick > deadline || totalFiles + totalFolders > maxEntries) {
        aborted = true
        break
      }
      report(tick, parent.path)

      if (!includeHidden && entry.name.startsWith('.') && depth > 0)
        continue
      if (SYSTEM_SKIP.has(entry.name))
        continue

      const fullPath = path.join(parent.path, entry.name)

      try {
        const stats = fs.lstatSync(fullPath)
        if (stats.isSymbolicLink())
          continue

        if (stats.isDirectory()) {
          totalFolders++

          // Folded directories are sized whole and never entered. `du` is the
          // most expensive thing this scan does, so each call is capped by
          // what is left of the budget rather than a fixed ceiling — one slow
          // directory must not eat the deadline and leave the rest unwalked.
          if (skipPatterns.has(entry.name) || depth >= maxDepth - 1) {
            const remaining = deadline - Date.now()
            const size = remaining > 250 ? getDirSizeSync(fullPath, Math.min(3000, remaining)) : 0
            const child: DiskEntry = {
              name: entry.name,
              path: fullPath,
              sizeBytes: size,
              isDirectory: true,
              children: [],
            }
            children.push(child)
            pushToHeap(child)
          }
          else {
            const child: DiskEntry = {
              name: entry.name,
              path: fullPath,
              sizeBytes: 0,
              isDirectory: true,
              children: [],
            }
            children.push(child)
            queue.push({ entry: child, depth: depth + 1 })
          }
        }
        else {
          totalFiles++
          const child: DiskEntry = {
            name: entry.name,
            path: fullPath,
            sizeBytes: stats.size,
            isDirectory: false,
            modifiedAt: stats.mtime,
          }
          children.push(child)
          if (stats.size > 10_000_000) // Only track files > 10MB in heap
            pushToHeap(child)
        }
      }
      catch {
        // Skip inaccessible
      }
    }

    parent.fileCount = children.filter(c => !c.isDirectory).length
    parent.children = children
  }

  /**
   * Roll sizes up from the leaves.
   *
   * Breadth-first means a directory's size is not known when it is created —
   * only once everything beneath it has been read. Folded directories already
   * carry a `du` size and have no children, so they are returned as they are;
   * a directory the walk never reached stays at zero, which is now one leaf
   * among many rather than an entire missing branch.
   */
  function rollUp(entry: DiskEntry): number {
    if (!entry.isDirectory || !entry.children || entry.children.length === 0)
      return entry.sizeBytes

    let total = 0
    for (const child of entry.children)
      total += rollUp(child)

    entry.sizeBytes = total

    // Sorted and capped here rather than during the walk, because a child's
    // size is not known until its own subtree has been rolled up. The global
    // top-N heap already tracks the largest items; this just keeps the
    // returned tree bounded.
    entry.children.sort((a, b) => b.sizeBytes - a.sizeBytes)
    if (entry.children.length > MAX_CHILDREN_PER_DIR)
      entry.children = entry.children.slice(0, MAX_CHILDREN_PER_DIR)

    return total
  }

  rollUp(rootEntry)
  const tree = rootEntry
  const scanTimeMs = Date.now() - scanStart

  return {
    tree,
    totalFiles,
    totalFolders,
    scanTimeMs,
    aborted,
  }
}

/**
 * Deep scan a specific directory with higher limits
 */
export function deepScanDirectory(dirPath: string, options: ScanOptions = {}): ScanResult {
  return scanDirectory(dirPath, {
    ...options,
    maxDepth: options.maxDepth ?? 8,
    timeoutMs: options.timeoutMs ?? 30_000,
  })
}

/**
 * Get top N largest items from a scan result
 */
export function getTopItems(tree: DiskEntry, count: number): DiskEntry[] {
  const items: DiskEntry[] = []

  function collect(entry: DiskEntry): void {
    if (entry.children) {
      for (const child of entry.children) {
        items.push(child)
        if (child.isDirectory && child.children)
          collect(child)
      }
    }
  }

  collect(tree)
  items.sort((a, b) => b.sizeBytes - a.sizeBytes)
  return items.slice(0, count)
}

/**
 * Flatten a tree into a list of all entries
 */
export function flattenTree(tree: DiskEntry): DiskEntry[] {
  const result: DiskEntry[] = []

  function walk(entry: DiskEntry): void {
    result.push(entry)
    if (entry.children) {
      for (const child of entry.children)
        walk(child)
    }
  }

  walk(tree)
  return result
}

/**
 * Fast synchronous directory size using `du`.
 * Falls back to manual walk if `du` fails.
 */
function getDirSizeSync(dirPath: string, timeoutMs = 5_000): number {
  try {
    const { execSync: nodeExecSync } = require('node:child_process') as typeof import('node:child_process')
    // eslint-disable-next-line quotes -- string contains single quote, double quotes needed
    const safePath = dirPath.replace(/'/g, "'\\''")
    const out = nodeExecSync(`du -sk '${safePath}' 2>/dev/null | cut -f1`, {
      encoding: 'utf8',
      timeout: timeoutMs,
    }).trim()
    return (Number.parseInt(out) || 0) * 1024
  }
  catch {
    // Fallback: stat-based estimate (samples up to 500 entries)
    try {
      let total = 0
      const entries = fs.readdirSync(dirPath, { withFileTypes: true })
      for (const entry of entries.slice(0, 500)) {
        try {
          const stat = fs.statSync(path.join(dirPath, entry.name))
          total += stat.size
        }
        catch { /* skip */ }
      }
      return total
    }
    catch {
      return 4096
    }
  }
}
