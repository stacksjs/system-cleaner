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

/**
 * Screens the App Store edition rules out by an action rather than by a
 * platform capability. Checked against `sandbox.limits` before the map above.
 */
const SANDBOX_LIMIT_BY_ROUTE: Record<string, string> = {
  '/app/schedule': 'scheduledClean',
  '/app/vpn': 'vpn',
}

/**
 * Screens that read the person's home folder. In the App Store edition they
 * wait for the home folder grant, because before it they would scan the app's
 * own empty container and report a clean Mac.
 */
const NEEDS_HOME = new Set([
  '/app/cleanup',
  '/app/privacy',
  '/app/extensions',
  '/app/developer',
  '/app/disk',
  '/app/large-files',
  '/app/duplicates',
  '/app/similar',
  '/app/orphans',
  '/app/storage',
  '/app/clean',
  '/app/protection',
])

/**
 * Where a ruled-out screen can send the person instead. System Settings opens
 * from a link; the sandbox allows opening URLs.
 */
const ELSEWHERE: Record<string, { href: string, label: string }> = {
  startupItems: { href: 'x-apple.systempreferences:com.apple.LoginItems-Settings.extension', label: 'Open Login Items Settings' },
  vpn: { href: 'x-apple.systempreferences:com.apple.NetworkExtensionSettingsUI.NESettingsUIExtension', label: 'Open VPN Settings' },
}

const PLATFORM_LABEL: Record<string, string> = {
  macos: 'macOS',
  linux: 'Linux',
  windows: 'Windows',
}

/**
 * The Mac App Store edition. `limits` maps a capability or an action to the
 * sentence saying why the sandbox rules it out; it is empty in the direct
 * build.
 */
interface SandboxState {
  sandboxed: boolean
  homeGranted: boolean
  home: string
  limits: Record<string, string>
}

interface PlatformState {
  platform: string
  capabilities: Capabilities
  sandbox: SandboxState
}

const NO_SANDBOX: SandboxState = { sandboxed: false, homeGranted: true, home: '', limits: {} }

let cached: PlatformState | null = null
let inFlight: Promise<PlatformState | null> | null = null

