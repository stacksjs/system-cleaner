/** The agent owns scan sessions and each worker's complete process tree. */
import type { LargeFile, SimilarImageScanResult } from '@system-cleaner/disk'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import process from 'node:process'
import { text as readText } from 'node:stream/consumers'
import type { ScanRequest } from './disk-scan'
import type { ScanProgress, ScanResult } from './scan-jobs'
import { ScanJobs } from './scan-jobs'

interface WorkerRequest { request: ScanRequest, hardTimeoutMs: number }

function scannerCommand(): string[] {
  const configured = process.env.SYSTEM_CLEANER_SCANNER
  if (configured && fs.existsSync(configured)) return [configured]
  const sibling = path.join(path.dirname(process.execPath), 'system-cleaner-scan')
  if (fs.existsSync(sibling)) return [sibling]
  return path.basename(process.execPath).replace(/\.exe$/, '') === 'bun'
    ? [process.execPath, new URL('./disk-scan.ts', import.meta.url).pathname]
    : [process.execPath, 'scan']
}

/** POSIX process groups and Windows taskkill /T stop du/sips descendants too. */
export async function terminateScanProcess(proc: ChildProcess): Promise<void> {
  if (!proc.pid) return
  if (process.platform === 'win32') {
    const killer = spawn('taskkill.exe', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' })
    await new Promise<void>((resolve, reject) => {
      killer.once('error', reject)
      killer.once('close', () => resolve())
    })
    return
  }
  const signal = (name: NodeJS.Signals) => {
    try { process.kill(-proc.pid!, name) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
  }
  signal('SIGTERM')
  // A worker can exit before a descendant does. Complete the group shutdown
  // even if the parent has already closed its own pipes.
  await new Promise(resolve => setTimeout(resolve, 250))
  signal('SIGKILL')
}

async function runWorker({ request, hardTimeoutMs }: WorkerRequest, signal: AbortSignal, publish: (progress: ScanProgress) => void): Promise<ScanResult> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'system-cleaner-progress-'))
  const progressFile = path.join(directory, 'progress.json')
  const outputDirectory = path.join(directory, 'result')
  const [command, ...args] = scannerCommand()
  let resultFile = ''
  let timedOut = false
  let stopped: Promise<void> | undefined
  const proc = spawn(command, [...args, JSON.stringify({ ...request, progressFile, outputDirectory })], {
    detached: process.platform !== 'win32', cwd: '/', stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, TMPDIR: directory, TEMP: directory, TMP: directory },
  })
  const closed = new Promise<void>((resolve, reject) => {
    proc.once('error', reject)
    proc.once('close', () => resolve())
  })
  function progress(): void {
    try { publish(JSON.parse(fs.readFileSync(progressFile, 'utf8'))) }
    catch { /* The worker has not published its first snapshot yet. */ }
  }
  function stop(): void {
    progress()
    stopped ??= terminateScanProcess(proc)
    // Attach a handler immediately; the owning finally still awaits shutdown.
    void stopped.catch(() => {})
  }
  signal.addEventListener('abort', stop, { once: true })
  if (signal.aborted) stop()
  const ticker = setInterval(progress, 200)
  const deadline = setTimeout(() => {
    timedOut = true
    stop()
  }, hardTimeoutMs)
  try {
    const [, output] = await Promise.all([closed, readText(proc.stdout!)])
    resultFile = output.trim()
    if (stopped) await stopped
    progress()
    if (signal.aborted) throw new DOMException('Scan cancelled', 'AbortError')
    if (timedOut) throw new Error(`Scan exceeded ${Math.round(hardTimeoutMs / 1000)}s`)
    if (!resultFile) throw new Error('Scan produced no result')
    return JSON.parse(fs.readFileSync(resultFile, 'utf8')) as ScanResult
  }
  finally {
    clearInterval(ticker)
    clearTimeout(deadline)
    signal.removeEventListener('abort', stop)
    if (stopped) await stopped
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

export const scanJobs = new ScanJobs<WorkerRequest>(runWorker)
export function lastScanResult(kind: ScanRequest['kind']) {
  const session = scanJobs.sessions().find(item => item.kind === kind)
  return session?.result ? { at: session.finishedAt!, result: session.result } : null
}
export function scanProgress() {
  const session = scanJobs.sessions().find(item => item.status === 'running' || item.status === 'cancelling')
  return session ? { ...session.progress, id: session.id, startedAt: session.startedAt!, kind: session.kind } : null
}
export function runDiskScan(request: Omit<Extract<ScanRequest, { kind: 'tree' }>, 'kind'>, hardTimeoutMs: number, parameters: Record<string, unknown> = {}) {
  return scanJobs.start('tree', { request: { kind: 'tree', ...request }, hardTimeoutMs }, parameters)
}
export function runLargeFileScan(request: Omit<Extract<ScanRequest, { kind: 'large-files' }>, 'kind'>, hardTimeoutMs: number, parameters: Record<string, unknown> = {}) {
  return scanJobs.start('large-files', { request: { kind: 'large-files', ...request }, hardTimeoutMs }, parameters) as Promise<ScanResult & { files?: LargeFile[] }>
}
export function runDuplicateScan(request: Omit<Extract<ScanRequest, { kind: 'duplicates' }>, 'kind'>, hardTimeoutMs: number, parameters: Record<string, unknown> = {}) {
  return scanJobs.start('duplicates', { request: { kind: 'duplicates', ...request }, hardTimeoutMs }, parameters)
}
export function runSimilarScan(request: Omit<Extract<ScanRequest, { kind: 'similar' }>, 'kind'>, hardTimeoutMs: number, parameters: Record<string, unknown> = {}) {
  return scanJobs.start('similar', { request: { kind: 'similar', ...request }, hardTimeoutMs }, parameters) as Promise<ScanResult & Partial<SimilarImageScanResult>>
}
