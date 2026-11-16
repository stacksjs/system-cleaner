/**
 * Warm each screen's data before it is opened.
 *
 * The router already prefetches a page's HTML. What it cannot know about is
 * the data the page asks for once it is on screen, and on a cold agent some of
 * that is slow: Developer Junk walks every project folder (about twelve
 * seconds), Installed Apps measures every app, the overview totals every
 * cache. The agent caches each of those answers, so asking early is enough:
 * by the time the screen opens, its request is answered from memory.
 *
 * Two triggers:
 *
 * - Intent. The pointer resting on a link (or keyboard focus reaching one)
 *   warms that screen at once. A pointer takes a few hundred milliseconds to
 *   travel and click; the cheap requests finish in that time and the slow
 *   ones get a head start.
 * - Idle. Once the window has been open and quiet for a moment, the slow
 *   screens are warmed one at a time, never in parallel, so the app is not
 *   competing with itself and the Mac is not asked to walk the disk twice.
 *
 * The agent coalesces overlapping requests, so a warm-up still running when
 * the screen opens is joined rather than repeated. Nothing here is sent while
 * the window is hidden, and every request is a read: nothing is cleaned,
 * changed or deleted.
 */

interface Warm {
  path: string
  body?: Record<string, unknown>
}

/** Quick Clean measures exactly the target list, so the warm-up must too. */
async function warmCleanupSizes(): Promise<void> {
  const response = await fetch('/api/cleanup-targets', { method: 'POST' })
  const data = await response.json() as { success?: boolean, targets?: { path: string }[] }
  if (!data.success || !data.targets?.length) return
  await post({ path: 'dir-sizes', body: { paths: data.targets.map(target => target.path) } })
}

/** What each screen asks for when it opens, by route. */
const SCREENS: Record<string, Array<Warm | (() => Promise<void>)>> = {
  '/app': [{ path: 'dashboard-stats' }, { path: 'updates-summary' }, { path: 'privacy-scan' }, { path: 'safe-to-clean' }],
  '/app/monitor': [{ path: 'dashboard-stats' }, { path: 'updates-summary' }],

  '/app/clean': [{ path: 'cleanup-history' }, { path: 'schedule' }, { path: 'safe-to-clean' }],
  '/app/cleanup': [{ path: 'system-disk-info' }, warmCleanupSizes],
  '/app/developer': [{ path: 'project-artifacts', body: {} }],
  '/app/orphans': [{ path: 'orphaned-data' }],
  '/app/schedule': [{ path: 'schedule' }, { path: 'cleanup-targets' }],

  '/app/storage': [{ path: 'dashboard-stats' }, { path: 'privacy-scan' }, { path: 'safe-to-clean' }],
  '/app/disk': [{ path: 'system-disk-info' }],
  '/app/large-files': [{ path: 'cleanup-history' }],

  '/app/performance': [{ path: 'dashboard-stats' }],
  '/app/startup': [{ path: 'startup-items' }],
  '/app/maintenance': [{ path: 'maintenance-tasks' }, { path: 'snapshots' }, { path: 'junk-scan' }],

  '/app/apps': [{ path: 'updates-summary' }, { path: 'extensions-list', body: {} }],
  '/app/applications': [
    { path: 'system-disk-info' },
    { path: 'installed-apps', body: {} },
    { path: 'installed-apps', body: { sizes: true } },
    { path: 'orphaned-data' },
    { path: 'updates-check', body: { tier: 'full' } },
  ],
  '/app/updates': [{ path: 'updates-check', body: { fullScan: false, forceRefresh: false, tier: 'quick' } }, { path: 'updates-check', body: { tier: 'full' } }],
  '/app/extensions': [{ path: 'extensions-list', body: {} }, { path: 'extensions-list', body: { sizes: true } }],

  '/app/protection': [{ path: 'privacy-scan' }, { path: 'permissions' }],
  '/app/privacy': [{ path: 'privacy-scan' }, { path: 'kept-cookies' }],
  '/app/permissions': [{ path: 'permissions' }],
  '/app/vpn': [{ path: 'vpn-status' }],
}

/**
 * The idle order, in two lanes. Developer Junk's project walk takes about
 * twelve seconds on its own, so it starts straight away in a lane of its own
 * (the agent stays responsive while it runs); everything else follows in a
 * second lane, slowest and most visited first.
 */
const IDLE_LANES: string[][] = [
  ['/app/developer'],
  ['/app/applications', '/app/clean', '/app/cleanup', '/app/orphans', '/app/extensions', '/app/updates', '/app/maintenance'],
]

/** A screen warmed recently is not warmed again; the agent's caches last minutes. */
const FRESH_MS = 90_000
const warmedAt = new Map<string, number>()

function post(warm: Warm): Promise<void> {
  return fetch(`/api/${warm.path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(warm.body ?? {}),
  }).then(response => response.arrayBuffer()).then(() => {}, () => {})
}

/**
 * `fromIdle` warms a screen at most once per window session: the idle pass
 * exists to save the first visit, not to keep caches topped up, which would
 * repeat slow walks for screens nobody opens. Intent may warm again once the
 * last warm-up is stale, because then someone is about to look.
 */
async function warm(route: string, fromIdle = false): Promise<void> {
  const steps = SCREENS[route]
  if (!steps || document.hidden) return
  const last = warmedAt.get(route) || 0
  if (fromIdle ? last > 0 : Date.now() - last < FRESH_MS) return
  warmedAt.set(route, Date.now())
  // In order, not in parallel: two requests for the same screen often share
  // a scan (the list, then its sizes), and the second is cheaper once the
  // first has landed.
  for (const step of steps) {
    if (document.hidden) return
    await (typeof step === 'function' ? step().catch(() => {}) : post(step))
  }
}

function routeOf(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null
  const link = target.closest<HTMLAnchorElement>('a[href^="/app"]')
  if (!link) return null
  const href = (link.getAttribute('href') || '').replace(/\/$/, '') || '/app'
  return href === location.pathname.replace(/\/$/, '') ? null : href
}

// Intent: the pointer arriving at a link, or focus reaching it by keyboard.
document.addEventListener('pointerover', (event) => {
  const route = routeOf(event.target)
  if (route) void warm(route)
}, { passive: true })
document.addEventListener('focusin', (event) => {
  const route = routeOf(event.target)
  if (route) void warm(route)
})

// Idle: after the window has settled, the slow screens, one at a time.
const idle = (callback: () => void): void => {
  const requestIdle = (window as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void }).requestIdleCallback
  if (typeof requestIdle === 'function') requestIdle(callback, { timeout: 4000 })
  else setTimeout(callback, 1500)
}

/** Guards against two idle passes running at once. */
let idleRunning = false
async function warmAll(): Promise<void> {
  if (idleRunning) return
  idleRunning = true
  await Promise.all(IDLE_LANES.map(async (lane) => {
    // A lane stops when the window is hidden; the next idle pass resumes
    // from the first screen it has not warmed yet.
    for (const route of lane) {
      if (document.hidden) return
      await warm(route, true)
    }
  }))
  idleRunning = false
}

// The menu bar popover loads this layout's scripts too; it has no screens to
// open, so it warms nothing.
if (location.pathname !== '/app/tray' && document.querySelector('#app-sidebar')) {
  setTimeout(() => idle(() => { void warmAll() }), 2500)
  // A window opened behind others starts hidden, and `warm` declines to run
  // while hidden; a lane cut short that way is picked up when it is shown.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden)
      idle(() => { void warmAll() })
  })
}
