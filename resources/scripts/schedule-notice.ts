/**
 * "When scheduled cleaning runs", made real.
 *
 * The scheduled clean is a launchd job: `SystemCleaner agent --run-schedule`
 * at 3am, with no window and no way to post a notification as SystemCleaner.
 * What it does leave is `lastRunAt` and `lastStatus` on the schedule row. So
 * the notice is posted from here, by the windows, which can: the menu bar
 * popover stays alive with the main window closed, notices a run it has not
 * seen, and says what it reclaimed. If the app was not running at 3am, the
 * notice arrives when it next opens, which is what "after the fact" means in
 * Settings.
 *
 * Both the main window and the popover load this. The shared "seen" marker in
 * localStorage is what keeps them from announcing the same run twice, and what
 * keeps a Run Now from the Schedule screen (someone already looking at the
 * result) from being announced at all: that screen records the run as seen
 * the moment it returns.
 */
import { notifications } from '@stacksjs/desktop/browser'

import { scheduledRunAction } from '../lib/interruptions'
import { readPref } from '../lib/preferences'

/** How often a page that stays open asks whether the schedule has run. */
const TICK_MS = 15 * 60 * 1000
/** The `lastRunAt` of the newest run any window has seen. */
const SEEN_KEY = 'systemcleaner-schedule-seen'

interface SchedulePayload {
  success?: boolean
  lastRunAt?: string | null
  lastStatus?: string | null
  lastFreedFormatted?: string
}

function readSeen(): string | null {
  try { return localStorage.getItem(SEEN_KEY) }
  catch { return '' }
}

function rememberScheduledRun(ranAt: string | null | undefined): void {
  try { localStorage.setItem(SEEN_KEY, ranAt || '') }
  catch { /* Worst case the run is announced once it is already old news. */ }
}

async function readSchedule(): Promise<SchedulePayload | null> {
  try {
    const response = await fetch('/api/schedule', { method: 'POST', cache: 'no-store' })
    return response.ok ? await response.json() as SchedulePayload : null
  }
  catch {
    return null
  }
}

let running = false

async function tick(): Promise<void> {
  if (running) return
  running = true
  try {
    const schedule = await readSchedule()
    if (!schedule?.success) return

    const action = scheduledRunAction({ enabled: readPref('notifyOnSchedule'), lastRunAt: schedule.lastRunAt, seenRunAt: readSeen() })
    if (action === 'ignore') return

    // Claimed before speaking, so the other window sees it and stays quiet.
    rememberScheduledRun(schedule.lastRunAt)
    if (action !== 'announce') return

    try {
      await notifications.show({
        title: 'Scheduled clean finished',
        body: schedule.lastStatus ? `${schedule.lastStatus}.` : `Freed ${schedule.lastFreedFormatted || 'nothing'}.`,
      })
    }
    catch { /* Notifications refused: the Schedule screen still shows the run. */ }
  }
  finally {
    running = false
  }
}

declare global {
  interface Window {
    rememberScheduledRun: typeof rememberScheduledRun
  }
}

window.rememberScheduledRun = rememberScheduledRun

// After the first screen's own requests, like the update check.
setTimeout(() => { void tick() }, 10_000)
setInterval(() => { void tick() }, TICK_MS)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void tick()
})
