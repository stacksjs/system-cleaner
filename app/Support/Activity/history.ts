import process from 'node:process'
import { db } from '@stacksjs/database/runtime'
import ActivityEvent from '../../Models/ActivityEvent'
import { scanJobs } from '../../Workers/scan-pool'
import { cleanupStats, historyEnabled } from '../Cleanup/history'
import { SECTIONS } from '../../../resources/lib/sections'
import { activityActions } from './actions'

type Kind = 'session' | 'action' | 'visit'
type Source = 'desktop' | 'user' | 'automatic' | 'scheduled' | 'window'
type Status = 'running' | 'completed' | 'partial' | 'failed' | 'blocked' | 'cancelled' | 'interrupted'
type Handler = (request: Request) => Response | Promise<Response>

const screens = new Map(SECTIONS.flatMap(section => [
  [section.href, section.label] as const,
  ...section.tools.map(tool => [tool.href, tool.label] as const),
]))
screens.set('/app/settings', 'Settings')

async function start(kind: Kind, action: string, source: Source, completed = false): Promise<number | undefined> {
  try {
    if (!await historyEnabled()) return
    const now = Date.now()
    const event = await ActivityEvent.create({
      kind, action, source, status: completed ? 'completed' : 'running',
      startedAt: now, finishedAt: completed ? now : 0, ownerPid: process.pid,
    })
    return Number(event.id)
  }
  catch { /* History must never block the app or the action. */ }
}

export async function finishActivity(id: number | undefined, status: Status): Promise<void> {
  if (!id) return
  try {
    await db.updateTable('activity_events').set({ status, finished_at: Date.now() })
      .where('id', '=', id).where('status', '=', 'running').execute()
  }
  catch { /* A later launch can recover an unfinished event. */ }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  }
  catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export async function recoverInterruptedActivity(): Promise<void> {
  try {
    const owners = await db.selectFrom('activity_events').select('owner_pid')
      .where('status', '=', 'running').distinct().get() as { owner_pid: number }[]
    for (const { owner_pid: pid } of owners) {
      if (alive(pid)) continue
      await db.updateTable('activity_events').set({ status: 'interrupted' })
        .where('owner_pid', '=', pid).where('status', '=', 'running').execute()
    }
  }
  catch { /* An unavailable history database must not delay startup. */ }
}

export const startDesktopActivity = () => start('session', 'app', 'desktop')
export const startScheduledActivity = () => start('action', 'schedule-run', 'scheduled')

export async function closeDesktopActivity(sessionId: number | undefined): Promise<void> {
  await finishActivity(sessionId, 'completed')
  try {
    await db.updateTable('activity_events').set({ status: 'interrupted' })
      .where('owner_pid', '=', process.pid).where('status', '=', 'running').execute()
  }
  catch { /* Interrupted rows can be recovered on the next launch. */ }
}

export async function recordScreenVisit(route: string, initial: boolean): Promise<boolean> {
  const normalized = route.replace(/\/+$/, '')
  const label = screens.get(normalized)
  if (!label) return false
  await start('visit', label, initial ? 'window' : 'user', true)
  return true
}

async function outcome(response: Response, action: string): Promise<Status> {
  if (!response.ok) return response.status < 500 ? 'blocked' : 'failed'
  const scan = activityActions[action].scan
  if (scan) {
    const status = scanJobs.status(scan)
    return status === 'cancelled' ? 'cancelled' : status === 'failed' ? 'failed' : 'completed'
  }
  try {
    const result = await response.clone().json()
    if (result.cancelled) return 'cancelled'
    if (Array.isArray(result.outcomes)) {
      const removed = result.outcomes.filter((item: { removed?: boolean }) => item.removed).length
      if (removed === result.outcomes.length) return 'completed'
      if (removed) return 'partial'
      return result.outcomes.some((item: { failed?: string }) => item.failed) ? 'failed' : 'blocked'
    }
    const missed = (Array.isArray(result.skipped) ? result.skipped.length > 0 : Number(result.skipped) > 0)
      || Array.isArray(result.failed) && result.failed.length > 0
    if (result.success === false || result.ok === false || result.error || missed) {
      if (result.freedBytes > 0 || result.succeeded?.length || result.cleaned?.length || Number(result.cleaned) > 0 || result.removed?.length) return 'partial'
      return missed && result.success !== false ? 'blocked' : 'failed'
    }
  }
  catch { /* Some actions return no JSON; the HTTP status still applies. */ }
  return 'completed'
}

export function trackActivity(action: string, handler: Handler): Handler {
  const details = activityActions[action]
  if (!details) return handler
  return async (req) => {
    let source: Source = 'user'
    if (details.manualFlag || action === 'disk-scan') {
      let body
      try { body = await req.clone().json() }
      catch { /* Invalid requests are still reported by their handler. */ }
      if (details.manualFlag && body?.[details.manualFlag] !== true) return handler(req)
      if (action === 'disk-scan' && body?.backgroundRefresh === true) source = 'automatic'
    }
    const id = await start('action', action, source)
    try {
      const response = await handler(req)
      if (id) await finishActivity(id, await outcome(response, action))
      return response
    }
    catch (error) {
      await finishActivity(id, 'failed')
      throw error
    }
  }
}

interface SummaryRow {
  year: number
  exit_year: number | null
  kind: Kind
  action: string
  source: Source
  status: Status
  count: number
}

