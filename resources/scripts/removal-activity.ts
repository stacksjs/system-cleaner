type RemovalState = 'running' | 'complete' | 'partial' | 'failed'

interface RemovalOptions {
  title: string
  finished: string
  target: string
  verb?: string
  trash?: boolean
  total?: number
}

interface RemovalResult {
  success?: boolean
  succeeded?: unknown[]
  removed?: unknown[] | number
  cleaned?: unknown[]
  shredded?: unknown[]
  targets?: number
  skipped?: unknown[]
  failed?: unknown[]
  errors?: unknown[]
  error?: string
  freedBytes?: number
  freedFormatted?: string
  measured?: boolean
  heldOpen?: boolean
  keptCookies?: number
  historyError?: string
}

interface RemovalEntry extends RemovalOptions {
  id: number
  state: RemovalState
  detail: string
  issues: string[]
  done: number
}

const activityChanged = new EventTarget()
let entries: RemovalEntry[] = []
let nextId = 0

function publish(entry: RemovalEntry) {
  entries = [entry, ...entries.filter(previous => previous.id !== entry.id
    && (entry.state !== 'complete' || previous.state !== 'complete'))]
  activityChanged.dispatchEvent(new Event('change'))
}

function issueText(detail: unknown): string {
  if (typeof detail === 'string') return detail
  if (!detail || typeof detail !== 'object') return ''
  const { path, error, reason } = detail as { path?: string, error?: string, reason?: string }
  const message = error || reason || ''
  return path && message ? `${path} · ${message}` : message
}

function formatSize(bytes: number) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const unit = Math.max(0, Math.min(Math.floor(Math.log10(bytes) / 3), units.length - 1))
  const size = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(bytes / 1000 ** unit)
  return `${size} ${units[unit]}`
}

function summarize(result: RemovalResult, entry: RemovalEntry) {
  const reportedCount = result.succeeded ?? result.removed ?? result.cleaned ?? result.shredded ?? result.targets
  const count = Array.isArray(reportedCount) ? reportedCount.length : reportedCount
  const skipped = result.skipped || []
  const failed = [...(result.failed || []), ...(result.errors || [])]
  const isIncomplete = result.success === false || skipped.length > 0 || failed.length > 0 || Boolean(result.error || result.historyError)
  const madeChanges = (count ?? 0) > 0 || (result.freedBytes ?? 0) > 0 || result.measured === false
  const changedLabel = entry.verb || (entry.trash ? 'moved' : 'removed')
  const detail: string[] = []
  if (count !== undefined) detail.push(`${count} ${changedLabel}`)
  if (skipped.length) detail.push(`${skipped.length} skipped`)
  if (failed.length) detail.push(`${failed.length} failed`)
  if (result.keptCookies) detail.push(result.keptCookies + (result.keptCookies === 1 ? ' cookie kept' : ' cookies kept'))
  if (entry.trash && madeChanges) detail.push('Space is reclaimed when you empty the Trash.')
  else if (result.heldOpen) detail.push('Space will be reclaimed when apps close the files.')
  else if (result.freedBytes && result.measured !== false) detail.push((result.freedFormatted || formatSize(result.freedBytes)) + ' freed')

  return {
    state: isIncomplete ? (madeChanges || result.historyError || (skipped.length > 0 && !failed.length && !result.error) ? 'partial' : 'failed') : 'complete',
    detail: detail.join(' · ') || result.error || entry.target,
    issues: [...new Set([result.error, result.historyError, ...failed.map(issueText), ...skipped.map(issueText)].filter((issue): issue is string => Boolean(issue)))],
  } satisfies Pick<RemovalEntry, 'state' | 'detail' | 'issues'>
}

async function trackRemoval<T extends RemovalResult>(options: RemovalOptions, run: (advance: (done: number) => void) => Promise<T>): Promise<T> {
  const entry: RemovalEntry = { ...options, id: ++nextId, state: 'running', detail: options.target, issues: [], done: 0 }
  publish(entry)
  try {
    const result = await run(done => publish({ ...entry, done }))
    publish({ ...entry, ...summarize(result, entry) })
    return result
  }
  catch (error) {
    publish({
      ...entry,
      state: 'failed',
      detail: 'Couldn’t confirm the result. Refresh the list before trying again.',
      issues: error instanceof Error && error.message ? [error.message] : [],
    })
    throw error
  }
}

function removalActivityPanel() {
  let refresh: () => void
  let lastAnnouncement = ''
  return {
    entries,
    announcement: '',
    init() {
      refresh = () => {
        this.entries = entries
        const latest = entries[0]
        if (!latest) return
        const key = `${latest.id}:${latest.state}`
        if (key === lastAnnouncement) return
        lastAnnouncement = key
        this.announcement = [this.headline(latest), this.description(latest)].join(' ')
      }
      refresh()
      activityChanged.addEventListener('change', refresh)
    },
    stop() { activityChanged.removeEventListener('change', refresh) },
    dismiss(id: number) {
      entries = entries.filter(entry => entry.id !== id || entry.state === 'running')
      activityChanged.dispatchEvent(new Event('change'))
    },
    headline(entry: RemovalEntry) {
      if (entry.state === 'running') return entry.title
      if (entry.state === 'complete') return entry.finished
      return entry.state === 'partial' ? 'Some items need attention' : 'Removal couldn’t finish'
    },
    description(entry: RemovalEntry) {
      const needsAttention = entry.state === 'partial' || entry.state === 'failed'
      return needsAttention && entry.detail !== entry.target ? `${entry.target} · ${entry.detail}` : entry.detail
    },
  }
}

Object.assign(window, { removalActivityPanel, trackRemoval })
