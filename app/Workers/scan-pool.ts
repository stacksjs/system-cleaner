/**
 * Runs disk scans in a child process, one at a time.
 *
 * Off-process rather than off-thread — see the note at the top of
 * `./disk-scan.ts`. The two properties that matter are unchanged: the HTTP
 * server never blocks on a walk, and a scan that wedges can be stopped, which
 * a `Worker` stuck inside a blocking `readdir` cannot be.
 */

import type { LargeFile } from '@system-cleaner/disk'
import * as fs from 'node:fs'
import * as path from 'node:path'
import process from 'node:process'

type TreeScanRequest = {
  kind: 'tree'
  home: string
  maxDepth?: number
  timeoutMs?: number
}

type LargeFilesRequest = {
  kind: 'large-files'
  roots: string[]
  minSizeBytes?: number
  limit?: number
  timeoutMs?: number
  categories?: string[]
}

type ScanRequest = TreeScanRequest | LargeFilesRequest

export type TreeScanResult = {
  success: boolean
  tree?: unknown
  folderCount?: number
  fileCount?: number
  scanTime?: string
  error?: string
}

export type LargeFilesResult = {
  success: boolean
  files?: LargeFile[]
  scanned?: number
  matched?: number
  totalBytes?: number
  truncated?: boolean
  scanTime?: string
  error?: string
}

type ScanResult = TreeScanResult | LargeFilesResult

/**
 * How to invoke the scanner.
 *
 * Packaged, it is a sibling binary in `Contents/MacOS`, and the launcher points
 * `SYSTEM_CLEANER_SCANNER` at it. In development the source runs under `bun`.
 * Resolved once, because the answer cannot change within a process.
 */
let scannerCommand: string[] | null = null

function resolveScanner(): string[] {
  if (scannerCommand)
    return scannerCommand

  const configured = process.env.SYSTEM_CLEANER_SCANNER
  if (configured && fs.existsSync(configured)) {
    scannerCommand = [configured]
    return scannerCommand
  }

  const sibling = path.join(path.dirname(process.execPath), 'system-cleaner-scan')
  if (fs.existsSync(sibling)) {
    scannerCommand = [sibling]
    return scannerCommand
  }

  scannerCommand = [process.execPath, new URL('./disk-scan.ts', import.meta.url).pathname]
  return scannerCommand
}

/**
 * Serialise scans. A single walk already saturates the disk, and two at once
 * make both slower without finishing sooner.
 */
let inFlight: Promise<unknown> = Promise.resolve()

async function runScanner(request: ScanRequest, hardTimeoutMs: number): Promise<ScanResult> {
  const proc = Bun.spawn(resolveScanner(), {
    stdin: new TextEncoder().encode(JSON.stringify(request)),
    stdout: 'pipe',
    stderr: 'ignore',
  })

  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    try {
      proc.kill()
    }
    catch {
      // Already exited.
    }
  }, hardTimeoutMs)

  try {
    const output = await new Response(proc.stdout).text()
    await proc.exited

    if (timedOut)
      throw new Error(`Scan exceeded ${Math.round(hardTimeoutMs / 1000)}s`)

    if (!output.trim())
      throw new Error('Scan produced no result')

    return JSON.parse(output) as ScanResult
  }
  catch (err) {
    if (timedOut)
      throw new Error(`Scan exceeded ${Math.round(hardTimeoutMs / 1000)}s`)
    throw err instanceof Error ? err : new Error('Scan failed')
  }
  finally {
    clearTimeout(timer)
  }
}

function enqueue(request: ScanRequest, hardTimeoutMs: number): Promise<ScanResult> {
  // Chain onto the previous scan whether it resolved or rejected, so one
  // failure does not wedge the queue.
  const next = inFlight
    .catch(() => {})
    .then(() => runScanner(request, hardTimeoutMs))

  inFlight = next.catch(() => {})
  return next
}

export function runDiskScan(
  request: Omit<TreeScanRequest, 'kind'>,
  hardTimeoutMs: number,
): Promise<TreeScanResult> {
  return enqueue({ kind: 'tree', ...request }, hardTimeoutMs) as Promise<TreeScanResult>
}

export function runLargeFileScan(
  request: Omit<LargeFilesRequest, 'kind'>,
  hardTimeoutMs: number,
): Promise<LargeFilesResult> {
  return enqueue({ kind: 'large-files', ...request }, hardTimeoutMs) as Promise<LargeFilesResult>
}
