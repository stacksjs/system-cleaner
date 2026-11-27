import AppPreference from '../../Models/AppPreference'
import CleanupRun from '../../Models/CleanupRun'

/**
 * Whether cleans are written down, and the one place that writes them.
 *
 * "Keep activity history" in Settings is the switch. It has to work for every
 * clean the agent runs, the scheduled one included, and that process has no
 * window to ask, so the answer lives in the database next to the history it
 * governs. Every clean that used to call `CleanupRun.create` itself goes
 * through {@link recordCleanupRun} instead, so the switch cannot be missed by
 * a new endpoint copying an old one.
 */

export interface CleanupRunRecord {
  source: string
  mode: string
  itemCount: number
  failedCount: number
  freedBytes: number
}

type PreferenceRow = { id: number, record_history: number | boolean | null }

async function preferenceRow(): Promise<PreferenceRow | undefined> {
  return await AppPreference.first() as PreferenceRow | undefined
}

/**
 * On unless someone turned it off.
 *
 * A missing row and a missing table both read as on. The first is a Mac that
 * never opened Settings; the second is a development database older than the
 * table. Neither is a decision to stop recording.
 */
export async function historyEnabled(): Promise<boolean> {
  try {
    const row = await preferenceRow()
    if (!row || row.record_history === null || row.record_history === undefined)
      return true
    return Boolean(row.record_history)
  }
  catch {
    return true
  }
}

export async function setHistoryEnabled(on: boolean): Promise<boolean> {
  const row = await preferenceRow()
  if (row)
    await AppPreference.update(row.id, { recordHistory: on })
  else
    await AppPreference.create({ recordHistory: on })
  return historyEnabled()
}

/** Write one clean to the history, unless the history is switched off. */
export async function recordCleanupRun(run: CleanupRunRecord): Promise<boolean> {
  if (!await historyEnabled())
    return false
  await CleanupRun.create(run)
  return true
}

interface CleanupTotals {
  permanentBytes: number
  trashedBytes: number
  permanentItems: number
  trashedItems: number
  worktrees: number
}

function emptyTotals(): CleanupTotals {
  return { permanentBytes: 0, trashedBytes: 0, permanentItems: 0, trashedItems: 0, worktrees: 0 }
}

type SummaryRow = { source: string, mode: string, item_count: number, freed_bytes: number, created_at: string }

function addRemoval(totals: CleanupTotals, row: SummaryRow): void {
  if (row.mode === 'trash') {
    totals.trashedBytes += row.freed_bytes
    totals.trashedItems += row.item_count
  }
  else {
    totals.permanentBytes += row.freed_bytes
    totals.permanentItems += row.item_count
    if (row.source === 'ai-worktrees') totals.worktrees += row.item_count
  }
}

export async function cleanupStats() {
  const rows = await CleanupRun.all() as SummaryRow[]
  const lifetime = emptyTotals()
  const years = new Map<number, { totals: CleanupTotals, sources: Map<string, CleanupTotals> }>()
  years.set(new Date().getFullYear(), { totals: emptyTotals(), sources: new Map() })
  for (const row of rows) {
    if (row.item_count <= 0) continue
    addRemoval(lifetime, row)
    // SQLite supplies bare UTC timestamps. Model-written ISO timestamps
    // already include their offset. Group both by the user's local year.
    const timestamp = row.created_at.includes('T') ? row.created_at : row.created_at.replace(' ', 'T') + 'Z'
    const year = new Date(timestamp).getFullYear()
    if (!Number.isFinite(year)) continue
    if (!years.has(year)) years.set(year, { totals: emptyTotals(), sources: new Map() })
    const entry = years.get(year)!
    addRemoval(entry.totals, row)
    if (!entry.sources.has(row.source)) entry.sources.set(row.source, emptyTotals())
    addRemoval(entry.sources.get(row.source)!, row)
  }
  return {
    recording: await historyEnabled(),
    lifetime,
    years: [...years].sort(([a], [b]) => b - a).map(([year, entry]) => ({
      year,
      ...entry.totals,
      sources: [...entry.sources].map(([source, totals]) => ({ source, ...totals }))
        .sort((a, b) => b.permanentBytes - a.permanentBytes || b.trashedBytes - a.trashedBytes),
    })),
  }
}

/** A history error must not make a completed removal appear to have failed. */
export async function recordRemoval(run: CleanupRunRecord): Promise<string | undefined> {
  try {
    await recordCleanupRun(run)
  }
  catch {
    return 'The removal was completed, but its history could not be saved.'
  }
}
