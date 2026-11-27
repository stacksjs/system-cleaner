/**
 * The application menu.
 *
 * Without one, a Craft app inherits AppKit's default menubar: the app name,
 * Edit and Window, with nothing of this app in it. Every screen is reachable
 * only by clicking the sidebar, there is no ⌘R, and Edit's Copy and Paste are
 * inert because nothing claimed the roles. That is the difference between an
 * app and a website in a window.
 *
 * `standardMenus.leading()` supplies the two menus every Mac app has and puts
 * them in the order AppKit requires — which is not a stylistic point. `set`
 * replaces the whole bar rather than merging into it, and AppKit takes the
 * *first* menu as the application menu and retitles it, so a bar that omits
 * them loses Copy and Paste and wears its own first menu under the app's name.
 * Both rules are in `docs/guide/desktop.md`; both cost a build here before they
 * were written down.
 */
import { menu, standardMenus, windowEvents } from '@stacksjs/desktop/browser'
import { openDashboard, openSettings } from '../lib/app-windows'
import { SECTIONS, SETTINGS_PATH, SIDEBAR_SHORTCUTS } from '../lib/sections'

type DashboardCommand = { action: 'navigate', href: string } | { action: 'rescan' | 'sidebar' }
const isTray = location.pathname === '/app/tray'
const dashboardChannel = new BroadcastChannel('systemcleaner-dashboard')
function inDashboard(command: DashboardCommand): boolean {
  if (!isTray) return false
  dashboardChannel.postMessage(command)
  return true
}
dashboardChannel.addEventListener('message', event => {
  if (isTray) return
  const command = event.data as DashboardCommand
  if (command.action === 'navigate') go(command.href)
  if (command.action === 'rescan') rescan()
  if (command.action === 'sidebar') toggleSidebar()
})

const SCREENS = [
  ...SIDEBAR_SHORTCUTS,
  ...SECTIONS.flatMap(section => section.tools.map(({ label, href }) => ({ label, href, key: '' }))),
].filter((screen, index, all) => all.findIndex(other => other.href === screen.href) === index)

function openScreen(href: string): void {
  if (href === SETTINGS_PATH) {
    void openSettings()
    return
  }
  if (isTray) {
    // The dashboard might be closed. Bring its retained window forward, or
    // open it on the destination if this is the first use since launch.
    void openDashboard(href).then(() => inDashboard({ action: 'navigate', href }))
    return
  }
  go(href)
}

if (!isTray) {
  const rail = document.querySelector('#app-sidebar')
  const hint = (visible: boolean) => rail?.toggleAttribute('data-shortcuts-visible', visible)
  const reset = () => { hint(false) }
  const commandOnly = (event: KeyboardEvent) => event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey
  document.addEventListener('keydown', (event) => {
    const command = commandOnly(event)
    hint(command)
    if (!command || event.defaultPrevented || event.isComposing) return
    const screen = SIDEBAR_SHORTCUTS.find(({ key }) => key === event.key)
    if (!screen) return
    event.preventDefault()
    if (!event.repeat) openScreen(screen.href)
  }, true)
  document.addEventListener('keyup', (event) => { hint(event.key !== 'Meta' && commandOnly(event)) }, true)
  window.addEventListener('blur', reset)
  windowEvents.onBlur(reset)
  document.addEventListener('visibilitychange', () => { if (document.hidden) reset() })
}

/**
 * Go to a screen the way clicking the sidebar would.
 *
 * Through the router, so SPA navigation, the sidebar's active-state sync and
 * the scroll reset all happen, which a bare `location.href` would skip. Most
 * tools have no anchor in the sidebar any more, so clicking one is not an option.
 */
function go(href: string): void {
  if (location.pathname.replace(/\/$/, '') === href) return
  const router = (window as { stxRouter?: { navigate?: (url: string) => unknown } }).stxRouter
  if (typeof router?.navigate === 'function') {
    void router.navigate(href)
    return
  }
  const link = document.querySelector<HTMLAnchorElement>(`[data-rail-item][href="${href}"], a[data-stx-link][href="${href}"]`)
  if (link)
    link.click()
  else
    window.location.href = href
}

