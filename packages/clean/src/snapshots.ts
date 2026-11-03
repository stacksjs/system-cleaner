import { appleScriptEscape, exec, isMacOS, shellEscape } from '@system-cleaner/core'

/**
 * Local APFS snapshots — the reclaimable space no other screen can see.
 *
 * Time Machine takes an hourly snapshot of the boot volume group and keeps
 * roughly a day's worth, and macOS takes one before every OS update. A
 * snapshot pins every block that existed when it was taken, so deleting a
 * 40 GB video reclaims nothing until the last snapshot referencing it is
 * gone. macOS counts that space as *purgeable*: free in principle, occupied
 * in fact, which is why the Finder and `df` disagree and why someone who has
 * just deleted a lot of data watches the number not move.
 *
 * See stacksjs/system-cleaner#33.
 *
 * ## Why there is no size here
 *
 * `LocalSnapshot` carries no byte count, and that is deliberate rather than
 * unfinished. A snapshot has no single size — what it costs is the set of
 * blocks *only it* still references, which changes every time another
 * snapshot is deleted. Two snapshots can each be holding the same 10 GB, so
 * the honest figure is per-snapshot reclaimable space, and neither
 * `tmutil` nor `diskutil apfs listSnapshots` reports it on current macOS
 * (checked on 26.3: the plist carries `Purgeable`, `LimitingContainerShrink`,
 * name, UUID and XID, and no size at all).
 *
 * So this reports what APFS will actually tell us — how many there are, when
 * each was taken, and whether APFS considers it purgeable — and leaves the
 * total unstated. The orphan scanner learned the same lesson the hard way in
 * #26: a number this app cannot stand behind is worse than no number, because
 * the user acts on it.
 */

/** What made a snapshot, which decides whether it is ours to remove. */
export type SnapshotKind = 'time-machine' | 'os-update' | 'other'

export interface LocalSnapshot {
  /** The APFS snapshot name, e.g. `com.apple.TimeMachine.2026-11-03-091500.local`. */
  name: string
  uuid: string
  /** The mount point it was found on. */
  volume: string
  kind: SnapshotKind
  /**
   * The `YYYY-MM-DD-HHMMSS` stamp `tmutil deletelocalsnapshots` takes, when
   * the name encodes one. Empty for anything else — an OS update snapshot is
   * named after a content hash and has no date in it.
   */
  date: string
  /** Parsed from `date`, in local time, since that is how the name is written. */
  createdAt: Date | null
  /** APFS's own verdict on whether removing it would return blocks. */
  purgeable: boolean
  /** APFS says this is the snapshot stopping the container from shrinking. */
  limitingContainerShrink: boolean
  /** The volume would boot from, or revert to, this snapshot. */
  rootTo: boolean
  revertTo: boolean
  /**
   * True when `tmutil` lists it too, which is the only thing that makes it
   * safe for this app to delete — see `deleteLocalSnapshots`.
   */
  timeMachineManaged: boolean
}

export interface LocalSnapshotScan {
  snapshots: LocalSnapshot[]
  /** Volumes that were asked. Present so the UI can say what was checked. */
  volumes: string[]
  /**
   * True when the scan could not run at all, as opposed to running and
   * finding nothing. An empty list means "no snapshots"; this means "no
   * answer", and the two must not render the same way.
   */
  unavailable: boolean
  /** Why, when `unavailable`. */
  reason?: string
}

/**
 * The mount points worth asking about.
 *
 * `/` is the sealed system volume and holds the OS update snapshots. The
 * user's data is on `/System/Volumes/Data`, which is where Time Machine's
 * hourly snapshots land. Asking only one of the two misses half the picture:
 * on the machine this was written on, `tmutil listlocalsnapshots /` was empty
 * while `diskutil apfs listSnapshots /` held an OS update snapshot marked
 * `LimitingContainerShrink`.
 */
export const SNAPSHOT_VOLUMES: readonly string[] = ['/', '/System/Volumes/Data']

/** `YYYY-MM-DD-HHMMSS`, which is the whole of what `tmutil` accepts. */
const SNAPSHOT_DATE = /^\d{4}-\d{2}-\d{2}-\d{6}$/

/** `com.apple.TimeMachine.2026-11-03-091500.local`, with or without the suffix. */
const TIME_MACHINE_NAME = /^com\.apple\.TimeMachine\.(\d{4}-\d{2}-\d{2}-\d{6})(?:\.local)?$/

/**
 * Classify a snapshot by its name, and pull out the date if it has one.
 *
 * Exported for the tests: the names are the entire contract with `tmutil`,
 * and a classifier that quietly returns `other` for a Time Machine snapshot
 * would present it as undeletable rather than failing visibly.
 */
