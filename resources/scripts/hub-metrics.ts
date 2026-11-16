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
  cache.set(path, { at: Date.now(), data })
  return data
}

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
      if (typeof d.extensions === 'number') values.extensions = plural(d.extensions, 'extension')
      if (d.cpuLabel) values.chip = `${d.cpuLabel} · ${d.cpuCores} cores`
      if (d.uptimeStr) values.uptime = d.uptimeStr
      if (d.macosVersion) values.macos = `macOS ${d.macosVersion}`
      return values
    },
  },
  {
    path: 'safe-to-clean',
    provides: ['junk'],
    derive: (d): Values => (d.success && typeof d.bytes === 'number' ? { junk: formatBytes(d.bytes) } : {}),
  },
  {
    path: 'updates-summary',
    provides: ['updates'],
    derive: (d): Values => (d.success && typeof d.total === 'number'
      ? { updates: d.total === 0 ? 'Up to date' : plural(d.total, 'update') }
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
    derive: (d): Values => (d.success && typeof d.totalBytes === 'number' ? { privacy: formatBytes(d.totalBytes) } : {}),
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
  element.textContent = template && !bare.includes(value) ? template.replace('{value}', value) : value
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

function empty(text: string): HTMLElement {
  return el('p', 'hub-panel-empty', text)
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
  'apps': { label: 'Uninstaller', icon: 'i-f7-xmark-square-fill' },
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
    if (!d?.success) return { body: [empty('Cleanup history is not available right now.')] }
    const runs = ((d.runs as Json[]) || []).filter(run => run.itemCount > 0).slice(0, 4)
    return {
      aside: d.runCount ? `${d.lifetimeFreedFormatted} reclaimed so far` : undefined,
      body: runs.length === 0
        ? [empty('Nothing cleaned yet. Quick Clean is the place to start.')]
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
    if (!d?.success) return { body: [empty('The schedule could not be read.')] }
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
    if (!d?.success || !d.diskTotal || d.diskTotal === '-') return { body: [empty('The disk could not be read.')] }
    const meter = el('div', 'hub-meter')
    const fill = el('span', 'hub-meter-fill')
    fill.style.width = `${Math.max(2, Math.min(100, d.dUsedPct))}%`
    meter.append(fill)
    const stats = el('div', 'hub-stats')
    stats.append(stat('Used', d.diskUsed), stat('Free', d.diskAvail), stat('Capacity', d.diskTotal))
    return { aside: `${Math.round(d.dUsedPct)}% full`, body: [meter, stats] }
  },

  async 'quick-wins'() {
    const [junk, privacy] = await Promise.all([api('safe-to-clean'), api('privacy-scan')])
    return {
      body: [
        row({ icon: 'i-f7-sparkles', title: 'Caches and logs', sub: 'Safe to remove; apps rebuild them', value: junk?.success ? formatBytes(junk.bytes) : undefined, href: '/app/cleanup' }),
        row({ icon: 'i-f7-eye-slash-fill', title: 'Browsing traces', sub: 'History, cookies and browser caches', value: privacy?.success ? formatBytes(privacy.totalBytes) : undefined, href: '/app/privacy' }),
        row({ icon: 'i-f7-tray-fill', title: 'Leftover app data', sub: 'Support files from apps you removed', href: '/app/orphans' }),
      ],
    }
  },

  async 'gauges'() {
    const d = await api('dashboard-stats')
    if (!d?.success) return { body: [empty('Live figures are not available right now.')] }
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
    const processes = (d?.processes as Json[] | undefined) || []
    if (processes.length === 0) return { body: [empty('No process figures yet.')] }
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
    if (!d?.success) return { body: [empty('Updates have not been checked yet.')] }
    const sources = [
      { title: 'macOS', icon: 'i-f7-desktopcomputer', count: d.macosCount || d.systemCount || 0 },
      { title: 'Apps', icon: 'i-f7-app-fill', count: d.desktopCount || 0 },
      { title: 'Homebrew', icon: 'i-f7-cube-box-fill', count: d.brewCount || 0 },
      { title: 'Pantry', icon: 'i-f7-cube-fill', count: d.pantryCount || 0 },
      { title: 'Command Line Tools', icon: 'i-f7-chevron-left-slash-chevron-right', count: d.clToolsCount || 0 },
    ]
    return {
      aside: d.total ? plural(d.total, 'update') : 'Everything is up to date',
      body: sources.map(source => row({ icon: source.icon, title: source.title, value: source.count ? String(source.count) : 'Up to date' })),
    }
  },

  async 'extensions'() {
    const d = await api('extensions-list')
    if (!d?.success) return { body: [empty('Extensions could not be listed.')] }
    const list = (d.extensions as Json[] | undefined) || []
    if (list.length === 0) return { body: [empty('No browser extensions are installed. Nothing to review here.')] }
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
    if (!d?.success) return { body: [empty('Browsers could not be read.')] }
    const items = ((d.items as Json[] | undefined) || []).filter(item => item.sizeBytes > 0)
      .sort((a, b) => b.sizeBytes - a.sizeBytes)
    if (items.length === 0) return { body: [empty('No browsing traces found.')] }
    return {
      aside: `${formatBytes(d.totalBytes)} in all`,
      body: items.slice(0, 4).map(item => row({ icon: item.browserIcon || 'i-f7-globe', title: `${item.browser} · ${item.label}`, sub: item.profile, value: item.sizeFormatted })),
    }
  },

  async 'access'() {
    const d = await api('permissions')
    if (!d) return { body: [empty('Permissions could not be read.')] }
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

function fillPanels(): void {
  for (const panel of Array.from(document.querySelectorAll<HTMLElement>('[data-panel]'))) {
    if (panel.hasAttribute('data-panel-filled')) continue
    panel.setAttribute('data-panel-filled', '')
    const draw = PANELS[panel.getAttribute('data-panel') || '']
    const body = panel.querySelector<HTMLElement>('[data-panel-body]')
    if (!draw || !body) continue
    void draw()
      .catch((): PanelResult => ({ body: [empty('This could not be loaded.')] }))
      .then((result) => {
        if (!panel.isConnected) return
        body.replaceChildren(...result.body)
        body.removeAttribute('aria-busy')
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

// The sidebar's disk meter outlives every navigation; keep it current.
setInterval(fillMetrics, TTL_MS)
