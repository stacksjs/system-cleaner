import type { ProcessInfo } from './types'

/**
 * The running process list on Windows.
 *
 * `ps` does not exist there, so the macOS path in `processes.ts` returns an
 * empty list — which is why `processes` has been false in the capability map.
 * `tasklist` is in System32 and always present, and `/V` adds the two columns
 * that matter here: the owning user and cumulative CPU time.
 *
 * CPU *percentage* is the part `tasklist` cannot give. It reports total
 * processor time a process has used since it started, so a single reading
 * describes its whole life rather than this moment — the same mistake `ps`
 * makes on macOS, where summing lifetime averages put the dashboard at 50%
 * against a true 27.5%. Two readings an interval apart give the real figure.
 *
 * Everything here that interprets `tasklist` output is a pure function over
 * text, because the only machine that can run the command is the one this was
 * not written on.
 *
 * See stacksjs/system-cleaner#23.
 */

/** One process, as a single `tasklist /V` reading describes it. */
export interface TasklistRow {
  pid: number
  name: string
  user: string
  memoryKB: number
  /** Processor seconds used since the process started. */
  cpuSeconds: number
  /** Session 0 is where Windows runs services. */
  sessionNumber: number
}

/**
 * Split one CSV line as `tasklist /FO CSV` writes it.
 *
 * Every field is quoted, and a quote inside one is doubled. Window titles
 * carry commas routinely — "Inbox (3,412) - Outlook" — so splitting on commas
 * mangles the row and shifts every column after it.
 */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      }
      else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (ch === ',' && !inQuotes) {
      fields.push(current)
      current = ''
      continue
    }

    current += ch
  }

  fields.push(current)
  return fields
}

/**
 * `H:MM:SS` of processor time, as seconds.
 *
 * Hours are not padded and run past 24 on a long-lived service, so this counts
 * from the right rather than assuming three fixed fields.
 */
export function parseCpuTime(value: string): number {
  const parts = value.trim().split(':').map(p => Number.parseInt(p, 10))
  if (parts.some(p => !Number.isFinite(p)))
    return 0

  let seconds = 0
  let scale = 1
  for (let i = parts.length - 1; i >= 0; i--) {
    seconds += parts[i] * scale
    scale *= 60
  }
  return seconds
}

/** `12,345 K` as kilobytes. The thousands separator is locale-dependent. */
export function parseMemory(value: string): number {
  const digits = value.replace(/[^\d]/g, '')
  return digits ? Number.parseInt(digits, 10) : 0
}

/**
 * Parse `tasklist /FO CSV /NH /V` output.
 *
 * Columns: Image Name, PID, Session Name, Session#, Mem Usage, Status,
 * User Name, CPU Time, Window Title.
 */
export function parseTasklist(stdout: string): Map<number, TasklistRow> {
  const rows = new Map<number, TasklistRow>()

  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed)
      continue

    const f = parseCsvLine(trimmed)
    if (f.length < 8)
      continue

    const pid = Number.parseInt(f[1], 10)
    if (!Number.isFinite(pid))
      continue

    rows.set(pid, {
      pid,
      name: f[0],
      sessionNumber: Number.parseInt(f[3], 10) || 0,
      memoryKB: parseMemory(f[4]),
      user: f[6],
      cpuSeconds: parseCpuTime(f[7]),
    })
  }

  return rows
}

/**
 * Accounts Windows runs its own services under.
 *
 * Compared case-insensitively against the part after the domain, because the
 * domain is localised — `NT-AUTORITÄT\SYSTEM` on a German install.
 */
const SYSTEM_ACCOUNTS = new Set(['system', 'local service', 'network service'])

function isSystemAccount(user: string, sessionNumber: number): boolean {
  const account = (user.split('\\').pop() || user).trim().toLowerCase()
  // Session 0 is the services session; nothing a person interacts with runs
  // there.
  return SYSTEM_ACCOUNTS.has(account) || sessionNumber === 0
}

/**
 * Turn two readings into process metrics.
 *
 * `cpuPercent` is a share of one core, matching what `ps -o pcpu` reports on
 * macOS: a process saturating four cores reads as 400%, which is what the
 * existing UI and the `findHighCpuProcesses` threshold already expect.
 *
 * A process present only in the second reading started during the window and
 * has no earlier total to subtract, so it is reported at 0% rather than
 * credited with every second it had used before anyone looked.
 */
export function toProcessInfo(
  before: Map<number, TasklistRow>,
  after: Map<number, TasklistRow>,
  intervalMs: number,
  totalMemoryBytes: number,
): ProcessInfo[] {
  const seconds = intervalMs / 1000
  const processes: ProcessInfo[] = []

  for (const row of after.values()) {
    const previous = before.get(row.pid)
    // A pid can be reused after a process exits. A negative delta is the only
    // visible sign, and reporting it would be a wildly wrong percentage.
    const delta = previous ? row.cpuSeconds - previous.cpuSeconds : 0
    const cpuPercent = previous && delta > 0 && seconds > 0
      ? Math.round((delta / seconds) * 1000) / 10
      : 0

    const memoryBytes = row.memoryKB * 1024
    processes.push({
      pid: row.pid,
      name: row.name,
      // `tasklist` reports no command line. Inventing one from the image name
      // would make the UI's "full command" column a duplicate that looks like
      // a path.
      fullCommand: row.name,
      user: row.user,
      cpuPercent,
      memoryPercent: totalMemoryBytes > 0 ? Math.round((memoryBytes / totalMemoryBytes) * 1000) / 10 : 0,
      memoryMB: Math.round(memoryBytes / 1e6),
      isSystem: isSystemAccount(row.user, row.sessionNumber),
    })
  }

  return processes
}
