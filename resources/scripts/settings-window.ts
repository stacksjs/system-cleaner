/**
 * The Settings window's behaviour.
 *
 * Markup lives in `resources/layouts/settings.stx` (the shell),
 * `resources/components/SettingsSidebar.stx` (the rows) and
 * `resources/views/app/settings.stx` (the panes). This file is the wiring:
 * which pane a row selects, what each control reads, what it writes, and where
 * that lands.
 *
 * It is a bundled script rather than a `<script client>` block because it
 * imports `@stacksjs/desktop/browser` — an stx client block is shipped into
 * the HTML as written, with no module resolution, so it cannot reach the
 * bridge. That is the same split `settings-panel.ts` and `app-menu.ts` use.
 *
 * Everything here degrades in a browser, where this page is also reachable and
 * there is no bridge at all: the login item reads false, the window
 * appearance call is skipped, and Cmd+W does nothing.
 */
import { nativeAutoLaunch, nativeWindow } from '@stacksjs/desktop/browser'

/**
 * Where the appearance bootstrap keeps its state.
 *
 * `@appearanceBootstrap` in both layouts reads this key before first paint.
 * The two windows share it deliberately: the theme control is in this window,
 * and a second key would leave the window the user was actually looking at on
 * the old theme.
 */
const APPEARANCE_KEY = 'systemcleaner-appearance'

/** Keys this window owns that are the app's own preference, not appearance. */
const PREFS_KEY = 'systemcleaner-preferences'

/** Which pane was open when Settings was last closed. */
const LAST_PANE_KEY = 'systemcleaner-settings-pane'

type ColorMode = 'system' | 'light' | 'dark'

const COLOR_MODES: ColorMode[] = ['system', 'light', 'dark']

/**
 * Every switch this window owns that is nothing but a stored boolean, with the
 * value it has before anyone touches it.
 *
 * Declared rather than scattered so "restore defaults" has something to
 * restore *to*, and so adding a switch is one line in two places (here and the
 * markup) rather than four.
 */
const PREF_DEFAULTS: Record<string, boolean> = {
  autoCheckUpdates: true,
  confirmDeletes: true,
  recordHistory: true,
  notifyOnFinish: true,
  notifyOnSchedule: true,
  notifyOnUpdate: true,
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function readJson(key: string): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  }
  catch {
    // A private window, a cleared store, or something else's JSON under our
    // key. Defaults are a correct answer to all three.
    return {}
  }
}

function writeJson(key: string, value: Record<string, unknown>): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  }
  catch {
    // Nothing to do and nothing worth saying: the control still moved, and the
    // setting simply will not survive the window.
  }
}

function readPref(key: string): boolean {
  const value = readJson(PREFS_KEY)[key]
  return typeof value === 'boolean' ? value : (PREF_DEFAULTS[key] ?? false)
}

function writePref(key: string, value: boolean): void {
  const prefs = readJson(PREFS_KEY)
  prefs[key] = value
  writeJson(PREFS_KEY, prefs)
}

// ---------------------------------------------------------------------------
// Appearance
// ---------------------------------------------------------------------------

function currentColorMode(): ColorMode {
  const stored = readJson(APPEARANCE_KEY).colorMode
  return COLOR_MODES.includes(stored as ColorMode) ? stored as ColorMode : 'system'
}

/**
 * Tell this window which mode it is in.
 *
 * Craft resolves an NSVisualEffectView's material — and AppKit draws the
 * window buttons — against the *window's* appearance, not the page's. Since
 * Craft routes window actions to the window that asked, this sets the Settings
 * window only; the main window applies the same stored mode for itself when it
 * next hears about the change. Each window owning its own appearance is the
 * correct shape: they can be told separately, so they must each be told.
 */
function applyNativeAppearance(mode: ColorMode): void {
  void nativeWindow.setAppearance(mode)
}

/**
 * Apply a colour mode now, the way the bootstrap applies it at load.
 *
 * Everything the bootstrap writes has to move together: the stylesheet keys
 * its palette off `:root.dark`, `data-color-mode` is what the bootstrap reads
 * back, and `data-theme` is the resolved answer for anything that wants it
 * without computing `prefers-color-scheme` itself.
 */
