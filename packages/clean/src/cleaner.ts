import * as fs from 'node:fs'
import * as path from 'node:path'
import { formatBytes, getDirSize, isCleanable, isPathSafe } from '@system-cleaner/core'
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
    return { targetId: 'trash', targetName: 'Trash', freedBytes: 0, freedFormatted: '0 B', errors: ['Trash target not found'], skipped: [], success: false }
  }
  return cleanTarget(trashTarget)
}

/**
 * Clean directory contents (used by API routes)
 */
export async function cleanDirectory(dirPath: string): Promise<{ freedBytes: number, measured: boolean, errors: string[] }> {
  const resolvedPath = path.resolve(dirPath)
  const check = isCleanable(resolvedPath)
  if (!check.safe) {
    return { freedBytes: 0, measured: true, errors: [check.reason || 'Path is not safe'] }
  }

  // Bounded: `getDirSize` shells out to `du`, whose own timeout cannot kill a
  // process blocked in a syscall macOS will not return from. Measuring
  // ~/Library/Caches hung indefinitely, and because the measurement came first,
  // the clean never happened at all — the button did nothing, silently, on the
  // largest category the app offers. Nothing may block the delete.
  const sizeBefore = await sizeWithin(resolvedPath)
  const measured = sizeBefore !== null
  const errors: string[] = []

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

  return {
    freedBytes: measured ? Math.max(0, (sizeBefore ?? 0) - sizeAfter) : 0,
    // False when the directory could not be measured in time. The clean still
    // happened; the byte count is the part we do not know, and reporting an
    // unmeasured clean as "0 B freed" reads as a failure when it was not.
    measured,
    errors,
  }
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
