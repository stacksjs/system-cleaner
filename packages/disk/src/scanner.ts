import type { DiskEntry, ScanOptions, ScanResult } from './types'
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const DEFAULT_MAX_DEPTH = 6
const DEFAULT_TIMEOUT_MS = 15_000

/**
 * How deep the JavaScript walk goes before `du` takes over.
 *
 * Three levels of a home directory is a few thousand `readdir` calls — under a
 * second — and it buys the two things the walk is actually for: the files
 * sitting near the top, and a wide set of independent subtrees to hand to
 * `du`. Everything below this is measured by `du`, which is both faster per
 * inode and, unlike this process, something we can run sixteen of at once.
 */
const DEFAULT_STRUCTURE_DEPTH = 3

/**
 * How many `du` processes run at once.
 *
 * Measured on a 294 GB home directory: one `du -x -d 3` took 233s, eight in
 * parallel over its second-level directories took 75s, and sixteen over its
 * third-level directories took 46s. The work is a stat per inode and it spends
 * nearly all of that in the kernel at ~1% CPU, so the only lever that moves is
 * how many of those waits overlap.
 */
const DEFAULT_CONCURRENCY = 16

/**
 * How often progress is reported, in milliseconds.
 *
 * Throttled by wallclock rather than entry count: entries are visited at wildly
 * different rates depending on the directory, so every-Nth-entry reporting goes
 * quiet exactly where the user most wants to see movement — and floods the pipe
 * where the walk is cheap.
 */
const PROGRESS_INTERVAL_MS = 250

/**
 * Cap on total entries (files + folders) processed in a single scan.
 * Prevents heap exhaustion on directories with millions of entries —
 * `timeoutMs` alone isn't enough because `readdirSync` loads each
 * directory's entries synchronously before the timer can fire.
 */
const DEFAULT_MAX_ENTRIES = 750_000

/**
 * Hard cap on children kept on each directory, and on directory nodes taken
 * from a single `du` run. `du -d 6` under a project directory reports every
 * package inside `node_modules`; the sizes are wanted, the tens of thousands
 * of nodes are not.
 */
const MAX_CHILDREN_PER_DIR = 5_000
const MAX_NODES_PER_MEASURE = 20_000

/**
 * Directories reported whole and never descended into. Their size still
 * counts — `du` measures the whole subtree — but the tree does not carry a
 * node per package inside `node_modules`.
 */
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

/** Smallest folder worth a node of its own, as a fraction of the whole scan. */
const PRUNE_FRACTION = 1 / 2000
/** …and never prune anything above this, however large the scan root is. */
const PRUNE_CEILING_BYTES = 2 * 1024 * 1024

/** A leftover this small is not worth its own arc. */
const REMAINDER_MIN_FRACTION = 0.01

const DU_BIN = fs.existsSync('/usr/bin/du') ? '/usr/bin/du' : 'du'

interface Pending { entry: DiskEntry, depth: number }

/**
 * Scan a directory tree, building a size-annotated tree.
 *
 * Two phases, because measuring a home directory and describing its shape are
 * different jobs with different costs.
 *
 * **The walk** reads the top few levels itself. That is where the loose files
 * live, it is cheap, and it produces the list of subtrees the second phase
 * fans out over.
 *
 * **The measure** hands every directory the walk stopped at to `du`, several
 * at a time, and asks for sizes down to `maxDepth`. `du` is the same job in C
 * with none of the per-entry cost of `lstat` through a JavaScript boundary,
 * and running sixteen of them overlaps the kernel waits that dominate the
 * whole exercise.
 *
 * The property that matters is that a directory's size no longer depends on
 * whether the walk got to it. Walking a 294 GB home directory within any
 * budget a person will sit through is not possible — the previous version of
 * this scanner reached 39.9 GB of it in 45 seconds and reported that as the
 * total, with `~/Code` at 35 GB against its real 166 GB and `~/.local` at
 * 500 MB against its real 92 GB. Everything it had not reached read as zero,
 * so the chart was not merely incomplete: its proportions were false.
 *
 * Now a folder is either measured exactly or marked `unmeasured`, and the
 * result says how many of the latter there are.
 */
