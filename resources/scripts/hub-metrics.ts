/**
 * Live figures and panels on the section pages, the overview and the sidebar.
 *
 * The pages are prerendered, so nothing machine-specific can be written into
 * them at build time (see AGENTS.md). Two kinds of hook ask for live data:
 *
 * - `data-metric="<name>"`: one figure. `data-metric-template` holds the
 *   sentence it goes into; until it arrives the element keeps the text it was
 *   rendered with, which always reads on its own. `data-metric-fallback` is
 *   written instead when the figure cannot be had. `data-metric-style="--x"`
 *   sets a custom property instead of text, for bars.
 * - `data-panel="<id>"`: a whole panel, drawn by `PANELS` below into its
 *   `[data-panel-body]`.
 *
 * Every endpoint is fetched at most once a minute and shared by everything
 * that needs it, so moving between pages does not re-run a disk walk. Text
 * from the agent (process names, extension names) is only ever written with
 * `textContent`, never as markup.
 */

// eslint-disable-next-line ts/no-explicit-any
type Json = Record<string, any>

const TTL_MS = 60_000
const cache = new Map<string, { at: number, data: Promise<Json | null> }>()

function api(path: string): Promise<Json | null> {
  const hit = cache.get(path)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data
  const data = fetch(`/api/${path}`, { method: 'POST', cache: 'no-store' })
    .then(response => (response.ok ? response.json() as Promise<Json> : null))
    .catch(() => null)
  const entry = { at: Date.now(), data }
  cache.set(path, entry)
  // A failure is not an answer. The agent is briefly busy during a long walk,
  // and remembering that for a minute would keep "Not available" on screen
  // long after it could have answered; the next fill asks again.
  void data.then((result) => {
    if (result === null && cache.get(path) === entry) cache.delete(path)
  })
  return data
}

/**
 * Requests that delete something. The agent drops its own totals when one of
 * these runs, but this page keeps a copy for a minute, which is how a Quick
 * Clean could finish and the overview go on showing the junk it had just
 * removed. Every screen's own requests go through `fetch`, so watching it here
 * catches all of them, including tools added later, without each page having
 * to announce what it did.
 */
const CHANGES_DISK = /^\/api\/(?:clean(?!up-(?:targets|history))[\w-]*|empty-trash|bulk-delete|delete-[\w-]+|remove-[\w-]+|shred-paths|privacy-clean|app-uninstall)(?:\?|$)/

function forgetAfterChanges(): void {
  const original = window.fetch.bind(window)
  const watched = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const result = original(input, init)
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const pathname = new URL(url, location.href).pathname
    if (method === 'POST' && CHANGES_DISK.test(pathname)) {
      void result.then((response) => {
        if (!response.ok) return
        cache.clear()
        // The sidebar's disk meter is on screen now; the rest refresh as
        // their pages open.
        fillMetrics()
      }, () => {})
    }
    return result
  }
  window.fetch = watched as typeof fetch
}
forgetAfterChanges()

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1000)))
  const value = bytes / 1000 ** exponent
  return `${value >= 100 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`
}

function plural(count: number, one: string, many: string = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}

function shortDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// ── Motion ───────────────────────────────────────────────────────────

const calm = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches
const EASE = 'cubic-bezier(.2, .8, .2, 1)'

/** New text slides up into place instead of snapping. */
function settleIn(element: HTMLElement, delay = 0): void {
  if (calm() || typeof element.animate !== 'function') return
  element.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 320, delay, easing: EASE, fill: 'backwards' })
}

/**
 * Count a figure up from zero: "24.3 GB" runs 0.0, 6.1, 17.9 ... 24.3 over
 * most of a second, keeping the decimals and the unit it arrived with. Text
 * with no number in it just settles in.
 */
function countUp(element: HTMLElement, text: string): void {
  const match = text.match(/\d+(?:\.\d+)?/)
  if (calm() || !match) {
    element.textContent = text
    settleIn(element)
    return
  }
  const target = Number(match[0])
  const decimals = (match[0].split('.')[1] || '').length
  const start = performance.now()
  const duration = 750
  const frame = (now: number): void => {
    const progress = Math.min(1, (now - start) / duration)
    const eased = 1 - (1 - progress) ** 3
    element.textContent = text.replace(match[0], (target * eased).toFixed(decimals))
    if (progress < 1 && element.isConnected) requestAnimationFrame(frame)
    else element.textContent = text
  }
  requestAnimationFrame(frame)
}

