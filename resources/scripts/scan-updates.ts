import type { ScanKind } from '../../app/Workers/scan-jobs'
import { activeScan, ScanSessions } from '../lib/scan-sessions'

/** Consume complete NDJSON records, including records split across network chunks. */
async function streamMeasurements(endpoint: string, data: Record<string, unknown>, onUpdate: (sizes: Record<string, number>) => void) {
  const response = await fetch(endpoint, {
    method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...data, stream: true }),
  })
  if (!response.ok || !response.body) throw new Error(`Measurement failed (HTTP ${response.status})`)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  let result: { success?: boolean, complete?: boolean, sizes?: Record<string, number>, stale?: boolean, error?: string } | undefined
  const sizes: Record<string, number> = {}
  try {
    while (true) {
      const { value, done } = await reader.read()
      pending += decoder.decode(value, { stream: !done })
      let end: number
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end)
        pending = pending.slice(end + 1)
        if (!line.trim()) continue
        const record = JSON.parse(line)
        if (record.sizes) {
          Object.assign(sizes, record.sizes)
          onUpdate({ ...sizes })
        }
        if (record.complete) result = record
      }
      if (done) break
    }
  }
  finally { reader.releaseLock() }
  if (!result?.success) throw new Error(result?.error || 'Measurement stream ended before completion')
  return result
}

const scanSessions = new ScanSessions(undefined, (session) => {
  const names = { tree: 'Disk Usage', 'large-files': 'Large Files', duplicates: 'Duplicates', similar: 'Similar Images' }
  void window.notifyIfAway({ title: `${names[session.kind]} scan finished`, body: 'Your results are ready.',
    elapsedMs: (session.finishedAt ?? Date.now()) - (session.startedAt ?? Date.now()) })
})
type ScanPage = {
  $el: HTMLElement,
  scanning: boolean, cancelling: boolean, cancelled: boolean, scanId: string, scanStatus: string,
  scanProgress: string, scanProgressPath: string, scanStalled?: boolean,
  scanRoot?: string, root?: string, customRoot?: string, minSizeMB?: number,
  selected?: string[], filter?: string, activeCategory?: string,
  scanned: boolean, applyResult: (result: Record<string, unknown>) => void,
  toast: (message: string, type: string) => void,
}
const pageState = new Map<ScanKind, Record<string, unknown>>()
const bindings = new Map<ScanKind, { owner: HTMLElement, detach: () => void }>()
window.addEventListener('stx:navigate', () => {
  for (const [kind, binding] of bindings) {
    if (binding.owner.isConnected) continue
    binding.detach()
    bindings.delete(kind)
  }
})
const savedFields = ['selected', 'filter', 'activeCategory', 'scanRoot', 'customRoot', 'minSizeMB', 'root'] as const

function attachScanPage(page: ScanPage, kind: ScanKind): void {
  Object.assign(page, pageState.get(kind) ?? {})
  let previousId: string | undefined
  const detach = scanSessions.subscribe(kind, (session) => {
    if (previousId !== undefined && previousId !== session.id) page.selected = []
    previousId = session.id
    page.scanId = session.id
    page.scanStatus = session.status
    page.scanning = activeScan(session)
    page.cancelling = session.status === 'cancelling'
    page.cancelled = session.status === 'cancelled'
    if (typeof session.parameters.path === 'string') {
      if (kind === 'similar') page.root = session.parameters.path
      else { page.scanRoot = session.parameters.path; page.customRoot = session.parameters.path }
    }
    if (typeof session.parameters.minSizeMB === 'number') page.minSizeMB = session.parameters.minSizeMB
    const result = session.result ?? session.progress.snapshot
    if (result) page.applyResult(result)
    else if (page.scanning) { page.applyResult({}); page.scanned = false }
    const elapsed = Math.max(0, Math.round(((session.finishedAt ?? Date.now()) - (session.startedAt ?? Date.now())) / 1000))
    const count = session.progress.scanned.toLocaleString()
    page.scanProgress = session.status === 'queued' ? 'Queued — waiting for another scan'
      : `${page.cancelling ? 'Cancelling… · ' : ''}${count} items · ${elapsed}s`
    page.scanProgressPath = session.progress.path
    page.scanStalled = false
    if (session.status === 'failed') page.toast(String(session.result?.error || 'Scan failed'), 'error')
  })
  // STX's navigate event follows the content swap and precedes the next
  // route's setup. Detach that route's observer, never the shared scan itself.
  bindings.get(kind)?.detach()
  bindings.set(kind, { owner: page.$el, detach: () => {
    pageState.set(kind, Object.fromEntries(savedFields.map(key => [key, Array.isArray(page[key]) ? [...page[key] as unknown[]] : page[key]])))
    detach()
  } })
}
function startScanPage(page: ScanPage, kind: ScanKind, parameters: Record<string, unknown>): void {
  void scanSessions.start(kind, parameters).catch(error => page.toast(error.message || 'Could not start scan', 'error'))
}
function cancelScanPage(page: ScanPage, kind: ScanKind): void {
  void scanSessions.cancel(kind).catch(error => page.toast(error.message || 'Could not cancel scan', 'error'))
}

declare global {
  interface Window {
    streamMeasurements: typeof streamMeasurements
    scanSessions: ScanSessions
    attachScanPage: typeof attachScanPage
    startScanPage: typeof startScanPage
    cancelScanPage: typeof cancelScanPage
  }
}
window.streamMeasurements = streamMeasurements
window.scanSessions = scanSessions
window.attachScanPage = attachScanPage
window.startScanPage = startScanPage
window.cancelScanPage = cancelScanPage
export {}
