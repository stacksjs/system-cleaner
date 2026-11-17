import AppPreference from '../../Models/AppPreference'
import CleanupRun from '../../Models/CleanupRun'

/**
 * Whether cleans are written down, and the one place that writes them.
 *
 * "Keep a cleanup history" in Settings is the switch. It has to work for every
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