// ── Figures ──────────────────────────────────────────────────────────

type Values = Record<string, string>

interface Source {
  path: string
  provides: string[]
  derive: (data: Json) => Values
}

const SOURCES: Source[] = [
  {
    path: 'dashboard-stats',
    provides: ['disk-free', 'disk-used', 'disk-pct', 'startup', 'memory', 'health', 'health-label', 'extensions', 'cpu', 'chip', 'uptime', 'macos'],
    derive(d) {
      if (!d.success) return {}
      const values: Values = {}
      if (d.diskAvail && d.diskAvail !== '-') values['disk-free'] = d.diskAvail
      if (typeof d.dUsedPct === 'number') {
        values['disk-used'] = `${Math.round(d.dUsedPct)}% used`
        values['disk-pct'] = `${Math.round(d.dUsedPct)}%`
      }
      if (typeof d.enabledStartup === 'number') values.startup = plural(d.enabledStartup, 'item')
      if (typeof d.memPercent === 'number') values.memory = `${d.memPercent}% memory in use`
      if (typeof d.cpuAvgPercent === 'number') values.cpu = `${Math.round(d.cpuAvgPercent)}%`
      if (typeof d.healthScore === 'number') {
        values.health = String(d.healthScore)
        values['health-label'] = d.healthScore >= 80 ? 'Good' : d.healthScore >= 60 ? 'Fair' : 'Needs attention'
      }
      if (typeof d.extensions === 'number') values.extensions = d.extensions === 0 ? 'None' : plural(d.extensions, 'extension')
      if (d.cpuLabel) values.chip = `${d.cpuLabel} · ${d.cpuCores} cores`
      if (d.uptimeStr) values.uptime = d.uptimeStr
      if (d.macosVersion) values.macos = `macOS ${d.macosVersion}`
      return values
    },
  },
  {
    path: 'safe-to-clean',
    provides: ['junk'],
    // `needsHome`: the App Store edition before the home folder is granted.
    derive: (d): Values => (d.success && typeof d.bytes === 'number' ? { junk: formatBytes(d.bytes) } : d.needsHome ? { junk: 'Needs access' } : {}),
  },
  {
    path: 'updates-summary',
    provides: ['updates'],
    // Zero means up to date only once every source has been asked. The check
    // the app runs on its own stays off the network, so until someone opens
    // Updates it has not asked about app or Pantry updates and says so.
    derive: (d): Values => (d.success && typeof d.total === 'number'
      ? { updates: d.total > 0 ? plural(d.total, 'update') : (d.complete === false ? 'Not checked yet' : 'Up to date') }
      : {}),
  },
  {
    path: 'permissions',
    provides: ['permissions'],
    derive: (d): Values => (d.success && Array.isArray(d.apps) ? { permissions: plural(d.apps.length, 'app') } : {}),
  },
  {
    path: 'privacy-scan',
    provides: ['privacy'],
    derive: (d): Values => (d.success && typeof d.totalBytes === 'number' ? { privacy: formatBytes(d.totalBytes) } : d.needsHome ? { privacy: 'Needs access' } : {}),
  },
]

/**
 * Some sentences read wrong around particular values: "Up to date waiting to
 * install". A template can name values it should not be used for, and the
 * bare value is written instead.
 */
