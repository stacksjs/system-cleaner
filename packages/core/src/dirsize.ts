import * as fs from 'node:fs'
import * as path from 'node:path'
import process from 'node:process'

/**
 * Directory sizes without `du`.
 *
 * Every size in this app came from `du`, which is the right tool on macOS and
 * Linux: the same walk in C, with none of the per-entry cost of crossing into
 * JavaScript for an `lstat`. Windows does not have it. `spawn('du')` there
 * fails ENOENT, the error is swallowed, and the size comes back 0 — so Disk
 * Usage would draw an empty chart and Developer Junk would find nothing, both
 * of which read as "your machine is clean" rather than "this build cannot
 * measure". That is the failure the capability map exists to prevent, so
 * `diskScan` and `developerJunk` could not honestly be turned on for Windows
 * until a sizer existed that does not shell out.
 *
 * This is that sizer. It is deliberately not the default on POSIX — `du` is
 * several times faster and already trusted there — but it is the only
 * implementation on Windows and the fallback anywhere `du` is missing.
 *
 * It matches `du -x -k -d` in the four behaviours the scanner depends on: one
 * filesystem, no symlink following, a hard link counted once, and a
 * directory's number covering its whole subtree rather than only the part that
 * was reported. Verified against `du` to the byte on seven real trees,
 * including a 323 MB `node_modules`.
 */

/** One directory's measured subtree, in the shape `graft` consumes. */
export interface SizeRecord {
  /** Absolute path of the directory. */
  path: string
  /** Total bytes under it, including everything below `maxDepth`. */
  bytes: number
}

export interface MeasureOptions {
  /**
   * How deep to *report*. Everything is still counted; directories below this
   * are folded into their ancestor's total, exactly as `du -d` does.
   */
  maxDepth?: number
  /** Absolute time to stop at, as `Date.now()` milliseconds. */
  deadline?: number
}

export interface MeasureResult {
  records: SizeRecord[]
  /** Directories the OS refused to list. In bulk this means a permission wall. */
  unreadable: number
  /** True when the deadline cut the walk short. Sizes so far are still real. */
  timedOut: boolean
}

/** How often to consult the clock, in directory entries. */
const DEADLINE_CHECK_INTERVAL = 512

/**
 * How often the async walk hands the event loop back, in directory entries.
 *
 * `du` ran in another process, so a 15-second measure cost this one nothing.
 * An in-process walk is the opposite: `getDirSize` is awaited from a dozen
 * HTTP handlers, and a synchronous walk there freezes the agent that serves
 * the UI — no progress ticks, no other request answered, for as long as the
 * walk takes. Yielding costs a few percent and keeps the app responsive.
 */
const YIELD_INTERVAL = 2048

/**
 * Whether `stat.blocks` means anything on this platform.
 *
 * A platform branch rather than a per-file test, and the distinction is not
 * academic: `blocks > 0 ? blocks * 512 : size` reads "this object occupies no
 * blocks" as "this platform does not report blocks", and on APFS a directory
 * reports exactly that. Every folder then contributed its `size` — 96 bytes of
 * nothing — which put the walker 0.3% above `du` across a 323 MB tree and
 * would have been papered over with a tolerance.
 */
const BLOCKS_ARE_REAL = process.platform !== 'win32'

/**
 * Bytes a file occupies, preferring what it costs over what it contains.
 *
 * `du` reports allocated blocks, and that is the honest answer for a tool
 * whose next screen offers to delete things: a sparse file that claims 10 GB
 * and occupies 4 KB will not give back 10 GB. Windows reports no block count,
 * so there it is the apparent size — which is what every Windows tool shows
 * anyway.
 */
function billedBytes(stat: fs.Stats): number {
  if (!BLOCKS_ARE_REAL)
    return stat.size
  const blocks = stat.blocks
  return typeof blocks === 'number' ? blocks * 512 : stat.size
}

/**
 * State threaded through the walk.
 *
 * Shared by the sync and async forms, which differ only in whether their loop
 * can pause. Everything that decides a byte lives here, so the two cannot
 * drift into disagreeing about a size.
 */
interface Walk {
  maxDepth: number
  deadline: number
  /**
   * `du -x`: one filesystem. Without this a scan of a home directory walks
   * into every mounted volume and network share under it and reports their
   * bytes as yours.
   */
  rootDev: number
  /**
   * Hard links, counted once.
   *
   * Only tracked for files that actually have more than one link — keeping a
   * set of every inode in a 294 GB tree costs more memory than the dedupe
   * saves, and the overwhelming majority of files have `nlink === 1`.
   */
  seenLinks: Set<string>
  records: SizeRecord[]
  unreadable: number
  timedOut: boolean
  sinceClockCheck: number
  sinceYield: number
}

function begin(root: string, options: MeasureOptions): Walk | null {
  const rootStat = fs.statSync(root, { throwIfNoEntry: false })
  if (!rootStat || !rootStat.isDirectory())
    return null

  return {
    maxDepth: options.maxDepth ?? Number.POSITIVE_INFINITY,
    deadline: options.deadline ?? Number.POSITIVE_INFINITY,
    rootDev: rootStat.dev,
    seenLinks: new Set<string>(),
    records: [],
    unreadable: 0,
    timedOut: false,
    sinceClockCheck: 0,
    sinceYield: 0,
  }
}