export function classifySnapshot(name: string): { kind: SnapshotKind, date: string } {
  const tm = TIME_MACHINE_NAME.exec(name)
  if (tm)
    return { kind: 'time-machine', date: tm[1] }

  if (name.startsWith('com.apple.os.update-'))
    return { kind: 'os-update', date: '' }

  return { kind: 'other', date: '' }
}

/**
 * `YYYY-MM-DD-HHMMSS` as a local-time Date.
 *
 * Built field by field rather than handed to `new Date(string)`, which reads
 * `2026-11-03` as UTC midnight and would shift every row by the machine's
 * offset — enough to put an hourly snapshot on the wrong day.
 */
export function snapshotDateToDate(date: string): Date | null {
  if (!SNAPSHOT_DATE.test(date))
    return null

  const year = Number(date.slice(0, 4))
  const month = Number(date.slice(5, 7))
  const day = Number(date.slice(8, 10))
  const hour = Number(date.slice(11, 13))
  const minute = Number(date.slice(13, 15))
  const second = Number(date.slice(15, 17))

  const parsed = new Date(year, month - 1, day, hour, minute, second)
  // `new Date(2026, 12, 40)` rolls over rather than failing, so check that
  // what came back is the date that went in.
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day)
    return null

  return parsed
}

interface DiskutilSnapshot {
  SnapshotName?: unknown
  SnapshotUUID?: unknown
  Purgeable?: unknown
  LimitingContainerShrink?: unknown
  RootTo?: unknown
  RevertTo?: unknown
}

/**
 * What `diskutil` knows about one volume's snapshots.
 *
 * `-plist` piped through `plutil` rather than scraped from the human output,
 * whose indented tree would need a parser of its own and has changed shape
 * between releases. A mount point `diskutil` does not recognise prints
 * `Could not find disk for ...` and still exits 0, so the JSON parse failing
 * is a normal outcome here and not an error worth surfacing.
 */
async function snapshotsOnVolume(volume: string): Promise<LocalSnapshot[]> {
  const result = await exec(
    `diskutil apfs listSnapshots -plist ${shellEscape(volume)} 2>/dev/null | plutil -convert json -o - - 2>/dev/null`,
    { timeout: 20_000 },
  )
  if (!result.ok || !result.stdout.trim())
    return []

  let parsed: { Snapshots?: unknown }
  try {
    parsed = JSON.parse(result.stdout)
  }
  catch {
    return []
  }

  if (!Array.isArray(parsed.Snapshots))
    return []

  const snapshots: LocalSnapshot[] = []
  for (const entry of parsed.Snapshots as DiskutilSnapshot[]) {
    const name = typeof entry?.SnapshotName === 'string' ? entry.SnapshotName : ''
    if (!name)
      continue

    const { kind, date } = classifySnapshot(name)
    snapshots.push({
      name,
      uuid: typeof entry.SnapshotUUID === 'string' ? entry.SnapshotUUID : '',
      volume,
      kind,
      date,
      createdAt: date ? snapshotDateToDate(date) : null,
      purgeable: entry.Purgeable === true,
      limitingContainerShrink: entry.LimitingContainerShrink === true,
      rootTo: entry.RootTo === true,
      revertTo: entry.RevertTo === true,
      // Filled in by the caller, which is the only place that has tmutil's list.
      timeMachineManaged: false,
    })
  }

  return snapshots
}

/**
 * The dates `tmutil` admits to managing, across every mounted volume.
 *
 * This is the authority on what is deletable. A snapshot whose name looks
 * like Time Machine's but which `tmutil` does not list cannot be removed by
 * `deletelocalsnapshots`, and asking it to would fail with a message about a
 * date it does not recognise.
 */
async function timeMachineDates(): Promise<Set<string>> {
  const result = await exec('tmutil listlocalsnapshotdates 2>/dev/null', { timeout: 20_000 })
  if (!result.ok)
    return new Set()

  const dates = new Set<string>()
  for (const line of result.stdout.split('\n')) {
    const trimmed = line.trim()
    if (SNAPSHOT_DATE.test(trimmed))
      dates.add(trimmed)
  }
  return dates
}

/**
 * Every local snapshot on the boot volume group, newest first.
 *
 * Undated snapshots sort last rather than being dropped: an OS update
 * snapshot is often the one holding the most space, and a list that hides it
 * cannot explain why the disk is full.
 */