function render(element: HTMLElement, value: string): void {
  const style = element.getAttribute('data-metric-style')
  if (style) {
    element.style.setProperty(style, value)
    element.setAttribute('data-metric-ready', '')
    return
  }
  const template = element.getAttribute('data-metric-template')
  const bare = (element.getAttribute('data-metric-bare') || '').split('|')
  const clear = element.getAttribute('data-metric-clear')
  // The first bare value is the all-clear and takes the clear text ("Every
  // app is up to date"); any other bare value stands as written.
  const next = value === bare[0] ? (clear || value) : bare.includes(value) ? value : (template ? template.replace('{value}', value) : value)
  const changed = element.textContent !== next
  // Only the first arrival animates. A minute later the same figure comes
  // back from the cache, and counting up again would be noise.
  if (changed && element.hasAttribute('data-metric-count') && !element.hasAttribute('data-metric-ready'))
    countUp(element, next)
  else if (changed && !element.hasAttribute('data-metric-ready')) {
    element.textContent = next
    settleIn(element)
  }
  else
    element.textContent = next
  element.setAttribute('data-metric-ready', '')
  // The overview's health ring reads its score from here.
  const ring = element.closest<HTMLElement>('[data-health-ring]')
  if (ring && element.getAttribute('data-metric') === 'health')
    ring.style.setProperty('--score', value)
}

function fillMetrics(): void {
  const elements = Array.from(document.querySelectorAll<HTMLElement>('[data-metric]'))
  for (const source of SOURCES) {
    const wanted = elements.filter(element => source.provides.includes(element.getAttribute('data-metric') || ''))
    if (wanted.length === 0) continue
    void api(source.path).then((data) => {
      const values = data ? source.derive(data) : {}
      for (const element of wanted) {
        if (!element.isConnected) continue
        const value = values[element.getAttribute('data-metric') || '']
        if (value) {
          render(element, value)
        }
        else if (element.hasAttribute('data-metric-fallback')) {
          // A figure that cannot be had (no Full Disk Access, say) stops
          // looking like it is still on its way.
          element.textContent = element.getAttribute('data-metric-fallback')
          element.setAttribute('data-metric-ready', '')
        }
      }
    })
  }
}

// ── Panels ───────────────────────────────────────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function glyph(className: string): HTMLElement {
  const node = el('span', className)
  node.setAttribute('aria-hidden', 'true')
  return node
}

interface RowOptions {
  icon?: string
  title: string
  sub?: string
  value?: string
  href?: string
  /** 0–100, drawn as a thin bar under the title. */
  bar?: number
}

function row(options: RowOptions): HTMLElement {
  const node = options.href ? el('a', 'hub-row hub-row-link') : el('div', 'hub-row')
  if (options.href && node instanceof HTMLAnchorElement) {
    node.href = options.href
    node.setAttribute('data-stx-link', '')
  }
  if (options.icon) {
    const tile = el('span', 'hub-row-icon')
    tile.append(glyph(options.icon))
    node.append(tile)
  }
  const main = el('span', 'hub-row-main')
  main.append(el('span', 'hub-row-title', options.title))
  if (options.sub) main.append(el('span', 'hub-row-sub', options.sub))
  if (typeof options.bar === 'number') {
    const track = el('span', 'hub-row-bar')
    const fill = el('span')
    fill.style.width = `${Math.max(2, Math.min(100, options.bar))}%`
    track.append(fill)
    main.append(track)
  }
  node.append(main)
  if (options.value) node.append(el('span', 'hub-row-value', options.value))
  if (options.href) node.append(glyph('i-f7-chevron-right hub-row-chevron'))
  return node
}

interface EmptyState {
  icon: string
  title: string
  body?: string
  /** `clear` is good news and wears the section colour; `error` offers a retry. */
  kind?: 'clear' | 'info' | 'error'
  action?: { label: string, href: string }
}

function empty(state: EmptyState): HTMLElement {
  const node = el('div', 'hub-empty')
  const mark = el('span', 'hub-empty-mark')
  mark.dataset.kind = state.kind || 'info'
  mark.append(glyph(state.icon))
  node.append(mark, el('strong', 'hub-empty-title', state.title))
  if (state.body) node.append(el('p', 'hub-empty-body', state.body))
  if (state.action) {
    const link = el('a', 'hub-panel-button', state.action.label)
    link.href = state.action.href
    link.setAttribute('data-stx-link', '')
    node.append(link)
  }
  else if (state.kind === 'error') {
    const retry = el('button', 'hub-panel-button', 'Try again')
    retry.type = 'button'
    retry.setAttribute('data-panel-retry', '')
    node.append(retry)
  }
  return node
}

