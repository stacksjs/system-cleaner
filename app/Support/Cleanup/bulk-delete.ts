import * as fs from 'node:fs'
import * as path from 'node:path'
import { formatBytes, getDirSize, isPathSafe } from '@system-cleaner/core'
import { moveManyToTrash } from '@system-cleaner/disk'
import CleanupRun from '../../Models/CleanupRun'
import ProtectedPath from '../../Models/ProtectedPath'

/**
 * Upper bound on one bulk request. Well above any plausible manual selection,
 * low enough that a malformed client can't ask the server to stat a million
 * paths inside one request.
 */
export const MAX_BULK_PATHS = 1000

export type DeleteMode = 'trash' | 'permanent'

export interface BulkDeleteOutcome {
  succeeded: string[]
  failed: { path: string, error: string }[]
  skipped: { path: string, reason: string }[]
  freedBytes: number
  freedFormatted: string
}

/** Every path the user has marked as never-delete, as absolute paths. */
export async function protectedPathSet(): Promise<Set<string>> {
  const rows = await ProtectedPath.all() as Array<{ path: string }>
  return new Set(rows.map(row => path.resolve(row.path)))
}

export async function listProtectedPaths(): Promise<Array<{ id: number, path: string, reason: string | null }>> {
  const rows = await ProtectedPath.orderByDesc('id').get() as Array<{
    id: number
    path: string
    reason: string | null
  }>
  return rows.map(row => ({ id: row.id, path: row.path, reason: row.reason ?? null }))
}

export async function protectPath(target: string, reason?: string): Promise<{ path: string }> {
  const resolved = path.resolve(target)
  // Idempotent: protecting an already-protected path is a no-op, not a
  // unique-constraint error the UI would have to special-case.
  await ProtectedPath.firstOrCreate({ path: resolved }, { reason: reason ?? null })
  return { path: resolved }
}

export async function unprotectPath(target: string): Promise<{ removed: boolean }> {
  const resolved = path.resolve(target)
  const existing = await ProtectedPath.where('path', resolved).first() as { id: number } | undefined
  if (!existing)
    return { removed: false }
  await ProtectedPath.remove(existing.id)
  return { removed: true }
}

export interface CleanupHistory {
  lifetimeFreedBytes: number
  lifetimeFreedFormatted: string
  runCount: number
  runs: Array<{
    id: number
    source: string
    mode: string
    itemCount: number
    failedCount: number
    freedBytes: number
    freedFormatted: string
    createdAt: string
  }>
}

export async function cleanupHistory(limit = 20): Promise<CleanupHistory> {
  const rows = await CleanupRun.orderByDesc('id').limit(limit).get() as Array<{
    id: number
    source: string
    mode: string
    item_count: number
    failed_count: number
    freed_bytes: number
    created_at: string
  }>

  const lifetime = Number(await CleanupRun.sum('freedBytes')) || 0

  return {
    lifetimeFreedBytes: lifetime,
    lifetimeFreedFormatted: formatBytes(lifetime),
    runCount: Number(await CleanupRun.count()) || 0,
    runs: rows.map(row => ({
      id: row.id,
      source: row.source,
      mode: row.mode,
      itemCount: row.item_count,
      failedCount: row.failed_count,
      freedBytes: row.freed_bytes,
      freedFormatted: formatBytes(row.freed_bytes),
      createdAt: row.created_at,
    })),
  }
}

/**
 * Size a path before it is deleted.
 *
 * Has to happen up front: once the item is in the Trash the original path no
 * longer resolves, and "you reclaimed 0 bytes" is the least useful possible
 * answer to a bulk cleanup.
 */
async function sizeOf(target: string): Promise<number> {
  try {
    const stat = fs.lstatSync(target)
    return stat.isDirectory() ? await getDirSize(target) : stat.size
  }
  catch {
    return 0
  }
}

/**
 * Delete many paths in one pass, recording the result as a {@link CleanupRun}.
 *
 * Three separate outcomes, kept distinct on purpose:
 *   - `skipped`  — refused before touching the disk (unsafe or protected)
 *   - `failed`   — attempted and the filesystem said no
 *   - `succeeded`— gone
 *
 * Collapsing the first two would tell a user that a file they explicitly
 * protected "failed to delete", which reads like a bug in the app rather than
 * the app doing exactly what they asked.
 */
export async function bulkDelete(
  paths: string[],
  mode: DeleteMode,
  source: string,
): Promise<BulkDeleteOutcome> {
  const skipped: { path: string, reason: string }[] = []
  const failed: { path: string, error: string }[] = []
  const sizes = new Map<string, number>()

  const protectedPaths = await protectedPathSet()

  // Deduplicate first: a client that sends the same path twice would
  // otherwise count its bytes twice in the freed total.
  const unique = [...new Set(paths.map(p => path.resolve(p)))]

  const deletable: string[] = []
  for (const target of unique) {
    if (protectedPaths.has(target)) {
      skipped.push({ path: target, reason: 'Protected — remove it from the protected list first' })
      continue
    }

    const check = isPathSafe(target)
    if (!check.safe) {
      skipped.push({ path: target, reason: check.reason || 'Unsafe path' })
      continue
    }

    sizes.set(target, await sizeOf(target))
    deletable.push(target)
  }

  const succeeded: string[] = []

  if (mode === 'permanent') {
    // Deepest first, so a child is removed before the parent that contains it.
    const ordered = [...deletable].sort((a, b) => b.split('/').length - a.split('/').length)
    for (const target of ordered) {
      try {
        fs.rmSync(target, { recursive: true, force: true })
        succeeded.push(target)
      }
      catch (err) {
        failed.push({ path: target, error: err instanceof Error ? err.message : 'Delete failed' })
      }
    }
  }
  else {
    const result = await moveManyToTrash(deletable)
    succeeded.push(...result.succeeded)
    failed.push(...result.failed)
  }

  const freedBytes = succeeded.reduce((sum, target) => sum + (sizes.get(target) ?? 0), 0)

  // Only record runs that actually did something. A selection where every
  // path was protected is not a cleanup, and logging it would make the
  // history unreadable.
  if (succeeded.length > 0 || failed.length > 0) {
    await CleanupRun.create({
      source,
      mode,
      itemCount: succeeded.length,
      failedCount: failed.length,
      freedBytes,
    })
  }

  return {
    succeeded,
    failed,
    skipped,
    freedBytes,
    freedFormatted: formatBytes(freedBytes),
  }
}