export async function scanDirectory(rootPath: string, options: ScanOptions = {}): Promise<ScanResult> {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
  const skipPatterns = options.skipPatterns ?? FOLDED_DIRS
  const structureDepth = Math.min(options.structureDepth ?? DEFAULT_STRUCTURE_DEPTH, maxDepth)
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY)

  const scanStart = Date.now()
  const deadline = scanStart + timeoutMs
  const onProgress = options.onProgress

  let nextProgressAt = onProgress ? scanStart + PROGRESS_INTERVAL_MS : Number.POSITIVE_INFINITY
  let aborted = false
  let totalFiles = 0
  let totalFolders = 0
  let unreadableFolders = 0
  let measuredBytes = 0
  let currentPath = rootPath

  function report(now: number, dirPath: string): void {
    if (now < nextProgressAt) return
    nextProgressAt = now + PROGRESS_INTERVAL_MS
    currentPath = dirPath
    onProgress?.(totalFiles + totalFolders, dirPath, measuredBytes)
  }

  const rootEntry: DiskEntry = {
    name: path.basename(rootPath) || '/',
    path: rootPath,
    sizeBytes: 0,
    isDirectory: true,
    children: [],
  }

  /**
   * Directories the walk stopped at, for `du` to size.
   *
   * The walk is breadth-first, and that is the whole point. Depth-first spends
   * its budget on whatever it happens to enter first: a scan of `~/Code` that
   * ran out of time inside `Code/Home` returned Home at 36 GB and every one of
   * its siblings at zero, so the chart said all the space was in one folder
   * when it simply had not looked anywhere else.
   */
  const toMeasure: Pending[] = []
  const queue: Pending[] = [{ entry: rootEntry, depth: 0 }]
  let head = 0

  while (head < queue.length) {
    const { entry: parent, depth } = queue[head]
    head++

    const now = Date.now()
    if (now > deadline || totalFiles + totalFolders > maxEntries) {
      // Hand this one back: it was dequeued but never read, so it belongs with
      // the directories `du` still has to size rather than being dropped on the
      // floor at zero bytes.
      head--
      aborted = true
      break
    }
    report(now, parent.path)

    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(parent.path, { withFileTypes: true })
    }
    catch {
      unreadableFolders++
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

      // Hidden directories are not decoration: `~/Library/Caches`'s dot-named
      // neighbours, a project's `.git`, `~/.local` at 92 GB. Skipping them
      // below the top level is how a scan quietly loses tens of gigabytes.
      if (SYSTEM_SKIP.has(entry.name))
        continue

      const fullPath = path.join(parent.path, entry.name)

      try {
        const stats = fs.lstatSync(fullPath)
        if (stats.isSymbolicLink())
          continue

        if (stats.isDirectory()) {
          totalFolders++
          const child: DiskEntry = {
            name: entry.name,
            path: fullPath,
            sizeBytes: 0,
            isDirectory: true,
            children: [],
          }
          children.push(child)

          // Folded directories, and everything past the walk's own depth, are
          // handed whole to `du`. Nothing is descended into twice.
          if (skipPatterns.has(entry.name) || depth + 1 >= structureDepth)
            toMeasure.push({ entry: child, depth: depth + 1 })
          else
            queue.push({ entry: child, depth: depth + 1 })
        }
        else {
          totalFiles++
          children.push({
            name: entry.name,
            path: fullPath,
            sizeBytes: stats.size,
            isDirectory: false,
            modifiedAt: stats.mtime,
          })
        }
      }
      catch {
        // Skip inaccessible
      }
    }

    parent.fileCount = children.filter(c => !c.isDirectory).length
    parent.children = children
  }

  // Directories the walk queued but never dequeued still need a size. They are
  // measured like any other frontier directory rather than left at zero.
  for (let i = head; i < queue.length; i++)
    toMeasure.push(queue[i])

  const measured = await measureAll(toMeasure)
  totalFolders += measured.folders
  unreadableFolders += measured.unreadable
  if (measured.aborted) aborted = true

  rollUp(rootEntry)
  tidy(rootEntry, Math.min(PRUNE_CEILING_BYTES, rootEntry.sizeBytes * PRUNE_FRACTION), 0)

  return {
    tree: rootEntry,
    totalFiles,
    totalFolders,
    unmeasuredFolders: countUnmeasured(rootEntry),
    unreadableFolders,
    scanTimeMs: Date.now() - scanStart,
    aborted,
  }

  /**
   * Size every frontier directory with `du`, `concurrency` at a time.
   *
   * Results are attached as each process finishes, so a run that hits the
   * deadline still carries everything measured up to that moment — and the
   * directories it never reached are marked, not silently zero.
   */
  async function measureAll(items: Pending[]): Promise<{ folders: number, unreadable: number, aborted: boolean }> {
    let folders = 0
    let unreadable = 0
    let ranOut = false
    let next = 0

    if (items.length === 0)
      return { folders, unreadable, aborted: ranOut }

    // A single `du` under a large directory can run for tens of seconds
    // without any of the counters below moving. The UI reads a count that has
    // stopped as a scan that has stopped, so progress ticks on its own clock
    // and counts the directory lines `du` is streaming back.
    const ticker = onProgress
      ? setInterval(() => onProgress(totalFiles + totalFolders + folders, currentPath, measuredBytes), PROGRESS_INTERVAL_MS)
      : undefined

    async function worker(): Promise<void> {
      while (true) {
        if (Date.now() >= deadline) {
          // Out of time is only a truncated scan if something was still
          // waiting to be measured. A run whose last directory landed on the
          // final millisecond measured everything, and saying otherwise puts a
          // warning on a complete answer.
          if (next < items.length) ranOut = true
          return
        }
        const index = next++
        if (index >= items.length)
          return

        const item = items[index]
        currentPath = item.entry.path
        const outcome = await measureOne(item.entry, item.depth)
        folders += outcome.folders
        unreadable += outcome.unreadable
        if (outcome.timedOut) ranOut = true
        measuredBytes += item.entry.sizeBytes
      }
    }

    try {
      await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
    }
    finally {
      if (ticker) clearInterval(ticker)
    }

    // Whatever the workers never got to. Marking it here rather than in
    // `measureOne` is the whole point: a directory nobody claimed leaves no
    // trace of itself otherwise, and a folder reported at zero because the
    // clock ran out is indistinguishable from one that is genuinely empty.
    for (let i = Math.min(next, items.length); i < items.length; i++)
      items[i].entry.unmeasured = true

    return { folders, unreadable, aborted: ranOut }
  }

  /**
   * Run `du` over one directory and graft what it reports onto `entry`.
   *
   * `-d` bounds the report to the depth the tree still has room for, `-x`
   * keeps it on this filesystem, and `-k` makes every number a block count in
   * KiB — allocated blocks rather than apparent size, which is the honest
   * answer for a tool whose next screen offers to delete things.
   */
  function measureOne(entry: DiskEntry, depth: number): Promise<{ folders: number, unreadable: number, timedOut: boolean }> {
    return new Promise((resolve) => {
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        entry.unmeasured = true
        resolve({ folders: 0, unreadable: 0, timedOut: true })
        return
      }

      // A folded directory is measured, never described: asking `du` for the
      // depth below `node_modules` returns a node per package and answers a
      // question nobody asked.
      const reportDepth = skipPatterns.has(entry.name) ? 0 : Math.max(0, maxDepth - depth)

      const child = spawn(DU_BIN, ['-x', '-k', '-d', String(reportDepth), entry.path], {
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      let out = ''
      let unreadable = 0
      let timedOut = false

      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => { out += chunk })
      child.stderr.setEncoding('utf8')
      // Every line here is a directory macOS would not let us read. In bulk it
      // means one thing — Full Disk Access has not been granted — and the UI
      // says so rather than quietly reporting a smaller disk.
      child.stderr.on('data', (chunk: string) => { unreadable += countLines(chunk) })

      const timer = setTimeout(() => {
        timedOut = true
        try { child.kill('SIGKILL') }
        catch { /* already gone */ }
      }, remaining)

      const finish = (): void => {
        clearTimeout(timer)
        // Killed mid-run still leaves usable output: `du` reports a directory
        // only once everything under it is counted, so every line that did
        // arrive is a complete subtree.
        const folders = graft(entry, out)
        if (entry.sizeBytes === 0 && folders === 0)
          entry.unmeasured = true
        resolve({ folders, unreadable, timedOut })
      }

      child.on('error', () => {
        clearTimeout(timer)
        entry.unmeasured = true
        resolve({ folders: 0, unreadable: 0, timedOut: false })
      })
      child.on('close', finish)
    })
  }

  /**
   * Turn `du` output into child nodes under `root`.
   *
   * Lines are `<KiB>\t<path>`, children before parents. A path whose ancestry
   * runs through a folded directory is dropped — its bytes are already inside
   * the folded directory's own total, which is the level the tree stops at.
   */
  function graft(root: DiskEntry, output: string): number {
    const byPath = new Map<string, DiskEntry>([[root.path, root]])
    const prefix = `${root.path}/`
    let created = 0

    function ensure(target: string): DiskEntry | null {
      const existing = byPath.get(target)
      if (existing) return existing
      if (!target.startsWith(prefix)) return null
      if (created >= MAX_NODES_PER_MEASURE) return null

      const parent = ensure(path.dirname(target))
      if (!parent) return null

      const node: DiskEntry = {
        name: path.basename(target),
        path: target,
        sizeBytes: 0,
        isDirectory: true,
        children: [],
      }
      parent.children!.push(node)
      byPath.set(target, node)
      created++
      return node
    }

    for (const line of output.split('\n')) {
      if (!line) continue
      const tab = line.indexOf('\t')
      if (tab <= 0) continue

      const kib = Number.parseInt(line.slice(0, tab), 10)
      if (!Number.isFinite(kib)) continue
      const target = line.slice(tab + 1)

      if (target !== root.path) {
        if (!target.startsWith(prefix)) continue
        // Anything under a folded directory: counted, not listed.
        const segments = target.slice(prefix.length).split('/')
        if (segments.slice(0, -1).some(s => FOLDED_DIRS.has(s))) continue
      }

      const node = ensure(target)
      if (!node) continue
      node.sizeBytes = kib * 1024
    }

    return created
  }
}

