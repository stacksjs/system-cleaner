import type { ScanKind, ScanSession } from '../../app/Workers/scan-jobs'

const endpoints: Record<ScanKind, string> = { tree: '/api/disk-scan', 'large-files': '/api/large-files', duplicates: '/api/duplicates-scan', similar: '/api/similar-images-scan' }
type ScanFetch = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => ReturnType<typeof fetch>
export const activeScan = (session: ScanSession) => ['queued', 'running', 'cancelling'].includes(session.status)

/** Agent sessions outlive routes; one client owns polling for every attached view. */
export class ScanSessions {
  private sessions = new Map<ScanKind, ScanSession>()
  private listeners = new Map<ScanKind, Set<(session: ScanSession) => void>>()
  private awaitingStart = new Map<ScanKind, string | undefined>()
  private timer?: ReturnType<typeof setTimeout>
  private pending?: Promise<void>
  private cancelling = new Set<string>()
  private generation = 0

  constructor(private request: ScanFetch = (input, init) => fetch(input, init), private onCompleted?: (session: ScanSession) => void) {}

  private emit(session: ScanSession): void {
    const previous = this.sessions.get(session.kind)
    this.sessions.set(session.kind, session)
    if (previous?.id === session.id && activeScan(previous) && session.status === 'completed') this.onCompleted?.(session)
    for (const listener of this.listeners.get(session.kind) ?? []) listener(session)
  }

  subscribe(kind: ScanKind, listener: (session: ScanSession) => void): () => void {
    const listeners = this.listeners.get(kind) ?? new Set()
    listeners.add(listener)
    this.listeners.set(kind, listeners)
    const held = this.sessions.get(kind)
    if (held) listener(held)
    void this.refresh().catch(() => {})
    return () => { listeners.delete(listener) }
  }

  async refresh(): Promise<void> {
    if (this.pending) return this.pending
    const generation = this.generation
    this.pending = (async () => {
      const response = await this.post('/api/scan-state', {})
      if (generation !== this.generation) return
      for (const session of response.scans as ScanSession[]) {
        if (this.awaitingStart.has(session.kind)) {
          if (session.id === this.awaitingStart.get(session.kind)) continue
          this.awaitingStart.delete(session.kind)
        }
        if (this.cancelling.has(session.id) && activeScan(session)) session.status = 'cancelling'
        this.emit(session)
      }
    })().finally(() => {
      this.pending = undefined
      clearTimeout(this.timer)
      if ([...this.sessions.values()].some(activeScan))
        this.timer = setTimeout(() => { void this.refresh().catch(() => {}) }, 400)
    })
    return this.pending
  }

  async start(kind: ScanKind, parameters: Record<string, unknown>): Promise<void> {
    await this.refresh()
    const held = this.sessions.get(kind)
    if (held && activeScan(held)) return
    this.generation++
    this.awaitingStart.set(kind, held?.id)
    this.emit({ id: '', kind, status: 'queued', parameters, createdAt: Date.now(), progress: { scanned: 0, path: '', measuredBytes: 0 } })
    const request = this.post(endpoints[kind], parameters)
    void this.refresh().catch(() => {})
    try {
      const result = await request
      if (!result.success && result.status !== 409) throw new Error(result.error || 'Scan failed')
      // A conflict joins the existing session rather than inventing a second scan.
      if (result.status === 409) this.awaitingStart.delete(kind)
      await this.refresh()
    }
    catch (error) {
      this.awaitingStart.delete(kind)
      const session = this.sessions.get(kind)!
      if (!session.id) this.emit({ ...session, status: 'failed', finishedAt: Date.now(), result: { success: false, error: error instanceof Error ? error.message : 'Scan failed' } })
      throw error
    }
  }

  async cancel(kind: ScanKind): Promise<void> {
    const session = this.sessions.get(kind)
    if (!session?.id || !activeScan(session) || session.status === 'cancelling') return
    this.generation++
    this.cancelling.add(session.id)
    this.emit({ ...session, status: 'cancelling' })
    const result = await this.post('/api/cancel-scan', { id: session.id })
    if (!result.success) {
      this.cancelling.delete(session.id)
      await this.refresh()
      throw new Error(result.error || 'Could not cancel this scan')
    }
    this.cancelling.delete(session.id)
    if (result.scan) this.emit(result.scan)
    await this.pending
    await this.refresh()
  }

  dispose(): void {
    clearTimeout(this.timer)
    this.listeners.clear()
  }

  private async post(endpoint: string, data: Record<string, unknown>) {
    const response = await this.request(endpoint, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
    if (!response.ok && ![400, 403, 409].includes(response.status)) throw new Error(`HTTP ${response.status}`)
    return { ...await response.json(), status: response.status }
  }
}