/** The toolbar and menu share this attribute; the toolbar observes it. */
function toggleSidebar(): void {
  if (inDashboard({ action: 'sidebar' })) return
  const root = document.documentElement
  const collapsed = root.hasAttribute('data-sidebar-collapsed')
  if (collapsed)
    root.removeAttribute('data-sidebar-collapsed')
  else
    root.setAttribute('data-sidebar-collapsed', 'true')
}

/** Re-run whatever the current screen calls a scan. */
function rescan(): void {
  if (inDashboard({ action: 'rescan' })) return
  const startDiskScan = (window as { startDiskScan?: () => void }).startDiskScan
  if (window.location.pathname === '/app/disk' && typeof startDiskScan === 'function') {
    startDiskScan()
    return
  }

  // The other screens keep their scan inside an x-data scope. Clicking the
  // screen's own button is the one path that is right for all of them and
  // cannot fall out of sync with what the button does.
  document.querySelector<HTMLElement>('[data-rescan]')?.click()
}

const APP_NAME = 'SystemCleaner'

// Not awaited: nothing on the page waits on the menubar, and a window with
// AppKit's default bar is still a working app. `set` resolves false rather
// than throwing when there is no bridge, which is the case on the marketing
// site — it renders this same shell in a browser.
/**
 * Put Settings in the application menu, where ⌘, lives on a Mac.
 *
 * `standardMenus.leading()` builds the app menu and Edit, and the app menu is
 * the only place this item belongs — AppKit users look under the app's own
 * name for it and nowhere else. Craft's bridge raises `craft:settings:open`
 * for its own Settings item; ours dispatches the same event through
 * `craft.settings.open()`, so the panel has one entry point no matter which
 * menu the click came from.
 *
 * Written defensively around the menu's shape: if a future
 * `standardMenus.leading()` returns something without an items array, the bar
 * is still worth setting without this one item in it.
 */
function withSettingsItem(menus: ReturnType<typeof standardMenus.leading>): typeof menus {
  const appMenu = menus[0] as { items?: unknown[] } | undefined
  if (!appMenu || !Array.isArray(appMenu.items))
    return menus

  const settings = {
    label: 'Settings…',
    shortcut: 'cmd+,',
    onClick: () => { void openSettings() },
  }

  // After About and its separator when there is one, which is where every Mac
  // app puts it; first otherwise.
  const separator = appMenu.items.findIndex(item => (item as { separator?: boolean }).separator)
  const at = separator === -1 ? 0 : separator + 1
  appMenu.items.splice(at, 0, settings, { separator: true })
  return menus
}

function installMenu(hasTray: boolean): void {
  void menu.set({
    menus: [
      ...withSettingsItem(standardMenus.leading(APP_NAME)),
      {
        label: 'View',
        items: [
          ...(hasTray ? [{ label: 'Menu Bar Stats', shortcut: 'cmd+shift+m', onClick: () => {
            const channel = new BroadcastChannel('systemcleaner-tray')
            channel.postMessage({ action: 'show' })
            channel.close()
          } }] : []),
          { label: 'Rescan', shortcut: 'cmd+r', onClick: rescan },
          { separator: true },
          { label: 'Hide Sidebar', shortcut: 'cmd+alt+s', onClick: toggleSidebar },
          { separator: true },
          ...SCREENS.map(screen => ({
            label: screen.label,
            ...(screen.key ? { shortcut: `cmd+${screen.key}` } : {}),
            onClick: () => openScreen(screen.href),
          })),
          { separator: true },
          { label: 'Enter Full Screen', role: 'fullscreen' as const },
        ],
      },
      standardMenus.window(),
    ],
  }).catch((error: unknown) => {
    console.warn('[app-menu] could not set the application menu:', error)
  })
}

void fetch('/api/platform', { method: 'POST', cache: 'no-store' })
  .then(response => response.json())
  .then((info: { platform?: string, sandbox?: { sandboxed?: boolean } }) => {
    // Native menu callbacks belong to the primary page. On macOS the tray
    // owns the app menu and routes dashboard commands to its retained window.
    const hasTray = info.platform === 'macos' && !info.sandbox?.sandboxed
    if (!hasTray || isTray) installMenu(hasTray)
  })
  .catch(() => installMenu(false))