/** A panel that could not be read: the agent was busy or a source failed. */
function failed(title: string, body = 'It may still be busy with a long scan.'): HTMLElement {
  return empty({ icon: 'i-f7-exclamationmark-triangle-fill', kind: 'error', title, body })
}

function stat(label: string, value: string): HTMLElement {
  const node = el('div', 'hub-stat')
  node.append(el('span', 'hub-stat-value', value), el('span', 'hub-stat-label', label))
  return node
}

function gauge(label: string, percent: number, caption: string): HTMLElement {
  const node = el('div', 'hub-gauge')
  node.style.setProperty('--score', String(Math.round(percent)))
  const ring = el('span', 'hub-gauge-ring')
  ring.append(el('span', 'hub-gauge-value', caption))
  node.append(ring, el('span', 'hub-gauge-label', label))
  return node
}

const SOURCE_LABELS: Record<string, { label: string, icon: string }> = {
  'quick-clean': { label: 'Quick Clean', icon: 'i-f7-sparkles' },
  'cleanup': { label: 'Quick Clean', icon: 'i-f7-sparkles' },
  'schedule': { label: 'Scheduled clean', icon: 'i-f7-clock-fill' },
  'developer': { label: 'Developer Junk', icon: 'i-f7-chevron-left-slash-chevron-right' },
  'large-files': { label: 'Large Files', icon: 'i-f7-doc-on-doc-fill' },
  'duplicates': { label: 'Duplicates', icon: 'i-f7-square-on-square' },
  'similar': { label: 'Similar Images', icon: 'i-f7-photo-on-rectangle' },
  'orphans': { label: 'Leftover Data', icon: 'i-f7-tray-fill' },
  'extensions': { label: 'Extensions', icon: 'i-f7-square-stack-3d-up-fill' },
  'privacy': { label: 'Privacy', icon: 'i-f7-eye-slash-fill' },
  'apps': { label: 'Installed Apps', icon: 'i-f7-xmark-square-fill' },
  'ai-worktrees': { label: 'AI Worktrees', icon: 'i-f7-folder-fill' },
  'disk': { label: 'Disk Usage', icon: 'i-f7-chart-pie-fill' },
  'trash': { label: 'Trash', icon: 'i-f7-trash-fill' },
}

interface PanelResult {
  body: HTMLElement[]
  aside?: string
}