function applyColorMode(mode: ColorMode): void {
  const root = document.documentElement
  root.setAttribute('data-color-mode', mode)

  const dark = mode === 'dark'
    || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  root.classList.toggle('dark', dark)
  root.dataset.theme = dark ? 'dark' : 'light'
  applyNativeAppearance(mode)
}

function setColorMode(mode: ColorMode): void {
  const appearance = readJson(APPEARANCE_KEY)
  appearance.colorMode = mode
  writeJson(APPEARANCE_KEY, appearance)
  applyColorMode(mode)
  syncSegmented('colorMode', mode)
}

/** Follow the system while — and only while — the mode is `system`. */
function watchSystemAppearance(): void {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (currentColorMode() === 'system')
      applyColorMode('system')
  })
}

// ---------------------------------------------------------------------------
// Control sync
// ---------------------------------------------------------------------------

function syncSegmented(id: string, value: string): void {
  for (const option of Array.from(document.querySelectorAll<HTMLElement>(`[data-option="${id}"]`))) {
    const selected = option.getAttribute('data-value') === value
    option.toggleAttribute('data-active', selected)
    option.setAttribute('aria-checked', String(selected))
  }
}

function syncSwitch(id: string, on: boolean): void {
  const control = document.querySelector<HTMLElement>(`[data-switch="${id}"]`)
  if (!control)
    return
  control.toggleAttribute('data-on', on)
  control.setAttribute('aria-checked', String(on))
}

function setValue(id: string, text: string): void {
  for (const slot of Array.from(document.querySelectorAll<HTMLElement>(`[data-value="${id}"]`)))
    slot.textContent = text
}

// ---------------------------------------------------------------------------
// Panes
// ---------------------------------------------------------------------------

/**
 * The pane history, so the toolbar's arrows mean something.
 *
 * A plain array with a cursor rather than the browser's own history: this
 * window never navigates — every pane is in the document from the start — and
 * pushing states onto `history` would make the back arrow eventually leave the
 * page entirely.
 */
const trail: string[] = []
let trailIndex = -1

function panes(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-pane]'))
}

function showPane(id: string): void {
  // Found before anything is hidden. Switching to a pane that does not exist
  // would otherwise leave the window blank under a title that did not change,
  // which looks like the app broke rather than like a row pointing at nothing.
  const shown = panes().find(pane => pane.getAttribute('data-pane') === id)
  if (!shown)
    return

  for (const pane of panes())
    pane.toggleAttribute('data-active', pane === shown)

  // The list rows only. The alert row above them points at the same pane, and
  // lighting both up shows one selection twice — the row in the list is where
  // that pane lives, and the alert is a shortcut to it.
  for (const row of Array.from(document.querySelectorAll<HTMLElement>('.set-row[data-pane-link]')))
    row.toggleAttribute('data-active', row.getAttribute('data-pane-link') === id)

  const title = document.querySelector<HTMLElement>('[data-pane-title]')
  if (title)
    title.textContent = shown.getAttribute('data-pane-title') || id

  // Scrolled to the top, because it is a different screen — not a continuation
  // of the one that was there.
  document.querySelector('.set-body')?.scrollTo({ top: 0 })

  try {
    localStorage.setItem(LAST_PANE_KEY, id)
  }
  catch {
    // The window will open on General next time. Not worth saying anything.
  }
}

function goTo(id: string): void {
  if (!id || trail[trailIndex] === id)
    return
  // Anything ahead of the cursor is a future that was replaced by this choice,
  // exactly as a browser drops its forward stack on a new navigation.
  trail.splice(trailIndex + 1)
  trail.push(id)
  trailIndex = trail.length - 1
  showPane(id)
  syncHistoryButtons()
}

function step(delta: number): void {
  const next = trailIndex + delta
  if (next < 0 || next >= trail.length)
    return
  trailIndex = next
  showPane(trail[trailIndex])
  syncHistoryButtons()
}

