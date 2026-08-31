import type { ScheduleRunner, ScheduleSpec } from '@system-cleaner/clean'
import * as path from 'node:path'
import process from 'node:process'
import { formatBytes } from '@system-cleaner/core'
import {
  CLEAN_TARGETS,
  cleanDirectory,
  cleanDsStoreFiles,
  cleanPrivacyItems,
  describeSchedule,
  emptyTrash,
  installSchedule,
  normalizeSchedule,
  readScheduleLog,
  removeSchedule,
  scanPrivacyItems,
  scheduleStatus,
} from '@system-cleaner/clean'
import CleanSchedule from '../../Models/CleanSchedule'
import CleanupRun from '../../Models/CleanupRun'
import KeptCookie from '../../Models/KeptCookie'

/**
 * The automatic clean, joined up: the row that stores intent, the launchd
 * agent that fires it, and the run itself.
 *
 * `packages/clean/src/schedule.ts` deliberately knows nothing about this app —
 * it takes a program to run and puts it on a calendar. What that program is,
 * is this file's problem, and the answer is "the agent binary we already
 * ship", invoked with `--run-schedule`. No new binary to build, sign, and
 * notarise, and the scheduled run executes the same code the window does.
 */

export interface SchedulePayload {
  spec: ScheduleSpec
  targetIds: string[]
  includePrivacy: boolean
  emptyTrash: boolean
  description: string
  lastRunAt: string | null
  lastFreedBytes: number
  lastFreedFormatted: string
  lastStatus: string | null
  installed: boolean
  loaded: boolean
  logPath: string
  log: string
}

type ScheduleRow = {
  id: number
  enabled: number | boolean
  frequency: string
  hour: number
  minute: number
  weekday: number
  day: number
  target_ids: string | null
  include_privacy: number | boolean
  empty_trash: number | boolean
  last_run_at: string | null
  last_freed_bytes: number | null
  last_status: string | null
}

async function currentRow(): Promise<ScheduleRow | undefined> {
  return await CleanSchedule.first() as ScheduleRow | undefined
}

function parseTargetIds(raw: string | null): string[] {
  if (!raw)
    return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  }
  catch {
    return []
  }
}

/**
 * How launchd should invoke us.
 *
 * Compiled, `process.execPath` *is* the agent binary, so it can be scheduled
 * directly. Under `buddy dev` it is `bun`, and the entrypoint has to be named
 * as an argument. The environment is carried over because a launchd job starts
 * with almost none of it — without `DB_DATABASE_PATH` the scheduled run would
 * open a different database from the one the window writes to.
 */
export function scheduleRunner(): ScheduleRunner {
  const executable = process.execPath
  const env: Record<string, string> = { SYSTEM_CLEANER_AGENT: '1' }

  for (const key of ['DB_DATABASE_PATH', 'SYSTEM_CLEANER_MIGRATIONS', 'SYSTEM_CLEANER_SCANNER', 'SYSTEM_CLEANER_WEB_ROOT']) {
    const value = process.env[key]
    if (!value)
      continue
    // Resolved against the current directory before it is written into the
    // plist. launchd starts a job at `/`, and `DB_DATABASE_PATH` arrives from
    // `.env` as `database/stacks.sqlite` — left relative, the 3am run would
    // create a second, empty database at the filesystem root and clean
    // according to a schedule nobody had configured.
    env[key] = path.resolve(process.cwd(), value)
  }

  const workingDirectory = process.cwd()

  if (path.basename(executable) === 'system-cleaner-agent')
    return { argv: [executable, '--run-schedule'], env, workingDirectory }

  const entry = new URL('../../Desktop/server.ts', import.meta.url).pathname
  return { argv: [executable, entry, '--run-schedule'], env, workingDirectory }
}

export async function readSchedule(): Promise<SchedulePayload> {
  const row = await currentRow()
  const status = await scheduleStatus()

  const spec = normalizeSchedule(row
    ? {
        enabled: Boolean(row.enabled),
        frequency: row.frequency as ScheduleSpec['frequency'],
        hour: row.hour,
        minute: row.minute,
        weekday: row.weekday,
        day: row.day,
      }
    : null)

  return {
    spec,
    targetIds: parseTargetIds(row?.target_ids ?? null),
    includePrivacy: Boolean(row?.include_privacy),
    emptyTrash: Boolean(row?.empty_trash),
    description: describeSchedule(spec),
    lastRunAt: row?.last_run_at ?? null,
    lastFreedBytes: row?.last_freed_bytes ?? 0,
    lastFreedFormatted: formatBytes(row?.last_freed_bytes ?? 0),
    lastStatus: row?.last_status ?? null,
    installed: status.installed,
    loaded: status.loaded,
    logPath: status.logPath,
    log: readScheduleLog(),
  }
}

