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
  /** True when the walk ran out of time or entries before finishing. */
  truncated?: boolean
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
  // The request goes in argv, and stdin is closed outright: a scanner blocked
  // on a pipe cannot notice that its parent has gone, and orphans accumulated
  // one per app restart. `cwd` is the filesystem root so the compiled binary
  // never picks up a `bunfig.toml` from wherever the app happened to start.
  const proc = Bun.spawn([...resolveScanner(), JSON.stringify(request)], {
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'ignore',
    cwd: '/',
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

  let resultFile = ''
  try {
    // Stdout carries only the path of the result file — see the note at the
    // top of ./disk-scan.ts for why the payload does not come through here.
    resultFile = (await new Response(proc.stdout).text()).trim()
    await proc.exited

    if (timedOut)
      throw new Error(`Scan exceeded ${Math.round(hardTimeoutMs / 1000)}s`)

    if (!resultFile)
      throw new Error('Scan produced no result')

    return JSON.parse(fs.readFileSync(resultFile, 'utf8')) as ScanResult
  }
  catch (err) {
    if (timedOut)
      throw new Error(`Scan exceeded ${Math.round(hardTimeoutMs / 1000)}s`)
    throw err instanceof Error ? err : new Error('Scan failed')
  }
  finally {
    clearTimeout(timer)
    // The scanner cannot clean up after itself: it has exited by the time the
    // file has been read. Its parent directory goes too, so a killed scan
    // leaves at most one stray under the OS temp dir.
    if (resultFile) {
      try { fs.rmSync(path.dirname(resultFile), { recursive: true, force: true }) }
      catch {}
    }
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