const PANELS: Record<string, () => Promise<PanelResult>> = {
  async 'cleanup-history'() {
    const d = await api('cleanup-history')
    if (!d?.success) return { body: [failed('History could not be read')] }
    const runs = ((d.runs as Json[]) || []).filter(run => run.itemCount > 0).slice(0, 4)
    return {
      aside: d.runCount ? `${d.lifetimeFreedFormatted} reclaimed so far` : undefined,
      body: runs.length === 0
        ? [empty({ icon: 'i-f7-clock-fill', title: 'Nothing cleaned yet', body: 'Each clean you run is listed here with the space it gave back. The round button above starts the first.' })]
        : runs.map((run) => {
            const known = SOURCE_LABELS[run.source] || { label: String(run.source), icon: 'i-f7-sparkles' }
            // A run that moved files to the Trash has freed nothing yet; the
            // space comes back when the Trash is emptied, so say where it went.
            const trashed = run.mode === 'trash'
            return row({
              icon: known.icon,
              title: known.label,
              sub: `${shortDate(run.createdAt)} · ${plural(run.itemCount, 'item')}${trashed ? ' moved to Trash' : ''}`,
              value: trashed && !run.freedBytes ? 'In Trash' : run.freedFormatted,
            })
          }),
    }
  },

  async 'schedule'() {
    const d = await api('schedule')
    if (!d?.success) return { body: [failed('The schedule could not be read')] }
    const on = !!d.spec?.enabled && !!d.installed
    const status = el('div', 'hub-status')
    status.append(
      el('span', on ? 'hub-pill hub-pill-on' : 'hub-pill', on ? 'On' : 'Off'),
      el('span', 'hub-status-text', on ? d.description : 'The safe clean runs only when you start it.'),
    )
    const rows: HTMLElement[] = [status]
    if (d.lastRunAt)
      rows.push(row({ icon: 'i-f7-clock-fill', title: 'Last run', sub: d.lastFreedBytes ? `Freed ${d.lastFreedFormatted}` : 'Nothing needed cleaning', value: shortDate(d.lastRunAt) }))
    if (!on)
      rows.push(row({ icon: 'i-f7-calendar', title: 'Set one up', sub: 'Pick a day and an hour; it runs while you sleep.', href: '/app/schedule' }))
    return { body: rows }
  },

  async 'disk'() {
    const d = await api('dashboard-stats')
    if (!d?.success || !d.diskTotal || d.diskTotal === '-') return { body: [failed('The disk could not be read')] }
    const meter = el('div', 'hub-meter')
    const fill = el('span', 'hub-meter-fill')
    fill.style.width = `${Math.max(2, Math.min(100, d.dUsedPct))}%`
    meter.append(fill)
    const stats = el('div', 'hub-stats')
    stats.append(stat('Used', d.diskUsed), stat('Free', d.diskAvail), stat('Capacity', d.diskTotal))
    return { aside: `${Math.round(d.dUsedPct)}% full`, body: [meter, stats] }
  },

  async 'quick-wins'() {
    // The rows are known up front; only their sizes take time, and the junk
    // total is a disk walk that can run for half a minute. So the rows draw
    // at once and each size lands in place when its own measurement does.
    const junk = row({ icon: 'i-f7-sparkles', title: 'Caches and logs', sub: 'Safe to remove; apps rebuild them', value: '…', href: '/app/cleanup' })
    const traces = row({ icon: 'i-f7-eye-slash-fill', title: 'Browsing traces', sub: 'History, cookies and browser caches', value: '…', href: '/app/privacy' })
    const leftovers = row({ icon: 'i-f7-tray-fill', title: 'Leftover app data', sub: 'Support files from apps you removed', href: '/app/orphans' })
    const settle = (node: HTMLElement, text: string): void => {
      const value = node.querySelector<HTMLElement>('.hub-row-value')
      if (!value) return
      value.textContent = text
      settleIn(value)
    }
    void api('safe-to-clean').then(d => settle(junk, d?.success ? formatBytes(d.bytes) : '-'))
    void api('privacy-scan').then(d => settle(traces, d?.success ? formatBytes(d.totalBytes) : '-'))
    return { body: [junk, traces, leftovers] }
  },

  async 'gauges'() {
    const d = await api('dashboard-stats')
    if (!d?.success) return { body: [failed('Live figures are not available')] }
    const gauges = el('div', 'hub-gauges')
    gauges.append(
      gauge('CPU', d.cpuAvgPercent, `${Math.round(d.cpuAvgPercent)}%`),
      gauge('Memory', d.memPercent, `${d.memPercent}%`),
      gauge('Health', d.healthScore, String(d.healthScore)),
    )
    const stats = el('div', 'hub-stats')
    stats.append(stat('Uptime', d.uptimeStr), stat('At login', `${d.enabledStartup} of ${d.totalStartup}`), stat('Memory', `${d.usedMemGB} / ${d.totalMemGB} GB`))
    return { body: [gauges, stats] }
  },

  async 'processes'() {
    const d = await api('dashboard-stats')
    if (!d?.success) return { body: [failed('Process figures are not available')] }
    const processes = (d.processes as Json[] | undefined) || []
    if (processes.length === 0) return { body: [empty({ icon: 'i-f7-chart-bar-alt-fill', title: 'Nothing busy right now', body: 'No process is using a noticeable share of the CPU or memory.' })] }
    return {
      body: processes.slice(0, 4).map(proc => row({
        title: proc.name,
        sub: `${proc.user} · ${proc.memMB} MB`,
        value: `${Number(proc.cpu).toFixed(1)}%`,
        bar: Number(proc.cpu),
      })),
    }
  },

  async 'updates-breakdown'() {
    const d = await api('updates-summary')
    if (!d?.success) return { body: [empty({ icon: 'i-f7-arrow-down-circle-fill', title: 'Not checked yet', body: 'One check covers macOS, your apps, Homebrew and Pantry.', action: { label: 'Check for updates', href: '/app/updates' } })] }
    // Apps and Pantry are asked only by a check someone starts (they reach the
    // App Store and Pantry's registry), so until then they say so instead of
    // claiming to be up to date.
    const sources = [
      { title: 'macOS', icon: 'i-f7-desktopcomputer', count: d.macosCount || d.systemCount || 0, checked: true },
      { title: 'Apps', icon: 'i-f7-app-fill', count: d.desktopCount || 0, checked: d.desktopChecked !== false },
      { title: 'Homebrew', icon: 'i-f7-cube-box-fill', count: d.brewCount || 0, checked: true },
      { title: 'Pantry', icon: 'i-f7-cube-fill', count: d.pantryCount || 0, checked: d.pantryChecked !== false },
      { title: 'Command Line Tools', icon: 'i-f7-chevron-left-slash-chevron-right', count: d.clToolsCount || 0, checked: true },
    ]
    const complete = d.complete !== false
    return {
      aside: d.total ? plural(d.total, 'update') : (complete ? 'Everything is up to date' : 'Open Updates to check the rest'),
      body: sources.map(source => row({ icon: source.icon, title: source.title, value: source.count ? String(source.count) : (source.checked ? 'Up to date' : 'Not checked') })),
    }
  },

  async 'extensions'() {
    const d = await api('extensions-list')
    if (!d?.success) return { body: [failed('Extensions could not be listed')] }
    const list = (d.extensions as Json[] | undefined) || []
    if (list.length === 0) return { body: [empty({ icon: 'i-f7-checkmark-shield-fill', kind: 'clear', title: 'No extensions installed', body: 'None of your browsers has an extension, so there is nothing to review.' })] }
    return {
      aside: plural(list.length, 'extension'),
      body: list.slice(0, 4).map(extension => row({
        icon: extension.browserIcon || 'i-f7-globe',
        title: extension.name,
        sub: `${extension.browser}${extension.hostPermissions ? ` · reads ${plural(extension.hostPermissions, 'site')}` : ''}`,
      })),
    }
  },

  async 'traces'() {
    const d = await api('privacy-scan')
    if (!d?.success) return { body: [failed('Browsers could not be read')] }
    const items = ((d.items as Json[] | undefined) || []).filter(item => item.sizeBytes > 0)
      .sort((a, b) => b.sizeBytes - a.sizeBytes)
    if (items.length === 0) return { body: [empty({ icon: 'i-f7-checkmark-shield-fill', kind: 'clear', title: 'No browsing traces', body: 'Your browsers have no history, cookies or caches worth clearing.' })] }
    return {
      aside: `${formatBytes(d.totalBytes)} in all`,
      body: items.slice(0, 4).map(item => row({ icon: item.browserIcon || 'i-f7-globe', title: `${item.browser} · ${item.label}`, sub: item.profile, value: item.sizeFormatted })),
    }
  },

  async 'access'() {
    const d = await api('permissions')
    if (!d) return { body: [failed('Permissions could not be read')] }
    if (!d.success) {
      const note = el('p', 'hub-panel-note', d.reason || 'Reading what apps were granted needs Full Disk Access.')
      const button = el('button', 'hub-panel-button', 'Open Privacy & Security')
      button.type = 'button'
      button.addEventListener('click', () => { void fetch('/api/open-privacy-settings', { method: 'POST' }) })
      return { body: [note, button] }
    }
    const apps = d.apps as Json[]
    const grants = apps.reduce((sum, app) => sum + (app.grants?.length || 0), 0)
    const stats = el('div', 'hub-stats')
    stats.append(stat('Apps', String(apps.length)), stat('Grants', String(grants)), stat('App gone', String(d.missing || 0)))
    const body: HTMLElement[] = [stats]
    if (d.missing)
      body.push(row({ icon: 'i-f7-exclamationmark-triangle-fill', title: `${plural(d.missing, 'grant')} outlived their app`, sub: 'Access still on record for software that is gone', href: '/app/permissions' }))
    return { body }
  },
}