interface TimelineRow {
  id: number
  kind: Kind
  action: string
  source: Source
  status: Status
  started_at: number
  finished_at: number
}

function labelFor(kind: Kind, action: string): string {
  if (kind === 'session') return 'App session'
  if (kind === 'visit') return action
  return activityActions[action]?.label ?? action
}

function summarize(rows: SummaryRow[]) {
  const totals = { launches: 0, exits: 0, interrupted: 0, actions: 0, completed: 0, issues: 0, automated: 0, visits: 0, windows: 0 }
  const categories = new Map<string, number>()
  const mostUsed = new Map<string, number>()
  const pages = new Map<string, number>()
  for (const row of rows) {
    if (row.kind === 'session') {
      totals.launches += row.count
      if (row.status === 'completed') totals.exits += row.count
      if (row.status === 'interrupted') totals.interrupted += row.count
    }
    else if (row.kind === 'visit') {
      totals.visits += row.count
      if (row.source === 'window') totals.windows += row.count
      pages.set(row.action, (pages.get(row.action) ?? 0) + row.count)
    }
    else if (row.source === 'user') {
      totals.actions += row.count
      if (row.status === 'completed') totals.completed += row.count
      else if (row.status !== 'running') totals.issues += row.count
      const category = activityActions[row.action]?.category ?? 'Other'
      categories.set(category, (categories.get(category) ?? 0) + row.count)
      mostUsed.set(row.action, (mostUsed.get(row.action) ?? 0) + row.count)
    }
    else totals.automated += row.count
  }
  const sorted = (values: Map<string, number>) => [...values].sort(([, a], [, b]) => b - a)
  return { ...totals,
    categories: sorted(categories).map(([label, count]) => ({ label, count })),
    topActions: sorted(mostUsed).slice(0, 5).map(([key, count]) => ({ label: labelFor('action', key), count })),
    topScreens: sorted(pages).slice(0, 5).map(([label, count]) => ({ label, count })),
  }
}

const PAGE_SIZE = 35

export async function activityReport(year: number, kind: 'all' | Kind, page: number) {
  const cleanups = await cleanupStats()
  const bounds = (await db.unsafe(
    'SELECT min(started_at) AS earliest, max(max(started_at, finished_at)) AS latest FROM activity_events', [],
  ).execute())[0]
  const currentYear = new Date().getFullYear()
  const firstYear = bounds?.earliest ? new Date(Number(bounds.earliest)).getFullYear() : currentYear
  const lastYear = bounds?.latest ? new Date(Number(bounds.latest)).getFullYear() : currentYear
  const calendar: number[][] = []
  for (let item = Math.max(1970, firstYear); item <= Math.min(currentYear + 1, lastYear); item++) {
    calendar.push([item, new Date(item, 0, 1).getTime(), new Date(item + 1, 0, 1).getTime()])
  }
  // Compute the boundaries in the same time zone as the rest of the report.
  // SQLite's localtime comes from the OS, while the runtime can override it.
  const rows = await db.unsafe(`
    WITH periods AS (
      SELECT json_extract(value, '$[0]') AS year,
        json_extract(value, '$[1]') AS start_at, json_extract(value, '$[2]') AS end_at
      FROM json_each(?)
    )
    SELECT opened.year, closed.year AS exit_year, kind, action, source, status, count(*) AS count
    FROM activity_events
    JOIN periods AS opened ON started_at >= opened.start_at AND started_at < opened.end_at
    LEFT JOIN periods AS closed ON kind = 'session' AND status = 'completed'
      AND finished_at >= closed.start_at AND finished_at < closed.end_at
    GROUP BY opened.year, closed.year, kind, action, source, status
  `, [JSON.stringify(calendar)]).execute() as unknown as SummaryRow[]
  const calendarYears = new Set(cleanups.years.map(period => period.year))
  for (const row of rows) {
    if (row.year) calendarYears.add(row.year)
    if (row.exit_year) calendarYears.add(row.exit_year)
  }
  const years = [...calendarYears].sort((a, b) => b - a)
  const startOfYear = new Date(year, 0, 1).getTime()
  const endOfYear = new Date(year + 1, 0, 1).getTime()
  const timeline = await db.unsafe(`
    SELECT id, kind, action, source, status, started_at, finished_at
    FROM activity_events
    WHERE ((started_at >= ? AND started_at < ?)
      OR (kind = 'session' AND finished_at >= ? AND finished_at < ?))
      AND (? = 'all' OR kind = ?)
    ORDER BY CASE WHEN started_at < ? THEN finished_at ELSE started_at END DESC, id DESC
    LIMIT ? OFFSET ?
  `, [startOfYear, endOfYear, startOfYear, endOfYear, kind, kind, startOfYear, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE])
    .execute() as unknown as TimelineRow[]
  const period = summarize(rows.filter(row => row.year === year))
  period.exits = rows.reduce((count, row) => count + (row.exit_year === year ? row.count : 0), 0)
  return {
    recording: cleanups.recording,
    years, year, page, kind,
    lifetime: { ...summarize(rows), cleanup: cleanups.lifetime },
    period: { ...period, cleanup: cleanups.years.find(item => item.year === year) ?? null },
    hasNext: timeline.length > PAGE_SIZE,
    timeline: timeline.slice(0, PAGE_SIZE).map(row => ({
      id: row.id, kind: row.kind, label: labelFor(row.kind, row.action), source: row.source,
      status: row.status, startedAt: row.started_at, finishedAt: row.finished_at || null,
    })),
  }
}
