/**
 * Out-of-process disk scanner.
 *
 * Takes one JSON scan request as its single argument, writes the result to a
 * temp file, and prints that file's path on stdout. `app/Workers/scan-pool.ts`
 * is the only caller, and deletes the file once it has read it.
 *
 * The request arrives in argv rather than on stdin so that this process never
 * blocks on a pipe it does not control. Reading stdin left orphans — a scanner
 * whose parent had exited sat at 0% CPU forever waiting for an EOF that was
 * never coming, and every app restart added another.
 *
 * The result travels through the filesystem rather than the pipe because a
 * full-home tree serialises to megabytes, and handing that much to stdout and
 * immediately exiting does not survive: the scan completed, the JSON was
 * correct, and the parent sat waiting on a stream that never closed until its
 * hard timeout killed the child — which looked exactly like a scan that hangs.
 * A path is a few dozen bytes and cannot run into that.
 *
 * This was a `Worker` until the desktop build needed it. `bun build --compile`
 * does not embed worker entrypoints — the compiled binary rewrites the URL to
 * `/$bunfs/root/disk-scan.ts` and then fails to resolve it — so a Worker works
 * under `buddy dev` and is missing from the shipped app, which is the worst
 * possible split. A child process runs identically in both, and killing one is
 * more dependable than terminating a Worker when a scan wedges in a blocking
 * `readdir` the scan's own deadline cannot interrupt.
 */

import type { FileCategory } from '@system-cleaner/disk'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import process from 'node:process'
import { scanDirectory, scanLargeFiles } from '@system-cleaner/disk'

interface TreeScanRequest {
  kind: 'tree'
  home: string
  maxDepth?: number
  timeoutMs?: number
}

interface LargeFilesRequest {
  kind: 'large-files'
  roots: string[]
  minSizeBytes?: number
  limit?: number
  timeoutMs?: number
  categories?: string[]
}

export type ScanRequest = TreeScanRequest | LargeFilesRequest

function isPositiveInt(value: unknown, max = Number.MAX_SAFE_INTEGER): boolean {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= max
}

function isOptionalDuration(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value) && value >= 0)
}

/**
 * Validate at the trust boundary. The request arrives as text from another
 * process, so nothing in it reaches `scanDirectory` or `scanLargeFiles`
 * unchecked.
 */
export function isValidRequest(value: unknown): value is ScanRequest {
  if (typeof value !== 'object' || value === null)
    return false

  // Deliberately an index signature rather than `Partial<Tree & Large>`:
  // intersecting the two literal `kind`s collapses to `never`, which makes
  // every field access below an error.
  const v = value as Record<string, unknown>

  if (!isOptionalDuration(v.timeoutMs))
    return false

  if (v.kind === 'tree') {
    if (typeof v.home !== 'string' || v.home.length === 0)
      return false
    if (v.maxDepth !== undefined && !isPositiveInt(v.maxDepth))
      return false
    return true
  }

  if (v.kind === 'large-files') {
    if (!Array.isArray(v.roots) || v.roots.length === 0)
      return false
    if (!v.roots.every(root => typeof root === 'string' && root.length > 0))
      return false
    if (v.minSizeBytes !== undefined && (typeof v.minSizeBytes !== 'number' || !Number.isFinite(v.minSizeBytes) || v.minSizeBytes < 0))
      return false
    if (v.limit !== undefined && !isPositiveInt(v.limit, 5000))
      return false
    if (v.categories !== undefined && (!Array.isArray(v.categories) || !v.categories.every(c => typeof c === 'string')))
      return false
    return true
  }

  return false
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

export function runScan(request: ScanRequest): Record<string, unknown> {
  if (request.kind === 'large-files') {
    const result = scanLargeFiles({
      roots: request.roots,
      minSizeBytes: request.minSizeBytes,
      limit: request.limit,
      timeoutMs: request.timeoutMs,
      categories: request.categories as FileCategory[] | undefined,
    })

    return {
      success: true,
      files: result.files,
      scanned: result.scanned,
      matched: result.matched,
      totalBytes: result.totalBytes,
      truncated: result.truncated,
      scanTime: formatDuration(result.scanTimeMs),
    }
  }

  const result = scanDirectory(request.home, {
    maxDepth: request.maxDepth,
    timeoutMs: request.timeoutMs,
  })

  return {
    success: true,
    tree: result.tree,
    folderCount: result.totalFolders,
    fileCount: result.totalFiles,
    scanTime: formatDuration(result.scanTimeMs),
    truncated: result.aborted,
  }
}

/** Write `payload` to a temp file and print its path. */
async function emit(payload: Record<string, unknown>): Promise<never> {
  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'system-cleaner-scan-')),
    'result.json',
  )
  fs.writeFileSync(file, JSON.stringify(payload))
  await Bun.write(Bun.stdout, `${file}\n`)
  process.exit(0)
}

if (import.meta.main) {
  const input = process.argv[2] ?? ''

  let parsed: unknown
  try {
    parsed = JSON.parse(input)
  }
  catch {
    await emit({ success: false, error: 'Invalid scan request' })
  }

  if (!isValidRequest(parsed))
    await emit({ success: false, error: 'Invalid scan request' })

  try {
    await emit(runScan(parsed as ScanRequest))
  }
  catch (e: any) {
    await emit({ success: false, error: e?.message || 'Scan failed' })
  }
}
