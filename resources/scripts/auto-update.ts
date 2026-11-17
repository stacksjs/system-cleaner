/**
 * "Check for updates automatically", made real.
 *
 * The switch in Settings promises "once a day, in the background. Nothing
 * installs on its own." This is that promise:
 *
 * - About once a day, and only while the switch is on, the agent asks GitHub
 *   whether a newer SystemCleaner exists. The request fetches one small file
 *   from the latest release and carries nothing about the Mac.
 * - When there is one, a single macOS notification says so (once per version,
 *   and only while "When an update is available" is on), and the sidebar's
 *   Settings row gets a dot. Clicking it opens Settings at Software Update,
 *   where the download already lives. Nothing is downloaded or installed here.
 *
 * Both the main window and the menu bar popover load this script. The popover
 * stays alive with the window closed, which is what makes "in the
 * background" true; the shared timestamp below keeps the two from both
 * checking.
 */
import { notifications } from '@stacksjs/desktop/browser'

import { readPref } from '../lib/preferences'
import { shouldAnnounce, shouldCheck } from '../lib/update-schedule'

/** How often a page that stays open asks whether a day has passed. */
const TICK_MS = 60 * 60 * 1000
/** When any window last asked GitHub, so the two windows share one check. */
const CHECKED_KEY = 'systemcleaner-update-checked-at'
/** The newest version a notification has been shown for, so it is shown once. */
const NOTIFIED_KEY = 'systemcleaner-update-notified'
/** Which Settings pane opens next; Settings reads it on load. */
const SETTINGS_PANE_KEY = 'systemcleaner-settings-pane'

interface SelfUpdateStatus {
  success?: boolean
  stage?: string
  latestVersion?: string | null
  checkedAt?: string | null
}

function read(key: string): string {
  try { return localStorage.getItem(key) || '' }
  catch { return '' }
}

function write(key: string, value: string): void {
  try { localStorage.setItem(key, value) }
  catch { /* The check still happened; it may simply happen again sooner. */ }
}

async function post(endpoint: string): Promise<SelfUpdateStatus | null> {
  try {
    const response = await fetch(`/api/self-update/${endpoint}`, { method: 'POST' })
    return response.ok ? await response.json() as SelfUpdateStatus : null
  }
  catch {
    return null
  }
}

function waiting(status: SelfUpdateStatus | null): boolean {
  return status?.stage === 'available' || status?.stage === 'ready'
}

/** The dot on the sidebar's Settings row, in whichever window has one. */
function markSettings(status: SelfUpdateStatus | null): void {
  const dot = document.querySelector<HTMLElement>('[data-self-update-dot]')
  if (!dot) return
  const show = waiting(status)
  dot.hidden = !show
  const row = dot.closest<HTMLElement>('[data-open-settings]')
  if (row) {
    if (show && status?.latestVersion) row.title = `SystemCleaner ${status.latestVersion} is available`
    else row.removeAttribute('title')
  }
}

async function announce(status: SelfUpdateStatus | null): Promise<void> {
  const version = status?.latestVersion
  if (!version || !shouldAnnounce({ enabled: readPref('notifyOnUpdate'), stage: status?.stage, version, notifiedVersion: read(NOTIFIED_KEY) })) return
  write(NOTIFIED_KEY, version)
  try {
    await notifications.show({
      title: `SystemCleaner ${version} is available`,
      body: 'Open Settings, then Software Update, to download it. Nothing installs until you choose to.',
    })
  }
  catch { /* Notifications refused: the dot on Settings still says so. */ }
}

let running = false

/**
 * Check if the switch is on and a day has passed since any window last did.
 * `status` is always read, because a check started elsewhere (Settings'
 * own button, or the other window) should still light the dot here.
 */
async function tick(): Promise<void> {
  if (running) return
  running = true
  try {
    let status = await post('status')
    if (shouldCheck({ enabled: readPref('autoCheckUpdates'), lastCheckedAt: read(CHECKED_KEY) || status?.checkedAt || '', stage: status?.stage })) {
      // Claimed before asking, so the other window sees it and stands down.
      write(CHECKED_KEY, new Date().toISOString())
      status = await post('check') || status
    }
    markSettings(status)
    await announce(status)
  }
  finally {
    running = false
  }
}

// With an update waiting, the Settings row opens Settings at Software Update.
// Capture phase, so the pane is chosen before the handler that opens the
// window reads it.
document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target.closest('[data-open-settings]') : null
  const dot = target?.querySelector<HTMLElement>('[data-self-update-dot]')
  if (dot && !dot.hidden) write(SETTINGS_PANE_KEY, 'software-update')
}, true)

// A few seconds after load, so the first screen's own requests go first.
setTimeout(() => { void tick() }, 8000)
setInterval(() => { void tick() }, TICK_MS)
// Coming back to the window after a while is when a stale answer shows.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void tick()
})