/**
 * A panel's content arrives as a cascade rather than all at once, and its
 * bars and gauges grow from nothing to their value. Transform and opacity
 * only, so a panel of rows costs the compositor, not the layout.
 */
function reveal(body: HTMLElement): void {
  if (calm()) return
  Array.from(body.children).forEach((child, index) => settleIn(child as HTMLElement, index * 45))
  for (const bar of Array.from(body.querySelectorAll<HTMLElement>('.hub-row-bar > span, .hub-meter-fill')))
    bar.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 800, delay: 120, easing: EASE, fill: 'backwards' })
  for (const gauge of Array.from(body.querySelectorAll<HTMLElement>('.hub-gauge'))) {
    const score = gauge.style.getPropertyValue('--score')
    try {
      gauge.animate([{ '--score': '0' }, { '--score': score }] as Keyframe[], { duration: 900, delay: 120, easing: EASE, fill: 'backwards' })
    }
    catch { /* An engine that cannot animate a registered property shows the value at once. */ }
  }
}

/**
 * Keep a panel's rows inside the panel. A section page opens with nothing
 * below the fold, so on a short window the panels are the band that gives
 * way: each drops whole rows from the bottom, never half of one, and shows
 * them again as the window grows. The first item always stays.
 */
function fitRows(body: HTMLElement): void {
  const items = Array.from(body.children).filter((child): child is HTMLElement => child.matches('.hub-row, .hub-stats'))
  for (const item of items) item.hidden = false
  for (let index = items.length - 1; index > 0 && body.scrollHeight > body.clientHeight + 1; index--)
    items[index].hidden = true
}