function syncHistoryButtons(): void {
  const back = document.querySelector<HTMLButtonElement>('[data-history-back]')
  const forward = document.querySelector<HTMLButtonElement>('[data-history-forward]')
  if (back)
    back.disabled = trailIndex <= 0
  if (forward)
    forward.disabled = trailIndex >= trail.length - 1
}

function firstPane(): string {
  try {
    const stored = localStorage.getItem(LAST_PANE_KEY)
    if (stored && document.querySelector(`[data-pane="${stored}"]`))
      return stored
  }
  catch {
    // Fall through to the first pane in the document.
  }
  return panes()[0]?.getAttribute('data-pane') || 'general'
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Filter the sidebar by what a row is called.
 *
 * Rows only, not the settings inside them: matching a pane's contents would
 * mean showing a row whose visible label has nothing to do with what was
 * typed, and the row is what gets clicked either way.
 */
function applySearch(query: string): void {
  const needle = query.trim().toLowerCase()
  const nav = document.querySelector<HTMLElement>('.set-nav')
  const field = document.querySelector<HTMLElement>('[data-search-field]')
  field?.toggleAttribute('data-filled', needle.length > 0)
  if (!nav)
    return

  let matches = 0
  for (const row of Array.from(nav.querySelectorAll<HTMLElement>('[data-search-terms]'))) {
    const hit = !needle || (row.getAttribute('data-search-terms') || '').toLowerCase().includes(needle)
    row.hidden = !hit
    if (hit)
      matches += 1
  }

  // A group whose every row is hidden would otherwise leave its padding behind
  // as a gap with nothing in it.
  for (const group of Array.from(nav.querySelectorAll<HTMLElement>('[data-nav-group]'))) {
    const visible = Array.from(group.querySelectorAll<HTMLElement>('[data-search-terms]')).some(r => !r.hidden)
    group.hidden = !visible
  }

  // Everything above the groups is the account, the update alert and the
  // privacy note — none of it is a search result, so a search hides it.
  const searching = needle.length > 0
  const account = document.querySelector<HTMLElement>('[data-account]')
  if (account && account.dataset.loaded === 'true')
    account.hidden = searching
  const notice = document.querySelector<HTMLElement>('.set-notice')
  if (notice)
    notice.hidden = searching
  const alert = document.querySelector<HTMLElement>('[data-update-alert]')
  if (alert)
    alert.style.display = searching ? 'none' : ''

  nav.toggleAttribute('data-empty', matches === 0)
}

// ---------------------------------------------------------------------------
// Data the window shows
// ---------------------------------------------------------------------------

function post<T>(endpoint: string, body: unknown = {}): Promise<T | null> {
  return fetch(`/api${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
    .then(r => r.json() as Promise<T>)
    .catch(() => null)
}

/**
 * Whose Mac this is.
 *
 * The row stays hidden until this answers. A row with an empty circle and no
 * name in it reads as broken; no row at all reads as a window that simply does
 * not have that section.
 */
function loadAccount(): void {
  const row = document.querySelector<HTMLElement>('[data-account]')
  if (!row)
    return

  void post<{ success?: boolean, fullName?: string, shortName?: string, picture?: string | null, hostName?: string }>('/user-profile')
    .then((d) => {
      if (!d?.success)
        return

      const name = d.fullName || d.shortName || ''
      const nameSlot = row.querySelector<HTMLElement>('[data-account-name]')
      if (nameSlot && name)
        nameSlot.textContent = name

      const subSlot = row.querySelector<HTMLElement>('[data-account-sub]')
      if (subSlot && d.hostName)
        subSlot.textContent = d.hostName

      const avatar = row.querySelector<HTMLElement>('[data-account-avatar]')
      if (avatar) {
        if (d.picture) {
          const img = document.createElement('img')
          img.src = d.picture
          img.alt = ''
          avatar.replaceChildren(img)
        }
        else if (name) {
          // The initial, not a generic silhouette: a letter that is *yours*
          // still personalises the corner, and a grey bust does not.
          avatar.textContent = name.trim().charAt(0).toUpperCase()
        }
      }

      row.dataset.loaded = 'true'
      row.hidden = false
    })
}

/**
 * The count on the alert row.
 *
 * Everything the Mac has waiting, plus SystemCleaner's own update if there is
 * one — which is the sum System Settings shows, and the only number a person
 * reads that row for.
 */
function loadUpdateCount(): void {
  const alert = document.querySelector<HTMLElement>('[data-update-alert]')
  const count = document.querySelector<HTMLElement>('[data-update-count]')
  if (!alert || !count)
    return

  void Promise.all([
    post<{ success?: boolean, total?: number }>('/updates-summary'),
    post<{ stage?: string }>('/self-update/status'),
  ]).then(([summary, self]) => {
    const waiting = (summary?.success ? (summary.total || 0) : 0)
      + (self?.stage === 'available' || self?.stage === 'ready' ? 1 : 0)

    count.textContent = waiting > 99 ? '99+' : String(waiting)
    alert.toggleAttribute('data-visible', waiting > 0)
  })
}

function loadCleaningCounts(): void {
  void post<{ paths?: unknown[] }>('/protected-paths')
    .then(d => setValue('protectedCount', String(d?.paths?.length ?? 0)))
  void post<{ domains?: unknown[] }>('/kept-cookies')
    .then(d => setValue('keptCookieCount', String(d?.domains?.length ?? 0)))
}

/**
 * The schedule, which is the one group of controls here whose state lives on
 * the machine rather than in this window.
 *
 * Held whole rather than field by field: `/api/schedule-save` replaces the
 * record, so flipping one switch has to send back everything else the Schedule
 * screen chose — the times, the target list — or saving from here would quietly
 * wipe them.
 */
interface SchedulePayload {
  success?: boolean
  spec?: { enabled?: boolean, frequency?: string, hour?: number, minute?: number, weekday?: number, day?: number }
  targetIds?: string[]
  includePrivacy?: boolean
  emptyTrash?: boolean
  description?: string
  lastRunAt?: string | null
  lastFreedFormatted?: string
  lastStatus?: string | null
}

let schedule: SchedulePayload = {}

function paintSchedule(): void {
  const spec = schedule.spec || {}
  syncSwitch('scheduleEnabled', spec.enabled === true)
  syncSwitch('scheduleIncludePrivacy', schedule.includePrivacy === true)
  syncSwitch('scheduleEmptyTrash', schedule.emptyTrash === true)

  const select = document.querySelector<HTMLSelectElement>('[data-select="scheduleFrequency"]')
  if (select && spec.frequency)
    select.value = spec.frequency

  setValue('scheduleDescription', schedule.description || 'Not scheduled')
  setValue(
    'scheduleLastRun',
    schedule.lastRunAt
      ? `${new Date(schedule.lastRunAt).toLocaleString()}${schedule.lastFreedFormatted ? ` · ${schedule.lastFreedFormatted}` : ''}`
      : 'Never',
  )
}

function loadSchedule(): void {
  void post<SchedulePayload>('/schedule').then((d) => {
    if (!d?.success)
      return
    schedule = d
    paintSchedule()
  })
}

/**
 * Save the schedule, then paint what came back rather than what was asked for.
 *
 * The agent normalises the spec and recomputes the description, and a launch
 * agent that failed to install leaves `enabled` false however the switch was
 * moved. Showing the request would be a switch that says on next to a schedule
 * that is not running.
 */
function saveSchedule(patch: Partial<SchedulePayload>): void {
  const next: SchedulePayload = {
    ...schedule,
    ...patch,
    spec: { ...(schedule.spec || {}), ...(patch.spec || {}) },
  }

  void post<SchedulePayload>('/schedule-save', {
    spec: next.spec,
    targetIds: next.targetIds ?? [],
    includePrivacy: next.includePrivacy === true,
    emptyTrash: next.emptyTrash === true,
  }).then((d) => {
    schedule = d?.success ? d : next
    paintSchedule()
  })
}

function loadMachine(): void {
  void post<{
    success?: boolean
    hostname?: string
    macosVersion?: string
    cpuLabel?: string
    cpuCores?: number
    totalMemGB?: string
    diskTotal?: string
    diskUsed?: string
    diskAvail?: string
    diskPercent?: number
  }>('/dashboard-stats').then((d) => {
    if (!d?.success)
      return
    setValue('hostName', d.hostname || '—')
    setValue('osVersion', d.macosVersion ? `macOS ${d.macosVersion}` : '—')
    setValue('cpuModel', d.cpuLabel ? `${d.cpuLabel} · ${d.cpuCores} cores` : '—')
    setValue('memory', d.totalMemGB ? `${d.totalMemGB} GB` : '—')
    setValue('diskUsage', d.diskUsed && d.diskTotal ? `${d.diskUsed} of ${d.diskTotal} used` : '—')
    setValue('diskAvail', d.diskAvail ? `${d.diskAvail} free` : '—')
  })
}

/**
 * What the app calls itself.
 *
 * `app.getInfo()` is the bridge's answer and there is none in a browser, where
 * this page also renders. `0.0.0` is what the package answers with when there
 * is no bridge to ask, so it is not a version worth printing.
 */
function loadVersion(): void {
  void import('@stacksjs/desktop/browser')
    .then(({ app }) => app.getInfo())
    .then((info) => {
      if (info?.version && info.version !== '0.0.0')
        setValue('appVersion', `Version ${info.version}`)
      else
        setValue('appVersion', 'Running from source')
    })
    .catch(() => setValue('appVersion', 'Running from source'))
}

// ---------------------------------------------------------------------------
// The login item, which is the one switch with a real system side
// ---------------------------------------------------------------------------

/**
 * `nativeAutoLaunch` resolves false rather than throwing when there is no
 * bridge, and the *reported* state is what the switch shows — never the state
 * the user just asked for. A switch that slides to on when the write failed is
 * a lie the user only discovers at their next restart.
 */
async function syncOpenAtLogin(): Promise<void> {
  try {
    syncSwitch('openAtLogin', await nativeAutoLaunch.isEnabled())
  }
  catch {
    syncSwitch('openAtLogin', false)
  }
}

async function toggleOpenAtLogin(): Promise<void> {
  const control = document.querySelector<HTMLElement>('[data-switch="openAtLogin"]')
  const wanted = !(control?.hasAttribute('data-on') ?? false)

  try {
    if (wanted)
      await nativeAutoLaunch.enable()
    else
      await nativeAutoLaunch.disable()
  }
  catch {
    // Fall through to the read below, which is the only thing that decides
    // what the switch shows.
  }

  await syncOpenAtLogin()
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function paintAll(): void {
  syncSegmented('colorMode', currentColorMode())
  for (const key of Object.keys(PREF_DEFAULTS))
    syncSwitch(key, readPref(key))
  syncSwitch('analytics', false)
  void syncOpenAtLogin()
}

function handleAction(action: string): void {
  if (action === 'resetPrefs') {
    writeJson(PREFS_KEY, {})
    paintAll()
    return
  }
  if (action === 'openSoftwareUpdate') {
    void post('/open-software-update')
    return
  }
  if (action === 'openFullDiskAccess') {
    void post('/open-privacy-settings')
    return
  }
  if (action === 'revealDataDir')
    void post('/reveal-app-data')
}

/**
 * Moving a window that has no titlebar.
 *
 * WebKit never implemented `-webkit-app-region: drag` — a WKWebView discards
 * the declaration outright, which is worse than not supporting it, because the
 * stylesheet then reads as though the window can be dragged while it cannot be
 * moved at all. `startDrag` hands the press to AppKit, which runs a real window
 * drag loop from it.
 *
 * The bands that drag are the toolbar row and the strip above the search
 * field: the two places this window has no content of its own, and the two
 * places the window buttons sit.
 */
function isDragSurface(target: EventTarget | null): boolean {
  if (!(target instanceof Element))
    return false
  // Anything you can press is not a handle, or the window would move whenever
  // a control was clicked and released a pixel off.
  if (target.closest('button, a, input, select, textarea, [role="button"]'))
    return false
  return !!target.closest('[data-window-drag]')
}

function wire(): void {
  document.addEventListener('mousedown', (event) => {
    if (event.button === 0 && isDragSurface(event.target))
      void nativeWindow.startDrag()
  })

  // Double-clicking a titlebar zooms the window, and this row is standing in
  // for one.
  document.addEventListener('dblclick', (event) => {
    if (isDragSurface(event.target))
      void nativeWindow.maximize()
  })

  // Delegated: the panes are in the document from the start, but the account
  // row and the alert row appear later, and a delegated listener cannot go
  // stale on either.
  document.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof Element))
      return

    const link = target.closest<HTMLElement>('[data-pane-link]')
    if (link) {
      goTo(link.getAttribute('data-pane-link') || '')
      return
    }

    if (target.closest('[data-history-back]')) {
      step(-1)
      return
    }
    if (target.closest('[data-history-forward]')) {
      step(1)
      return
    }

    const option = target.closest<HTMLElement>('[data-option]')
    if (option) {
      const value = option.getAttribute('data-value')
      if (option.getAttribute('data-option') === 'colorMode' && COLOR_MODES.includes(value as ColorMode))
        setColorMode(value as ColorMode)
      return
    }

    const toggle = target.closest<HTMLButtonElement>('[data-switch]')
    if (toggle && !toggle.disabled) {
      const id = toggle.getAttribute('data-switch') || ''
      const next = !toggle.hasAttribute('data-on')

      if (id === 'openAtLogin') {
        void toggleOpenAtLogin()
      }
      else if (id === 'scheduleEnabled') {
        saveSchedule({ spec: { enabled: next } })
      }
      else if (id === 'scheduleIncludePrivacy') {
        saveSchedule({ includePrivacy: next })
      }
      else if (id === 'scheduleEmptyTrash') {
        saveSchedule({ emptyTrash: next })
      }
      else if (id in PREF_DEFAULTS) {
        writePref(id, next)
        syncSwitch(id, next)
      }
      return
    }

    const button = target.closest<HTMLElement>('[data-action]')
    if (button) {
      handleAction(button.getAttribute('data-action') || '')
      return
    }

    if (target.closest('[data-search-clear]')) {
      const input = document.querySelector<HTMLInputElement>('[data-search-input]')
      if (input) {
        input.value = ''
        applySearch('')
        input.focus()
      }
    }
  })

  document.addEventListener('change', (event) => {
    const target = event.target
    if (target instanceof HTMLSelectElement && target.getAttribute('data-select') === 'scheduleFrequency')
      saveSchedule({ spec: { frequency: target.value } })
  })

  const search = document.querySelector<HTMLInputElement>('[data-search-input]')
  search?.addEventListener('input', () => applySearch(search.value))

  document.addEventListener('keydown', (event) => {
    // Cmd+W and Escape both close a Settings window on a Mac. Craft routes the
    // call to the window it came from, so this closes *this* one.
    const closing = event.key === 'Escape'
      || ((event.key === 'w' || event.key === 'W') && event.metaKey)
    if (closing) {
      event.preventDefault()
      void nativeWindow.close()
      return
    }

    // Cmd+F is where a Mac user reaches for a search field they can already
    // see, and this one is not in a toolbar they can tab to.
    if ((event.key === 'f' || event.key === 'F') && event.metaKey) {
      event.preventDefault()
      search?.focus()
      search?.select()
    }
  })

  // Another window changed the theme. Same origin, so the write reaches here.
  window.addEventListener('storage', (event) => {
    if (event.key === APPEARANCE_KEY)
      applyColorMode(currentColorMode())
  })

  applyColorMode(currentColorMode())
  watchSystemAppearance()
  paintAll()
  goTo(firstPane())

  loadAccount()
  loadUpdateCount()
  loadCleaningCounts()
  loadSchedule()
  loadMachine()
  loadVersion()

  // The count is the one thing here that changes while the window is open —
  // a download finishing, a check completing in the other window.
  window.setInterval(loadUpdateCount, 60_000)
}

if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', wire)
else
  wire()
