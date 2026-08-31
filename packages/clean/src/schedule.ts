import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { exec, HOME, pathExists, shellEscape } from '@system-cleaner/core'

/**
 * Automatic cleaning, on a schedule launchd owns.
 *
 * This is what turns the app from something you remember to open twice a year
 * into something that keeps a Mac tidy — CCleaner's Smart Cleaning and
 * CleanMyMac's Health Check monitor both live here.
 *
 * launchd rather than a timer inside the app, for one reason: the app is not
 * running at 3am. A `setInterval` only fires while the window is open, which
 * is exactly when the user is already looking at the Clean button. A launch
 * agent fires whether or not the app is open, and if the Mac was asleep at the
 * appointed hour launchd runs the job on wake instead of skipping the week.
 */
export const SCHEDULE_LABEL = 'app.systemcleaner.schedule'

export type ScheduleFrequency = 'daily' | 'weekly' | 'monthly'

export interface ScheduleSpec {
  enabled: boolean
  frequency: ScheduleFrequency
  /** 0–23, local time. */
  hour: number
  /** 0–59. */
  minute: number
  /** 0 (Sunday) – 6, used when `frequency` is `weekly`. */
  weekday: number
  /** 1–28, used when `frequency` is `monthly`. 28 so every month has one. */
  day: number
}

export const DEFAULT_SCHEDULE: ScheduleSpec = {
  enabled: false,
  frequency: 'weekly',
  hour: 3,
  minute: 0,
  weekday: 0,
  day: 1,
}

