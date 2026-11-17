/**
 * When the app interrupts: a confirmation sheet before a delete, a banner
 * after a long scan, a notice after the scheduled clean. Each is governed by a
 * switch in Settings, and the rules for honouring those switches live here,
 * apart from the dialog and notification plumbing, so they can be tested
 * without a window.
 */

/**
 * Whether a delete has to be confirmed.
 *
 * "Confirm before deleting" can only waive the question for something that can
 * be put back: a move to the Trash. A permanent delete, an emptied Trash, a
 * shred, a cache cleaned for good, a force quit: those ask every time, switch
 * or no switch. A preference that turned an irreversible click into an
 * instant one would be a trap nobody remembers setting, and the caller has to
 * say an action is recoverable for the switch to apply at all, so a new
 * confirmation is safe by default.
 */
export function needsConfirmation(options: { recoverable?: boolean }, confirmDeletes: boolean): boolean {
  return options.recoverable !== true || confirmDeletes
}

/**
 * Whether a finished scan is worth a notification: the switch is on, the scan
 * took long enough to look away from, and the window is not the one in front.
 */
export function shouldNotifyAway(options: { enabled: boolean, elapsedMs: number, minMs?: number, focused: boolean }): boolean {
  if (!options.enabled)
    return false
  if (options.elapsedMs < (options.minMs ?? 10_000))
    return false
  return !options.focused
}

/**
 * What to do about the scheduled clean's latest run.
 *
 * - `announce`: a run this Mac has not been told about, with the switch on.
 * - `remember`: note it without a word. Either the switch is off, or this is
 *   the first look ever, which sets the baseline so a run from before this
 *   version is not announced as news.
 * - `ignore`: nothing has changed since the last look.
 *
 * `seenRunAt` is null only before the first look; after it, it is the last run
 * seen, or an empty string when there had never been one.
 */
export type ScheduledRunAction = 'announce' | 'remember' | 'ignore'

export function scheduledRunAction(options: { enabled: boolean, lastRunAt: string | null | undefined, seenRunAt: string | null }): ScheduledRunAction {
  if (options.seenRunAt === null)
    return 'remember'
  if (!options.lastRunAt || options.lastRunAt === options.seenRunAt)
    return 'ignore'
  return options.enabled ? 'announce' : 'remember'
}
