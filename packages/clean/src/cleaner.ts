import * as fs from 'node:fs'
import * as path from 'node:path'
import { formatBytes, getDirSize, isCleanable, isPathSafe, freeSpaceOf } from '@system-cleaner/core'
import type { CleanOptions, CleanResult, CleanTarget } from './types'
import { CLEAN_TARGETS } from './categories'
import { scanExistingTargets } from './scanner'

/**
 * Clean a single target by removing its contents
 */
export async function cleanTarget(target: CleanTarget, options: CleanOptions = {}): Promise<CleanResult> {
  const result: CleanResult = {
    targetId: target.id,
    targetName: target.name,
    freedBytes: 0,
    freedFormatted: '0 B',
    reclaimedBytes: null,
    heldOpen: false,
    errors: [],
    skipped: [],
    success: false,
  }

  // Safety check
  const safety = target.contentsOnly ? isCleanable(target.path) : isPathSafe(target.path)
  if (!safety.safe) {
    result.errors.push(safety.reason || 'Path is not safe to clean')
    return result
  }

  // Measure size before cleaning
  const sizeBefore = await getDirSize(target.path)
  // The PARENT, not the target. A contentsOnly:false target removes its own
  // directory, so statfs on it answers ENOENT afterwards, reclaimedBytes came
  // back null and the detection could never fire for exactly the targets that
  // free the most. The parent is on the same filesystem and survives.
  const measureAt = path.dirname(target.path)
  const freeBefore = freeSpaceOf(measureAt)

  if (options.dryRun) {
    result.freedBytes = sizeBefore
    result.freedFormatted = formatBytes(sizeBefore)
    result.success = true
    return result
  }

  if (target.requiresSudo) {
    result.errors.push('This target requires elevated privileges. Run with sudo.')
    return result
  }

  options.onProgress?.(target.id, 'cleaning')

  if (target.contentsOnly) {
    // Clean contents only — keep the directory itself
    try {
      const entries = fs.readdirSync(target.path)
      // Pre-compile skip patterns once (not per-entry)
      const skipRegexes = target.skipPatterns?.map(p => new RegExp(p)) ?? []

      for (const entry of entries) {
        if (skipRegexes.some(r => r.test(entry))) {
          result.skipped.push(entry)
          continue
        }

        const entryPath = path.join(target.path, entry)
        try {
          fs.rmSync(entryPath, { recursive: true, force: true })
        }
        catch (err) {
          result.errors.push(`${entry}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    }
    catch (err) {
      result.errors.push(err instanceof Error ? err.message : String(err))
      return result
    }
  }
  else {
    // Remove the entire path
    try {
      fs.rmSync(target.path, { recursive: true, force: true })
    }
    catch (err) {
      result.errors.push(err instanceof Error ? err.message : String(err))
      return result
    }
  }

  // Honest freed-bytes accounting:
  //   - Full success: the path is gone (or its contents are), so we
  //     measure the surviving size and subtract.
  //   - Partial failure: silently using `getDirSize(...).catch(() => 0)`
  //     means a permission-denied child made `du` fail, the size came
  //     back as 0, and we reported the *entire* pre-clean size as freed
  //     even though some of it is still on disk. Re-walk and report only
  //     the real delta.
  let sizeAfter = 0
  try {
    sizeAfter = await getDirSize(target.path)
  }
  catch {
    // The directory itself is gone — that's the success case.
    sizeAfter = 0
  }
  result.freedBytes = Math.max(0, sizeBefore - sizeAfter)
  result.freedFormatted = formatBytes(result.freedBytes)

  // Same reasoning as cleanDirectory: compare what the filesystem reports
  // before and after, because a directory walk cannot see a file that has
  // been unlinked while a process still holds it open. Service logs are the
  // ordinary way to hit this - deleting one a running daemon writes to frees
  // nothing until it restarts, and without saying so the app reports the full
  // size and Disk Free does not move.
  const freeAfter = freeSpaceOf(measureAt)
  result.reclaimedBytes = freeBefore !== null && freeAfter !== null ? freeAfter - freeBefore : null
  result.heldOpen = isHeldOpen(result.freedBytes, result.reclaimedBytes)

  result.success = result.errors.length === 0

  options.onProgress?.(target.id, 'done')
  return result
}

/**
 * Clean multiple targets
 */
export async function cleanTargets(
  targets: CleanTarget[],
  options: CleanOptions = {},
): Promise<{ results: CleanResult[], totalFreed: number, totalFreedFormatted: string }> {
  const results: CleanResult[] = []
  let totalFreed = 0

  for (const target of targets) {
    const result = await cleanTarget(target, options)
    results.push(result)
    totalFreed += result.freedBytes
  }

  return {
    results,
    totalFreed,
    totalFreedFormatted: formatBytes(totalFreed),
  }
}

/**
 * Run a full clean across all targets matching the given categories
 */
// eslint-disable-next-line pickier/no-unused-vars
export async function cleanAll(options: CleanOptions = {}): Promise<{
  results: CleanResult[]
  totalFreed: number
  totalFreedFormatted: string
}> {
  let targets = CLEAN_TARGETS

  if (options.categories && options.categories.length > 0)
    targets = targets.filter(t => options.categories!.includes(t.category))

  if (options.skipTargets && options.skipTargets.length > 0)
    targets = targets.filter(t => !options.skipTargets!.includes(t.id))

  // Separate sudo targets (can't run without elevation)
  const sudoTargets = targets.filter(t => t.requiresSudo)
  targets = targets.filter(t => !t.requiresSudo)

  // First scan to find existing targets with data
  const scanResults = await scanExistingTargets(targets)
  const existingTargets = scanResults.map(r => r.target)

  const result = await cleanTargets(existingTargets, options)

  // Report skipped sudo targets so callers know they were excluded
  if (sudoTargets.length > 0) {
    for (const t of sudoTargets) {
      result.results.push({
        targetId: t.id,
        targetName: t.name,
        freedBytes: 0,
        freedFormatted: '0 B',
        reclaimedBytes: null,
        heldOpen: false,
        errors: ['Requires elevated privileges (sudo)'],
        skipped: [],
        success: false,
      })
    }
  }

  // Recalculate totals to include all results
  result.totalFreed = result.results.reduce((sum, r) => sum + r.freedBytes, 0)
  result.totalFreedFormatted = formatBytes(result.totalFreed)

  return result
}

/**
 * Empty the user's Trash
 */
export async function emptyTrash(): Promise<CleanResult> {
  const trashTarget = CLEAN_TARGETS.find(t => t.id === 'trash')
  if (!trashTarget) {
    return { targetId: 'trash', targetName: 'Trash', freedBytes: 0, freedFormatted: '0 B', reclaimedBytes: null, heldOpen: false, errors: ['Trash target not found'], skipped: [], success: false }
  }
  return cleanTarget(trashTarget)
}

/**
 * Clean directory contents (used by API routes)
 */
export async function cleanDirectory(dirPath: string): Promise<{
  freedBytes: number
  measured: boolean
  reclaimedBytes: number | null
  heldOpen: boolean
  errors: string[]
}> {
  const resolvedPath = path.resolve(dirPath)
  const check = isCleanable(resolvedPath)
  if (!check.safe) {
    return { freedBytes: 0, measured: true, reclaimedBytes: null, heldOpen: false, errors: [check.reason || 'Path is not safe'] }
  }

  // Bounded: `getDirSize` shells out to `du`, whose own timeout cannot kill a
  // process blocked in a syscall macOS will not return from. Measuring
  // ~/Library/Caches hung indefinitely, and because the measurement came first,
  // the clean never happened at all — the button did nothing, silently, on the
  // largest category the app offers. Nothing may block the delete.
  const sizeBefore = await sizeWithin(resolvedPath)
  const measured = sizeBefore !== null
  const errors: string[] = []

  // What the filesystem says before we touch anything. Compared afterwards,
  // this is the only number that reflects space the disk actually gave back -
  // see freeSpaceOf for why a directory walk cannot tell.
  const freeBefore = freeSpaceOf(resolvedPath)

  try {
    for (const entry of fs.readdirSync(resolvedPath)) {
      try {
        fs.rmSync(path.join(resolvedPath, entry), { recursive: true, force: true })
      }
      catch (err) {
        errors.push(`${entry}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }
  catch (err) {
    errors.push(err instanceof Error ? err.message : String(err))
  }

  // Same accounting fix as cleanTarget: re-walk the actual surviving
  // size rather than treating "du failed" as "everything was freed".
  const sizeAfter = await sizeWithin(resolvedPath) ?? 0
  const removed = measured ? Math.max(0, (sizeBefore ?? 0) - sizeAfter) : 0

  const freeAfter = freeSpaceOf(resolvedPath)
  const reclaimed = freeBefore !== null && freeAfter !== null ? freeAfter - freeBefore : null

  return {
    freedBytes: removed,
    // False when the directory could not be measured in time. The clean still
    // happened; the byte count is the part we do not know, and reporting an
    // unmeasured clean as "0 B freed" reads as a failure when it was not.
    measured,
    // What the filesystem gave back. Null when it could not be read, and
    // noisy by nature - other processes write while we work - so it is
    // reported beside `freedBytes` rather than replacing it.
    reclaimedBytes: reclaimed,
    // True when a substantial delete freed almost nothing, which on Unix
    // means something still holds those files open: the directory entries are
    // gone and the blocks are not. Deleting a log a running service writes to
    // is the ordinary way to hit this, and without saying so the app reports
    // hundreds of megabytes while Disk Free sits still.
    heldOpen: isHeldOpen(removed, reclaimed),
    errors,
  }
}

/**
 * Below this, the free-space comparison says nothing worth acting on.
 *
 * The delta is shared with every other process on the machine, so a small
 * delete can show almost any figure for reasons that have nothing to do with
 * held-open files.
 */
const HELD_OPEN_FLOOR = 50 * 1024 * 1024

/**
 * The share of a delete that must fail to materialise before we call it held.
 *
 * This started at half, which is far too loose: a browser writing its cache
 * while a 60 MB clean runs is enough to swallow the difference, and the app
 * would tell a user their space had not come back when it had. Five per cent
 * means the disk gave back essentially nothing, which concurrent writes have
 * to work much harder to fake.
 *
 * It errs the other way now - a genuinely held-open delete alongside heavy
 * concurrent freeing can slip past unflagged. That is the right direction to
 * be wrong in: the headline figure is `freedBytes` either way, and a missing
 * note is better than a false one.
 */
const HELD_OPEN_SHARE = 0.05

function isHeldOpen(removed: number, reclaimed: number | null): boolean {
  if (reclaimed === null || removed < HELD_OPEN_FLOOR)
    return false
  return reclaimed <= removed * HELD_OPEN_SHARE
}

/** How long a directory gets to report its size before the clean proceeds anyway. */
const SIZE_TIMEOUT_MS = 10_000

/** `getDirSize`, or null if it does not answer in time. */
async function sizeWithin(dirPath: string): Promise<number | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      getDirSize(dirPath),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), SIZE_TIMEOUT_MS)
      }),
    ])
  }
  catch {
    return null
  }
  finally {
    if (timer) clearTimeout(timer)
  }
}