export interface ScheduleRunner {
  /** Program and arguments launchd should run. */
  argv: string[]
  /** Environment the runner needs — database path, bundle resources, … */
  env?: Record<string, string>
  /**
   * Directory to run in. launchd starts a job at `/`, so anything the runner
   * resolves relatively would resolve against the wrong root.
   */
  workingDirectory?: string
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function plistPath(): string {
  return path.join(HOME, 'Library/LaunchAgents', `${SCHEDULE_LABEL}.plist`)
}

export function scheduleLogPath(): string {
  return path.join(HOME, 'Library/Logs/SystemCleaner/schedule.log')
}

/** A sentence for the UI: "Every Sunday at 03:00". */
export function describeSchedule(spec: ScheduleSpec): string {
  const time = `${String(spec.hour).padStart(2, '0')}:${String(spec.minute).padStart(2, '0')}`

  if (spec.frequency === 'daily')
    return `Every day at ${time}`
  if (spec.frequency === 'weekly')
    return `Every ${WEEKDAY_NAMES[spec.weekday] ?? 'Sunday'} at ${time}`

  const suffix = spec.day === 1 ? 'st' : spec.day === 2 ? 'nd' : spec.day === 3 ? 'rd' : 'th'
  return `The ${spec.day}${suffix} of each month at ${time}`
}

/** Clamp anything that arrived over HTTP into a spec launchd will accept. */
export function normalizeSchedule(input: Partial<ScheduleSpec> | null | undefined): ScheduleSpec {
  const spec = { ...DEFAULT_SCHEDULE, ...(input ?? {}) }
  const clamp = (value: unknown, min: number, max: number, fallback: number): number => {
    const n = Number(value)
    return Number.isFinite(n) ? Math.min(Math.max(Math.round(n), min), max) : fallback
  }

  return {
    enabled: Boolean(spec.enabled),
    frequency: spec.frequency === 'daily' || spec.frequency === 'monthly' ? spec.frequency : 'weekly',
    hour: clamp(spec.hour, 0, 23, DEFAULT_SCHEDULE.hour),
    minute: clamp(spec.minute, 0, 59, DEFAULT_SCHEDULE.minute),
    weekday: clamp(spec.weekday, 0, 6, DEFAULT_SCHEDULE.weekday),
    // 28 rather than 31: launchd simply never fires a job set to the 31st in
    // February, so a "monthly" clean would silently skip most of the year.
    day: clamp(spec.day, 1, 28, DEFAULT_SCHEDULE.day),
  }
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function buildPlist(spec: ScheduleSpec, runner: ScheduleRunner): string {
  const calendar: string[] = [`      <key>Hour</key><integer>${spec.hour}</integer>`, `      <key>Minute</key><integer>${spec.minute}</integer>`]
  if (spec.frequency === 'weekly')
    calendar.push(`      <key>Weekday</key><integer>${spec.weekday}</integer>`)
  if (spec.frequency === 'monthly')
    calendar.push(`      <key>Day</key><integer>${spec.day}</integer>`)

  const args = runner.argv.map(arg => `    <string>${xmlEscape(arg)}</string>`).join('\n')
  const env = Object.entries(runner.env ?? {})
    .map(([key, value]) => `    <key>${xmlEscape(key)}</key>\n    <string>${xmlEscape(value)}</string>`)
    .join('\n')

  const log = scheduleLogPath()
  const workingDirectory = runner.workingDirectory
    ? `  <key>WorkingDirectory</key>\n  <string>${xmlEscape(runner.workingDirectory)}</string>\n`
    : ''

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SCHEDULE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
${env ? `  <key>EnvironmentVariables</key>\n  <dict>\n${env}\n  </dict>\n` : ''}${workingDirectory}  <key>StartCalendarInterval</key>
  <dict>
${calendar.join('\n')}
  </dict>
  <key>RunAtLoad</key>
  <false/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>LowPriorityIO</key>
  <true/>
  <key>Nice</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${xmlEscape(log)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(log)}</string>
</dict>
</plist>
`
}

export interface ScheduleStatus {
  installed: boolean
  loaded: boolean
  plistPath: string
  logPath: string
}

export async function scheduleStatus(): Promise<ScheduleStatus> {
  const file = plistPath()
  const installed = pathExists(file)

  let loaded = false
  if (installed) {
    const result = await exec(`launchctl list | grep ${shellEscape(SCHEDULE_LABEL)}`, { timeout: 5000 })
    loaded = result.stdout.includes(SCHEDULE_LABEL)
  }

  return { installed, loaded, plistPath: file, logPath: scheduleLogPath() }
}

/**
 * Write the agent and hand it to launchd.
 *
 * `bootout` before `bootstrap` because launchd refuses to bootstrap a label it
 * already knows, and a schedule the user just changed has to replace the old
 * one rather than fail quietly next to it.
 */
export async function installSchedule(spec: ScheduleSpec, runner: ScheduleRunner): Promise<{ ok: boolean, error?: string }> {
  if (runner.argv.length === 0)
    return { ok: false, error: 'No runner to schedule' }

  const file = plistPath()

  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.mkdirSync(path.dirname(scheduleLogPath()), { recursive: true })
    fs.writeFileSync(file, buildPlist(spec, runner), 'utf8')
  }
  catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }

  const domain = `gui/${os.userInfo().uid}`
  await exec(`launchctl bootout ${domain}/${shellEscape(SCHEDULE_LABEL)} 2>/dev/null`, { timeout: 8000 })
  const result = await exec(`launchctl bootstrap ${domain} ${shellEscape(file)}`, { timeout: 8000 })

  if (!result.ok) {
    // `bootstrap` is the modern verb; `load -w` is the one that works on the
    // odd machine where the user's GUI domain is not reachable from here.
    const legacy = await exec(`launchctl load -w ${shellEscape(file)}`, { timeout: 8000 })
    if (!legacy.ok)
      return { ok: false, error: legacy.stderr || result.stderr || 'launchctl refused the agent' }
  }

  return { ok: true }
}

export async function removeSchedule(): Promise<{ ok: boolean, error?: string }> {
  const file = plistPath()
  const domain = `gui/${os.userInfo().uid}`

  await exec(`launchctl bootout ${domain}/${shellEscape(SCHEDULE_LABEL)} 2>/dev/null`, { timeout: 8000 })
  await exec(`launchctl unload -w ${shellEscape(file)} 2>/dev/null`, { timeout: 8000 })

  try {
    if (pathExists(file))
      fs.unlinkSync(file)
  }
  catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }

  return { ok: true }
}

/** The tail of the schedule log, for the UI to show what the last run did. */
export function readScheduleLog(lines = 40): string {
  try {
    const raw = fs.readFileSync(scheduleLogPath(), 'utf8')
    return raw.split('\n').slice(-lines).join('\n')
  }
  catch {
    return ''
  }
}