export async function listLocalSnapshots(): Promise<LocalSnapshotScan> {
  if (!isMacOS) {
    return {
      snapshots: [],
      volumes: [],
      unavailable: true,
      reason: 'Local snapshots are an APFS feature, and only macOS has one.',
    }
  }

  const [perVolume, managed] = await Promise.all([
    Promise.all(SNAPSHOT_VOLUMES.map(volume => snapshotsOnVolume(volume))),
    timeMachineDates(),
  ])

  // The same snapshot can be reported on both mount points of one volume
  // group. UUID is the identity; the first volume to report it keeps it.
  const seen = new Set<string>()
  const snapshots: LocalSnapshot[] = []
  for (const found of perVolume) {
    for (const snapshot of found) {
      const key = snapshot.uuid || `${snapshot.volume}:${snapshot.name}`
      if (seen.has(key))
        continue
      seen.add(key)
      snapshots.push({
        ...snapshot,
        timeMachineManaged: snapshot.kind === 'time-machine' && managed.has(snapshot.date),
      })
    }
  }

  snapshots.sort((a, b) => {
    const at = a.createdAt ? a.createdAt.getTime() : -1
    const bt = b.createdAt ? b.createdAt.getTime() : -1
    if (at !== bt)
      return bt - at
    return a.name.localeCompare(b.name)
  })

  return { snapshots, volumes: [...SNAPSHOT_VOLUMES], unavailable: false }
}

export interface SnapshotDeleteResult {
  succeeded: string[]
  failed: { date: string, error: string }[]
  /** True when a password dialog was raised to finish the job. */
  elevated: boolean
}

/**
 * Delete Time Machine local snapshots by date.
 *
 * **Only Time Machine's.** There is no call here for `diskutil apfs
 * deleteSnapshot`, which would also remove OS update snapshots and the sealed
 * system snapshot the Mac boots from. Deleting the first costs the user their
 * ability to roll back a bad OS update; deleting the second costs them the
 * Mac. `tmutil deletelocalsnapshots` refuses both by construction, which is
 * the reason it is the only tool used, and why the caller is expected to
 * filter on `timeMachineManaged` before getting here.
 *
 * Every date is validated against `SNAPSHOT_DATE` before it reaches a shell,
 * and then escaped twice over — once for `sh`, once for the AppleScript
 * string literal around it.
 *
 * ## The unelevated attempt first
 *
 * Whether this needs root has moved between macOS releases, and nothing
 * reports which answer the running machine gives. So it is asked rather than
 * guessed: run it plainly, and only on a permission failure raise the
 * password dialog. The same instinct as `runtimeSupports`, which reads the
 * Craft binary's flag table instead of trusting its version number.
 *
 * The elevated retry is a single `osascript` for every remaining date, not
 * one each. `removeStartupItems` learned that too: N system entries meant N
 * password prompts, and the second one reads as a bug.
 */
export async function deleteLocalSnapshots(dates: string[]): Promise<SnapshotDeleteResult> {
  const succeeded: string[] = []
  const failed: { date: string, error: string }[] = []
  const retry: string[] = []
  let elevated = false

  if (!isMacOS) {
    return {
      succeeded,
      failed: dates.map(date => ({ date, error: 'Local snapshots only exist on macOS' })),
      elevated,
    }
  }

  for (const date of dates) {
    if (!SNAPSHOT_DATE.test(date)) {
      failed.push({ date, error: 'Not a snapshot date' })
      continue
    }

    const result = await exec(`tmutil deletelocalsnapshots ${shellEscape(date)} 2>&1`, { timeout: 120_000 })
    if (result.ok) {
      succeeded.push(date)
      continue
    }

    const message = (result.stdout || result.stderr || '').trim()
    if (needsRoot(message))
      retry.push(date)
    else
      failed.push({ date, error: message.slice(0, 200) || 'Could not delete the snapshot' })
  }

  if (retry.length > 0) {
    elevated = true
    const inner = retry
      .map(date => `tmutil deletelocalsnapshots ${shellEscape(date)}`)
      .join('; ')

    const result = await exec(
      `osascript -e 'do shell script "${appleScriptEscape(inner)}" with administrator privileges'`,
      { timeout: 180_000 },
    )

    if (result.ok) {
      succeeded.push(...retry)
    }
    else {
      const error = cancelled(result.stderr)
        ? 'Cancelled at the password prompt'
        : (result.stderr || '').trim().slice(0, 200) || 'Could not delete the snapshots'
      for (const date of retry)
        failed.push({ date, error })
    }
  }

  return { succeeded, failed, elevated }
}

/**
 * Whether a `tmutil` failure was about rights rather than about the snapshot.
 *
 * Matched on the message because the exit code does not distinguish them:
 * `tmutil` exits 1 both for "you are not root" and for "no snapshot with
 * that date", and retrying the second behind a password prompt would ask for
 * a password to no purpose.
 */
function needsRoot(message: string): boolean {
  const lower = message.toLowerCase()
  return lower.includes('not permitted')
    || lower.includes('permission denied')
    || lower.includes('requires root')
    || lower.includes('must be run as root')
    || lower.includes('operation not permitted')
    || lower.includes('eperm')
}

/** `osascript` reports a dismissed password dialog as error -128. */
function cancelled(stderr: string): boolean {
  return stderr.includes('-128') || stderr.toLowerCase().includes('user canceled')
}