async function load(): Promise<PlatformState | null> {
  if (cached) return cached
  if (inFlight) return inFlight

  inFlight = fetch('/api/platform', { method: 'POST' })
    .then(r => r.json())
    .then((r: { success?: boolean, platform?: string, capabilities?: Capabilities, sandbox?: SandboxState }) => {
      // An older agent has no /platform route. Treat that as "everything
      // works": this build only ever ran on macOS, so gating a screen on a
      // missing endpoint would hide a feature that is fine.
      if (!r || r.success !== true || !r.capabilities) return null
      cached = { platform: r.platform || 'unsupported', capabilities: r.capabilities, sandbox: r.sandbox || NO_SANDBOX }
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

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;').replace(/"/g, '&quot;')
}

/** A screen the App Store edition cannot offer, and why. */
function limitNotice(key: string, reason: string): string {
  const titles: Record<string, string> = {
    startupItems: 'Startup Items',
    appUninstall: 'Uninstalling apps',
    maintenance: 'Maintenance',
    trash: 'Emptying the Trash',
    scheduledClean: 'Scheduled Clean',
    vpn: 'VPN',
    processes: 'Processes',
  }
  const elsewhere = ELSEWHERE[key]
  return `
    <div class='offsite-shell' data-sandbox-limited='${escapeHtml(key)}'>
      <h1>${escapeHtml(titles[key] || 'This screen')} is not available in the App Store edition</h1>
      <p>${escapeHtml(reason)}</p>
      ${elsewhere ? `<a class='btn' href='${elsewhere.href}'>${escapeHtml(elsewhere.label)}</a>` : ''}
    </div>
  `
}

function folderName(home: string): string {
  return home.split('/').filter(Boolean).pop() || home
}

/**
 * What a home-folder screen shows in the App Store edition before the grant.
 * Says what will be read and that nothing leaves the Mac, because the Open
 * panel on its own reads as a request for everything.
 */
function grantNotice(home: string, message = ''): string {
  return `
    <div class='offsite-shell' data-home-grant>
      <span class='i-f7-folder-badge-person-crop' style='font-size: 40px; color: var(--accent);' aria-hidden='true'></span>
      <h1>Allow SystemCleaner to look in your home folder</h1>
      <p>
        Caches, logs, browsing traces and large files all live in your home
        folder, ${escapeHtml(folderName(home))}. macOS keeps apps from the App
        Store out of it until you choose it in an Open panel. SystemCleaner
        only reads it on this Mac, and deletes nothing until you say so.
      </p>
      ${message ? `<p data-home-grant-message>${escapeHtml(message)}</p>` : ''}
      <button class='btn' type='button' data-home-grant-button>Choose Home Folder&hellip;</button>
    </div>
  `
}

/**
 * The band the Overview carries until the home folder is granted. It sits
 * inside the hub, above the health ring, so it shares the page's width and
 * its fit-to-window sizing instead of pushing the page down from outside.
 */
function grantBanner(): string {
  return `
    <div class='sandbox-banner' data-home-grant-banner role='status'>
      <span class='sandbox-banner-tile' aria-hidden='true'><span class='i-f7-folder-badge-person-crop'></span></span>
      <span class='sandbox-banner-text'>
        <strong>Give SystemCleaner your home folder</strong>
        <span>Until you do, macOS keeps your caches and browsing traces out of these figures.</span>
      </span>
      <button class='sandbox-banner-button' type='button' data-home-grant-button>Choose Home Folder&hellip;</button>
    </div>
  `
}

interface FolderAccessReply {
  canceled?: boolean
  path?: string
  paths?: string[]
  backendUrl?: string
  backendError?: string
}

interface FolderAccessDialog {
  requestFolderAccess?: (options: Record<string, unknown>) => Promise<FolderAccessReply>
  revokeFolderAccess?: (path: string) => Promise<FolderAccessReply>
}

function folderDialog(): FolderAccessDialog | undefined {
  return (window as unknown as { craft?: { dialog?: FolderAccessDialog } }).craft?.dialog
}

function covers(folder: string, home: string): boolean {
  const trimmed = folder.replace(/\/+$/, '') || '/'
  return home === trimmed || home.startsWith(trimmed === '/' ? '/' : `${trimmed}/`)
}

/**
 * Ask for the home folder through Craft's Open panel.
 *
 * Craft keeps a security-scoped bookmark and restarts the agent so the new
 * process inherits the access, then answers with that agent's address. The
 * page reloads there; the agent remembers its port, so that is normally this
 * same address.
 */
async function grantHome(home: string): Promise<void> {
  const dialog = folderDialog()
  const main = document.querySelector('[data-stx-content]')
  if (!dialog?.requestFolderAccess) {
    if (main) main.innerHTML = grantNotice(home, 'This window cannot show an Open panel. Quit SystemCleaner and open it again.')
    return
  }

  const reply = await dialog.requestFolderAccess({
    title: 'Allow Access to Your Home Folder',
    message: `Choose your home folder, ${folderName(home)}, and click Allow. SystemCleaner reads it on this Mac only.`,
    buttonLabel: 'Allow',
    defaultPath: home,
  }).catch(() => null)
  if (!reply || reply.canceled || !reply.path) return

  if (!covers(reply.path, home)) {
    // A folder inside home is not enough for the targets under ~/Library, and
    // keeping it would leave a grant nobody can use. Give it back.
    await dialog.revokeFolderAccess?.(reply.path).catch(() => null)
    if (main) main.innerHTML = grantNotice(home, `That was ${reply.path}. Choose ${home} itself: the folder with the house icon, named ${folderName(home)}.`)
    return
  }

  if (reply.backendError) {
    if (main) main.innerHTML = grantNotice(home, 'Access was granted, but SystemCleaner could not restart to use it. Quit it and open it again.')
    return
  }

  let origin = window.location.origin
  try { if (reply.backendUrl) origin = new URL(reply.backendUrl).origin }
  catch { /* keep this origin */ }
  window.location.replace(`${origin}${window.location.pathname}`)
}

/**
 * Hide controls for actions the sandbox rules out, in place.
 *
 * Marked in the views with `data-sandbox-limit='<key>'`. Each is hidden and,
 * once per element, followed by a one-line note giving the reason, so a table
 * keeps its rows and loses only the button that would have failed.
 */
function applyElementLimits(sandbox: SandboxState): void {
  if (!sandbox.sandboxed) return
  // `data-sandbox-explain` marks a note the view placed itself, for a limit
  // whose controls repeat per row and so carry `data-sandbox-note='none'`.
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-sandbox-explain]'))) {
    const reason = sandbox.limits[el.getAttribute('data-sandbox-explain') || '']
    if (!reason || !el.hidden) continue
    el.textContent = reason
    el.hidden = false
  }
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-sandbox-limit]'))) {
    const key = el.getAttribute('data-sandbox-limit') || ''
    const reason = sandbox.limits[key]
    if (!reason || el.hasAttribute('data-sandbox-hidden')) continue
    // Hidden by a stylesheet rule rather than an inline style, which `x-show`
    // would overwrite the next time its condition changes.
    el.setAttribute('data-sandbox-hidden', '')
    if (el.getAttribute('data-sandbox-note') === 'none') continue
    const note = document.createElement('p')
    note.className = 'sandbox-note'
    note.textContent = reason
    el.after(note)
  }
}

