import { randomUUID } from 'node:crypto'

export type ScanKind = 'tree' | 'large-files' | 'duplicates' | 'similar'
export type ScanStatus = 'queued' | 'running' | 'cancelling' | 'completed' | 'cancelled' | 'failed'
export type ScanResult = { success: boolean, cancelled?: boolean, truncated?: boolean, error?: string, [key: string]: unknown }
export interface ScanProgress {
  scanned: number
  path: string
  measuredBytes: number
  snapshot?: ScanResult
}
export interface ScanSession {
  id: string
  kind: ScanKind
  status: ScanStatus
  parameters: Record<string, unknown>
  createdAt: number
  startedAt?: number
  finishedAt?: number
  progress: ScanProgress
  result?: ScanResult
}
interface Job<Request> {
  session: ScanSession
  request: Request
  controller: AbortController
  result: Promise<ScanResult>
  resolve: (result: ScanResult) => void
}
export type ScanRunner<Request> = (request: Request, signal: AbortSignal, publish: (progress: ScanProgress) => void) => Promise<ScanResult>
export const isScanActive = (status: ScanStatus) => status === 'queued' || status === 'running' || status === 'cancelling'

/** One session per scan kind, retained until explicitly replaced by a new scan. */
export class ScanJobs<Request> {
  private jobs = new Map<ScanKind, Job<Request>>()
  private tail: Promise<unknown> = Promise.resolve()

  constructor(private runner: ScanRunner<Request>) {}

  start(kind: ScanKind, request: Request, parameters: Record<string, unknown> = {}): Promise<ScanResult> {
    const previous = this.jobs.get(kind)
    if (previous && isScanActive(previous.session.status)) return previous.result
    let resolve!: (result: ScanResult) => void
    const result = new Promise<ScanResult>((done) => { resolve = done })
    const job: Job<Request> = {
      request, result, resolve, controller: new AbortController(),
      session: { id: randomUUID(), kind, status: 'queued', parameters, createdAt: Date.now(), progress: { scanned: 0, path: '', measuredBytes: 0 } },
    }
    this.jobs.set(kind, job)
    this.tail = this.tail.then(() => this.run(job))
    return result
  }

  sessions(): ScanSession[] {
    return [...this.jobs.values()].map(job => structuredClone(job.session))
  }

  async cancel(id: string): Promise<ScanSession | null> {
    const job = [...this.jobs.values()].find(item => item.session.id === id)
    if (!job) return null
    if (job.session.status === 'queued') {
      job.controller.abort()
      this.finish(job, 'cancelled', this.partial(job))
    }
    else if (job.session.status === 'running') {
      job.session.status = 'cancelling'
      job.controller.abort()
    }
    await job.result
    return structuredClone(job.session)
  }

  private partial(job: Job<Request>): ScanResult {
    return { ...job.session.progress.snapshot, success: true, cancelled: true, truncated: true,
      scanned: job.session.progress.scanned, scanTime: `${(((job.session.finishedAt ?? Date.now()) - (job.session.startedAt ?? Date.now())) / 1000).toFixed(1)}s` }
  }

  private finish(job: Job<Request>, status: ScanStatus, result: ScanResult): void {
    job.session.status = status
    job.session.finishedAt = Date.now()
    job.session.result = { ...result, scanId: job.session.id }
    job.resolve(job.session.result)
  }

  private async run(job: Job<Request>): Promise<void> {
    if (job.controller.signal.aborted) return
    job.session.status = 'running'
    job.session.startedAt = Date.now()
    try {
      const result = await this.runner(job.request, job.controller.signal, (progress) => {
        job.session.progress = progress
      })
      this.finish(job, job.controller.signal.aborted ? 'cancelled' : result.success ? 'completed' : 'failed',
        job.controller.signal.aborted ? this.partial(job) : result)
    }
    catch (error) {
      const cancelled = job.controller.signal.aborted && error instanceof Error && error.name === 'AbortError'
      this.finish(job, cancelled ? 'cancelled' : 'failed', cancelled
        ? this.partial(job)
        : { success: false, error: error instanceof Error ? error.message : 'Scan failed' })
    }
  }
}