export interface SaveScheduleInput {
  spec: Partial<ScheduleSpec>
  targetIds: string[]
  includePrivacy: boolean
  emptyTrash: boolean
}

/**
 * Persist the schedule and make launchd agree with it.
 *
 * The agent is removed whenever the schedule is disabled or has nothing to do.
 * An enabled schedule with no targets would fire on time, clean nothing, and
 * write a log line saying so once a week forever.
 */
export async function saveSchedule(input: SaveScheduleInput): Promise<SchedulePayload & { error?: string }> {
  const spec = normalizeSchedule(input.spec)
  const targetIds = input.targetIds.filter(id => CLEAN_TARGETS.some(target => target.id === id))
  const hasWork = targetIds.length > 0 || input.includePrivacy || input.emptyTrash

  const row = await currentRow()
  const values = {
    enabled: spec.enabled && hasWork,
    frequency: spec.frequency,
    hour: spec.hour,
    minute: spec.minute,
    weekday: spec.weekday,
    day: spec.day,
    targetIds: JSON.stringify(targetIds),
    includePrivacy: input.includePrivacy,
    emptyTrash: input.emptyTrash,
  }

  if (row)
    await CleanSchedule.update(row.id, values)
  else
    await CleanSchedule.create(values)

  let error: string | undefined
  if (spec.enabled && hasWork) {
    const result = await installSchedule(spec, scheduleRunner())
    if (!result.ok)
      error = result.error
  }
  else {
    await removeSchedule()
  }

  const payload = await readSchedule()
  return error ? { ...payload, error } : payload
}

export interface ScheduledRunOutcome {
  freedBytes: number
  freedFormatted: string
  targets: number
  errors: string[]
  ranAt: string
}

/**
 * Do the work the schedule asks for.
 *
 * Called two ways: by launchd through `--run-schedule`, and by the Run now
 * button. Identical either way, because a scheduled clean nobody can trigger
 * by hand is a scheduled clean nobody trusts.
 */
export async function runScheduledClean(): Promise<ScheduledRunOutcome> {
  const config = await readSchedule()
  const errors: string[] = []
  let freedBytes = 0
  let cleaned = 0

  for (const id of config.targetIds) {
    const target = CLEAN_TARGETS.find(entry => entry.id === id)
    if (!target || target.requiresSudo)
      continue

    try {
      const result = await cleanDirectory(target.path)
      freedBytes += result.freedBytes
      cleaned++
      if (result.errors.length > 0)
        errors.push(`${target.name}: ${result.errors[0]}`)
    }
    catch (err) {
      errors.push(`${target.name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (config.includePrivacy) {
    try {
      const keep = (await KeptCookie.all() as Array<{ domain: string }>).map(entry => entry.domain)
      // Only the kinds nothing is lost to. A scheduled clean that closed your
      // tabs and signed you out of every site while you slept would be
      // uninstalled the same morning.
      const ids = scanPrivacyItems()
        .filter(item => item.kind === 'cache' || item.kind === 'history' || item.kind === 'downloads' || item.kind === 'service-workers')
        .map(item => item.id)

      const outcome = await cleanPrivacyItems(ids, { keepDomains: keep })
      freedBytes += outcome.freedBytes
      cleaned += outcome.cleaned.length
      for (const failure of outcome.errors.slice(0, 3))
        errors.push(`${failure.id}: ${failure.error}`)
    }
    catch (err) {
      errors.push(`Privacy: ${err instanceof Error ? err.message : String(err)}`)
    }

    try {
      await cleanDsStoreFiles()
    }
    catch {
      // Cosmetic. A failed .DS_Store sweep must not fail the whole run.
    }
  }

  if (config.emptyTrash) {
    try {
      const result = await emptyTrash()
      freedBytes += result.freedBytes
    }
    catch (err) {
      errors.push(`Trash: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const ranAt = new Date().toISOString()
  const status = errors.length === 0
    ? `Cleaned ${cleaned} item(s), freed ${formatBytes(freedBytes)}`
    : `Cleaned ${cleaned} item(s), freed ${formatBytes(freedBytes)}, ${errors.length} error(s)`

  const row = await currentRow()
  if (row)
    await CleanSchedule.update(row.id, { lastRunAt: ranAt, lastFreedBytes: freedBytes, lastStatus: status })

  if (freedBytes > 0 || cleaned > 0) {
    await CleanupRun.create({
      source: 'schedule',
      mode: 'permanent',
      itemCount: cleaned,
      failedCount: errors.length,
      freedBytes,
    })
  }

  return { freedBytes, freedFormatted: formatBytes(freedBytes), targets: cleaned, errors, ranAt }
}