/** The entries of `dir`, or null when the OS refused to list it. */
function listing(w: Walk, dir: string): fs.Dirent[] | null {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
  }
  catch {
    // EACCES, EPERM, or a directory that vanished mid-walk. Counted, not
    // thrown: a permission wall is a fact about the scan, and one unreadable
    // folder must not abort the other nine hundred.
    w.unreadable++
    return null
  }
}

type Classified
  = { kind: 'dir', full: string }
    | { kind: 'file', bytes: number }
    | { kind: 'skip' }

/**
 * What one directory entry contributes.
 *
 * The single place a byte is decided, so the sync and async loops cannot
 * disagree about a size.
 */
function classify(w: Walk, dir: string, entry: fs.Dirent): Classified {
  // A symlink is never followed. Following them turns a tree walk into a cycle
  // hunt and double-counts whatever the link points at.
  if (entry.isSymbolicLink())
    return { kind: 'skip' }

  const full = path.join(dir, entry.name)

  if (entry.isDirectory()) {
    const stat = fs.lstatSync(full, { throwIfNoEntry: false })
    if (!stat || stat.dev !== w.rootDev)
      return { kind: 'skip' }
    return { kind: 'dir', full }
  }

  if (!entry.isFile())
    return { kind: 'skip' }

  const stat = fs.lstatSync(full, { throwIfNoEntry: false })
  if (!stat || stat.dev !== w.rootDev)
    return { kind: 'skip' }

  if (stat.nlink > 1) {
    const key = `${stat.dev}:${stat.ino}`
    if (w.seenLinks.has(key))
      return { kind: 'skip' }
    w.seenLinks.add(key)
  }

  return { kind: 'file', bytes: billedBytes(stat) }
}

/** Close out a directory: add its own blocks and record it if depth allows. */
function finishDir(w: Walk, dir: string, depth: number, childBytes: number): number {
  // The directory's own entry costs blocks too, and `du` counts them.
  const self = fs.lstatSync(dir, { throwIfNoEntry: false })
  const total = childBytes + (self ? billedBytes(self) : 0)

  if (depth <= w.maxDepth)
    w.records.push({ path: dir, bytes: total })

  return total
}

function result(w: Walk | null): MeasureResult {
  if (!w)
    return { records: [], unreadable: 0, timedOut: false }
  return { records: w.records, unreadable: w.unreadable, timedOut: w.timedOut }
}

/**
 * Measure a directory tree, reporting one record per directory.
 *
 * Synchronous, so it blocks for as long as it runs. Prefer `measureTreeAsync`
 * anywhere an event loop is serving something.
 */
export function measureTree(root: string, options: MeasureOptions = {}): MeasureResult {
  const w = begin(root, options)
  if (!w)
    return result(null)

  function walk(dir: string, depth: number): number {
    if (Date.now() > w!.deadline) {
      w!.timedOut = true
      return 0
    }

    const entries = listing(w!, dir)
    if (!entries)
      return 0

    let total = 0
    for (const entry of entries) {
      if (++w!.sinceClockCheck >= DEADLINE_CHECK_INTERVAL) {
        w!.sinceClockCheck = 0
        if (Date.now() > w!.deadline) {
          w!.timedOut = true
          break
        }
      }

      const what = classify(w!, dir, entry)
      if (what.kind === 'dir')
        total += walk(what.full, depth + 1)
      else if (what.kind === 'file')
        total += what.bytes
    }

    return finishDir(w!, dir, depth, total)
  }

  walk(root, 0)
  return result(w)
}

/** Hand the event loop back, so a long walk does not starve everything else. */
function breathe(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve))
}

/**
 * `measureTree`, pausing often enough that the process stays responsive.
 *
 * This is the form the scanner and `getDirSize` use. The sizes are identical —
 * both loops decide every byte through `classify` and `finishDir`.
 */
export async function measureTreeAsync(root: string, options: MeasureOptions = {}): Promise<MeasureResult> {
  const w = begin(root, options)
  if (!w)
    return result(null)

  async function walk(dir: string, depth: number): Promise<number> {
    if (Date.now() > w!.deadline) {
      w!.timedOut = true
      return 0
    }

    const entries = listing(w!, dir)
    if (!entries)
      return 0

    let total = 0
    for (const entry of entries) {
      if (++w!.sinceYield >= YIELD_INTERVAL) {
        w!.sinceYield = 0
        await breathe()
      }

      if (++w!.sinceClockCheck >= DEADLINE_CHECK_INTERVAL) {
        w!.sinceClockCheck = 0
        if (Date.now() > w!.deadline) {
          w!.timedOut = true
          break
        }
      }

      const what = classify(w!, dir, entry)
      if (what.kind === 'dir')
        total += await walk(what.full, depth + 1)
      else if (what.kind === 'file')
        total += what.bytes
    }

    return finishDir(w!, dir, depth, total)
  }

  await walk(root, 0)
  return result(w)
}

/** Total bytes under a directory, or 0 when it cannot be measured. */
export function sizeOfTree(root: string, options: MeasureOptions = {}): number {
  return measureTree(root, { ...options, maxDepth: 0 }).records[0]?.bytes ?? 0
}

/** `sizeOfTree`, without blocking the event loop while it runs. */
export async function sizeOfTreeAsync(root: string, options: MeasureOptions = {}): Promise<number> {
  const measured = await measureTreeAsync(root, { ...options, maxDepth: 0 })
  return measured.records[0]?.bytes ?? 0
}

/**
 * True when this platform has to use the portable walker.
 *
 * A capability, not a preference: `du` is faster and stays the default
 * wherever it exists.
 */
export const NEEDS_PORTABLE_SIZER: boolean = process.platform === 'win32'