function fitAllRows(): void {
  for (const body of Array.from(document.querySelectorAll<HTMLElement>('[data-panel-filled] [data-panel-body]')))
    fitRows(body)
}

let fitQueued = false
const scrollArea = document.querySelector('.main')
if (scrollArea && typeof ResizeObserver === 'function') {
  new ResizeObserver(() => {
    if (fitQueued) return
    fitQueued = true
    requestAnimationFrame(() => {
      fitQueued = false
      fitAllRows()
    })
  }).observe(scrollArea)
}

function fillPanels(): void {
  for (const panel of Array.from(document.querySelectorAll<HTMLElement>('[data-panel]'))) {
    if (panel.hasAttribute('data-panel-filled')) continue
    panel.setAttribute('data-panel-filled', '')
    const draw = PANELS[panel.getAttribute('data-panel') || '']
    const body = panel.querySelector<HTMLElement>('[data-panel-body]')
    if (!draw || !body) continue
    void draw()
      .catch((): PanelResult => ({ body: [failed('This could not be loaded')] }))
      .then((result) => {
        if (!panel.isConnected) return
        body.replaceChildren(...result.body)
        body.removeAttribute('aria-busy')
        fitRows(body)
        reveal(body)
        const aside = panel.querySelector<HTMLElement>('[data-panel-aside]')
        if (aside) aside.textContent = result.aside || ''
      })
  }
}

// ── Wiring ───────────────────────────────────────────────────────────

function fill(): void {
  fillMetrics()
  fillPanels()
}

fill()

// The router swaps `[data-stx-content]` in place, and its navigate event can
// land before the new page is in the DOM, so the swap itself is the signal.
let queued = false
const content = document.querySelector('[data-stx-content]')
if (content) {
  new MutationObserver(() => {
    if (queued) return
    queued = true
    requestAnimationFrame(() => {
      queued = false
      fill()
    })
  }).observe(content, { childList: true })
}

// A failed panel's "Try again": put the placeholder back and draw it anew.
// Failures are never cached, so the retry really asks the agent again.
document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target.closest('[data-panel-retry]') : null
  const panel = target?.closest<HTMLElement>('[data-panel]')
  const body = panel?.querySelector<HTMLElement>('[data-panel-body]')
  if (!panel || !body) return
  panel.removeAttribute('data-panel-filled')
  body.setAttribute('aria-busy', 'true')
  body.replaceChildren(el('span', 'hub-skeleton'), el('span', 'hub-skeleton'), el('span', 'hub-skeleton'))
  fillPanels()
})

// The sidebar's disk meter outlives every navigation; keep it current, but
// only while the window can be seen. A hidden window should cost nothing.
setInterval(() => {
  if (!document.hidden) fillMetrics()
}, TTL_MS)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) fillMetrics()
})
