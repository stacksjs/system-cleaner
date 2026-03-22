import * as fs from 'node:fs'
import { formatBytes, getDirSize, pathExists, safeStat } from '@system-cleaner/core'
import type { CleanTarget, CleanScanResult } from './types'

/**
 * Scan a single clean target to determine if it exists and its size
 */
export async function scanTarget(target: CleanTarget): Promise<CleanScanResult> {
  const exists = pathExists(target.path)
  if (!exists) {
    return {
      target,
      sizeBytes: 0,
      sizeFormatted: '0 B',
      exists: false,
      itemCount: 0,
    }
  }

  const stat = safeStat(target.path)
  if (!stat) {
    return {
      target,
      sizeBytes: 0,
      sizeFormatted: '0 B',
      exists: false,
      itemCount: 0,
    }
  }

  const sizeBytes = await getDirSize(target.path)
  let itemCount = 0

  try {
    itemCount = fs.readdirSync(target.path).length
  }
  catch {
    // Can't read directory contents
  }

  return {
    target,
    sizeBytes,
    sizeFormatted: formatBytes(sizeBytes),
    exists: true,
    itemCount,
  }
}

/**
 * Scan all provided targets concurrently
 */
export async function scanTargets(
  targets: CleanTarget[],
  onProgress?: (completed: number, total: number, current: string) => void,
): Promise<CleanScanResult[]> {
  const total = targets.length
  let completed = 0
  const results: CleanScanResult[] = []

  // Batch in groups of 8 to avoid spawning 150+ concurrent du processes
  const BATCH_SIZE = 8
  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    const batch = targets.slice(i, i + BATCH_SIZE)
    const batchResults = await Promise.all(
      batch.map(async (target) => {
        const result = await scanTarget(target)
        completed++
        onProgress?.(completed, total, target.name)
        return result
      }),
    )
    results.push(...batchResults)
  }

  // Sort by size descending
  return results.sort((a, b) => b.sizeBytes - a.sizeBytes)
}

/**
 * Scan targets and return only those that exist and have data
 */
export async function scanExistingTargets(
  targets: CleanTarget[],
  onProgress?: (completed: number, total: number, current: string) => void,
): Promise<CleanScanResult[]> {
  const all = await scanTargets(targets, onProgress)
  return all.filter(r => r.exists && r.sizeBytes > 0)
}

/**
 * Get total reclaimable space from scan results
 */
export function getTotalReclaimable(results: CleanScanResult[]): { bytes: number, formatted: string } {
  const bytes = results.reduce((sum, r) => sum + r.sizeBytes, 0)
  return { bytes, formatted: formatBytes(bytes) }
}
