/**
 * Replace a screen that cannot work here with a sentence saying so.
 *
 * Every screen scans something and reports what it found. When the commands
 * underneath are missing — `launchctl` and `mdfind` on Windows, `osascript` on
 * Linux — `exec` swallows the error and the screen renders its empty state. So
 * Quick Clean says 0 B recoverable and Startup Items shows no login items, and
 * both of those read as good news rather than as "this build cannot see".
 *
 * The map lives here rather than on each view because the views are
 * prerendered at build time and a `<script server>` block would freeze the
 * build machine's platform into the bundle forever. Host facts arrive over the
 * API and bind client-side; this is one of those facts.
 *
 * See stacksjs/system-cleaner#23.
 */

interface Capabilities {
  cleanTargets: boolean
  diskScan: boolean
  developerJunk: boolean
  appUninstall: boolean
  startupItems: boolean
  privacy: boolean
  maintenance: boolean
  processes: boolean
  trash: boolean
}

/**
 * Which capability each route needs.
 *
 * A route absent from this map is never gated — the Dashboard and Settings
 * have nothing to scan, so they work anywhere.
 */
const FEATURE_BY_ROUTE: Record<string, keyof Capabilities> = {
  '/app/cleanup': 'cleanTargets',
  '/app/startup': 'startupItems',
  '/app/processes': 'processes',
  '/app/disk': 'diskScan',
  '/app/large-files': 'diskScan',
  '/app/duplicates': 'diskScan',
  '/app/developer': 'developerJunk',
  '/app/applications': 'appUninstall',
  '/app/extensions': 'privacy',
  '/app/privacy': 'privacy',
  '/app/maintenance': 'maintenance',
  '/app/schedule': 'cleanTargets',
}

const PLATFORM_LABEL: Record<string, string> = {
  macos: 'macOS',
  linux: 'Linux',
  windows: 'Windows',
}

interface PlatformState {
  platform: string
  capabilities: Capabilities
}

let cached: PlatformState | null = null
let inFlight: Promise<PlatformState | null> | null = null

async function load(): Promise<PlatformState | null> {
  if (cached) return cached
  if (inFlight) return inFlight

  inFlight = fetch('/api/platform', { method: 'POST' })
    .then(r => r.json())
    .then((r: { success?: boolean, platform?: string, capabilities?: Capabilities }) => {
      // An older agent has no /platform route. Treat that as "everything
      // works": this build only ever ran on macOS, so gating a screen on a
      // missing endpoint would hide a feature that is fine.
      if (!r || r.success !== true || !r.capabilities) return null
      cached = { platform: r.platform || 'unsupported', capabilities: r.capabilities }
      return cached
    })
    .catch(() => null)
    .finally(() => { inFlight = null })

  return inFlight
}

function notice(feature: keyof Capabilities, platform: string): string {
  const label = PLATFORM_LABEL[platform] || 'this platform'
  const names: Record<keyof Capabilities, string> = {
    cleanTargets: 'Quick Clean',
    diskScan: 'Disk scanning',
    developerJunk: 'Developer Junk',
    appUninstall: 'Applications',
    startupItems: 'Startup Items',
    privacy: 'Privacy',
    maintenance: 'Maintenance',
    processes: 'Processes',
    trash: 'Trash',
  }

  // Deliberately says what it would have scanned. "Not supported" alone reads
  // as a bug, and the first thing anyone wants to know is whether their files
  // are being looked at or not.
  return `
    <div class='offsite-shell'>
      <h1>${names[feature]} is not available on ${label} yet</h1>
      <p>
        This screen needs platform support that this build does not have, so it
        is showing you nothing rather than an empty result that would look like
        a clean machine. No files were scanned and none were changed.
      </p>
      <a class='btn' href='https://github.com/stacksjs/system-cleaner/issues/23' target='_blank' rel='noreferrer'>
        Follow progress
      </a>
    </div>
  `
}

async function gate(): Promise<void> {
  const state = await load()
  if (!state) return

  const feature = FEATURE_BY_ROUTE[window.location.pathname]
  if (!feature) return
  if (state.capabilities[feature]) return

  const main = document.querySelector('[data-stx-content]')
  if (!main) return
  // Marked so a second pass over the same screen does not rebuild it, and so
  // a test can tell a gated screen from an empty one.
  if (main.getAttribute('data-platform-gated') === feature) return

  main.setAttribute('data-platform-gated', feature)
  main.innerHTML = notice(feature, state.platform)
}

function start(): void {
  void gate()

  // The router swaps the contents of [data-stx-content] without a page load,
  // so the gate has to run again on navigation. popstate alone misses a
  // pushState, which is how the rail navigates.
  window.addEventListener('popstate', () => { void gate() })

  const main = document.querySelector('[data-stx-content]')
  if (main) {
    new MutationObserver(() => {
      if (main.getAttribute('data-platform-gated') !== FEATURE_BY_ROUTE[window.location.pathname])
        main.removeAttribute('data-platform-gated')
      void gate()
    }).observe(main, { childList: true })
  }
}

if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', start)
else
  start()