/**
 * Roll sizes up from the leaves.
 *
 * A directory `du` reported carries the size of its whole subtree, including
 * the files in it and anything below `maxDepth`, so its own number wins. One
 * the walk built is the sum of its children, every one of which is either a
 * file it stat-ed or a directory `du` measured.
 */
function rollUp(entry: DiskEntry): number {
  if (!entry.isDirectory || !entry.children || entry.children.length === 0)
    return entry.sizeBytes

  let childTotal = 0
  for (const child of entry.children)
    childTotal += rollUp(child)

  // `du`'s own number is authoritative except when it is missing (a killed
  // run that got some children out first) or impossibly small.
  entry.sizeBytes = Math.max(entry.sizeBytes, childTotal)
  return entry.sizeBytes
}

/**
 * Sort, prune, and account for whatever the children do not cover.
 *
 * Pruning is about the size of the answer, not the accuracy of it: a 4 MB
 * folder is 0.001% of a 300 GB home directory, it cannot be seen on the chart,
 * and there are tens of thousands of them. Their bytes are not dropped — they
 * roll into the leftover node below, so every ring still adds up to its parent.
 */
function tidy(entry: DiskEntry, floorBytes: number, depth: number): void {
  const children = entry.children
  if (!children || children.length === 0) return

  for (const child of children)
    tidy(child, floorBytes, depth + 1)

  children.sort((a, b) => b.sizeBytes - a.sizeBytes)

  // The scan root's own children are always listed: they are the folders the
  // sidebar names, and there are a couple of dozen of them.
  let kept = children
  let foldedDirs = false
  if (depth >= 1) {
    kept = []
    for (const child of children) {
      if (child.sizeBytes < floorBytes) {
        foldedDirs ||= child.isDirectory
        continue
      }
      kept.push(child)
    }
  }
  if (kept.length > MAX_CHILDREN_PER_DIR) {
    foldedDirs = true
    kept = kept.slice(0, MAX_CHILDREN_PER_DIR)
  }

  // What the listed children do not account for: the files sitting directly in
  // this folder, plus anything pruned above. Without it a `du`-measured folder
  // draws an arc far wider than the children inside it, which reads as a bug.
  if (kept.length > 0) {
    let listed = 0
    for (const child of kept) listed += child.sizeBytes
    const remainder = entry.sizeBytes - listed
    if (remainder >= Math.max(floorBytes, entry.sizeBytes * REMAINDER_MIN_FRACTION)) {
      kept.push({
        name: foldedDirs ? 'Other items' : 'Files here',
        path: entry.path,
        sizeBytes: remainder,
        isDirectory: false,
        aggregate: true,
      })
      kept.sort((a, b) => b.sizeBytes - a.sizeBytes)
    }
  }

  entry.children = kept
}

function countUnmeasured(entry: DiskEntry): number {
  let total = entry.unmeasured ? 1 : 0
  for (const child of entry.children ?? [])
    total += countUnmeasured(child)
  return total
}

function countLines(chunk: string): number {
  let lines = 0
  for (let i = 0; i < chunk.length; i++) {
    if (chunk[i] === '\n') lines++
  }
  return lines
}

/**
 * Deep scan a specific directory with higher limits
 */
export function deepScanDirectory(dirPath: string, options: ScanOptions = {}): Promise<ScanResult> {
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

/** How many CPUs the machine has, for callers picking a `concurrency`. */
export function defaultConcurrency(): number {
  return Math.min(DEFAULT_CONCURRENCY, Math.max(4, os.cpus().length * 2))
}