let watchingLimits = false

/**
 * Controls marked for a limit can appear after the gate has run: a row
 * rendered by `x-for`, a pane the router swaps in. Only the App Store edition
 * watches for them, and at most once a frame.
 */
function watchElementLimits(sandbox: SandboxState): void {
  if (watchingLimits || !sandbox.sandboxed) return
  watchingLimits = true
  let queued = false
  new MutationObserver(() => {
    if (queued) return
    queued = true
    requestAnimationFrame(() => {
      queued = false
      applyElementLimits(sandbox)
    })
  }).observe(document.body, { childList: true, subtree: true })
}

/**
 * Mark a screen as gated, and for which route. The router swaps the screen's
 * contents on navigation, and the observer in `start` clears the mark only
 * when the route it was set for is no longer the one showing; a mark compared
 * against anything else can disagree with what `gate` decided and send the
 * two round a loop that never yields.
 */
function markGated(main: Element, key: string): void {
  main.setAttribute('data-platform-gated', key)
  main.setAttribute('data-platform-gated-route', currentRoute())
}

function currentRoute(): string {
  return window.location.pathname.replace(/\/+$/, '') || '/'
}

async function gate(): Promise<void> {
  const state = await load()
  if (!state) return

  const sandbox = state.sandbox
  if (sandbox.sandboxed) document.documentElement.setAttribute('data-app-store', '')
  applyElementLimits(sandbox)
  watchElementLimits(sandbox)

  const main = document.querySelector('[data-stx-content]')
  if (!main) return
  const route = currentRoute()

  if (sandbox.sandboxed) {
    const limitKey = SANDBOX_LIMIT_BY_ROUTE[route]
    if (limitKey && sandbox.limits[limitKey]) {
      if (main.getAttribute('data-platform-gated') === limitKey) return
      markGated(main, limitKey)
      main.innerHTML = limitNotice(limitKey, sandbox.limits[limitKey]!)
      return
    }
  }

  const feature = FEATURE_BY_ROUTE[route]
  if (feature && !state.capabilities[feature]) {
    // Marked so a second pass over the same screen does not rebuild it, and so
    // a test can tell a gated screen from an empty one.
    if (main.getAttribute('data-platform-gated') === feature) return
    markGated(main, feature)
    const reason = sandbox.sandboxed ? sandbox.limits[feature] : undefined
    main.innerHTML = reason ? limitNotice(feature, reason) : notice(feature, state.platform)
    return
  }

  if (!sandbox.sandboxed || sandbox.homeGranted) return

  if (route === '/app') {
    if (!main.querySelector('[data-home-grant-banner]'))
      (main.querySelector('.hub') ?? main).insertAdjacentHTML('afterbegin', grantBanner())
    return
  }

  if (NEEDS_HOME.has(route)) {
    if (main.getAttribute('data-platform-gated') === 'home') return
    markGated(main, 'home')
    main.innerHTML = grantNotice(sandbox.home)
  }
}

/** One listener for every grant button, wherever the gate put it. */
document.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement | null)?.closest?.('[data-home-grant-button]')
  if (!button || !cached) return
  event.preventDefault()
  ;(button as HTMLButtonElement).disabled = true
  void grantHome(cached.sandbox.home).finally(() => { (button as HTMLButtonElement).disabled = false })
})

function start(): void {
  void gate()

  // The router swaps the contents of [data-stx-content] without a page load,
  // so the gate has to run again on navigation. popstate alone misses a
  // pushState, which is how the rail navigates.
  window.addEventListener('popstate', () => { void gate() })

  const main = document.querySelector('[data-stx-content]')
  if (main) {
    new MutationObserver(() => {
      if (main.getAttribute('data-platform-gated-route') !== currentRoute()) {
        main.removeAttribute('data-platform-gated')
        main.removeAttribute('data-platform-gated-route')
      }
      void gate()
    }).observe(main, { childList: true })
  }
}

if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', start)
else
  start()
