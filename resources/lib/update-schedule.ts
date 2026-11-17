/**
 * When the automatic update check runs and when it speaks up. Kept apart from
 * `resources/scripts/auto-update.ts`, which does the asking, so the rules can
 * be tested without a window.
 */

export const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Ask GitHub only while the switch is on, only once a day across every
 * window, and never on a build that cannot update itself (a development
 * build, or a copy run from somewhere it cannot replace).
 */
export function shouldCheck(options: { enabled: boolean, lastCheckedAt: string, stage?: string, now?: number }): boolean {
  if (!options.enabled || options.stage === 'unsupported') return false
  const last = Date.parse(options.lastCheckedAt) || 0
  return (options.now ?? Date.now()) - last >= DAY_MS
}

/**
 * One notification per version, and only for a version that is on offer
 * rather than one already downloaded and waiting to install.
 */
export function shouldAnnounce(options: { enabled: boolean, stage?: string, version?: string | null, notifiedVersion: string }): boolean {
  return options.enabled && options.stage === 'available' && !!options.version && options.notifiedVersion !== options.version
}
