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

  const sizeAfter = await getDirSize(target.path).catch(() => 0)
  result.freedBytes = Math.max(0, sizeBefore - sizeAfter)
  result.freedFormatted = formatBytes(result.freedBytes)
  result.success = true

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

  // Skip sudo targets — they require elevated privileges
  targets = targets.filter(t => !t.requiresSudo)

  // First scan to find existing targets with data
  const scanResults = await scanExistingTargets(targets)
  const existingTargets = scanResults.map(r => r.target)

  return cleanTargets(existingTargets, options)
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
export async function cleanDirectory(dirPath: string): Promise<{ freedBytes: number, errors: string[] }> {
  const resolvedPath = path.resolve(dirPath)
  const check = isCleanable(resolvedPath)
  if (!check.safe) {
    return { freedBytes: 0, errors: [check.reason || 'Path is not safe'] }
  }

  const sizeBefore = await getDirSize(resolvedPath)
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

  const sizeAfter = await getDirSize(resolvedPath).catch(() => 0)
  return { freedBytes: Math.max(0, sizeBefore - sizeAfter), errors }
}
