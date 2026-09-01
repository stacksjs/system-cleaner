/**
 * The application menu.
 *
 * Without one, a Craft app inherits AppKit's default menubar: the app name,
 * Edit and Window, with nothing of this app in it. Every screen is reachable
 * only by clicking the rail, there is no ⌘R, and Edit's Copy and Paste are
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
import { menu, standardMenus } from '@stacksjs/desktop/browser'

interface Screen {
  label: string
  href: string
}

/** The rail then the top strip, in the order the eye reads them, so ⌘1..⌘9 match. */
const SCREENS: Screen[] = [
  { label: 'Quick Clean', href: '/app/cleanup' },
  { label: 'Dashboard', href: '/app' },
  { label: 'Startup Items', href: '/app/startup' },
  { label: 'Processes', href: '/app/processes' },
  { label: 'Disk Usage', href: '/app/disk' },
  { label: 'Large Files', href: '/app/large-files' },
  { label: 'Duplicates', href: '/app/duplicates' },
  { label: 'Applications', href: '/app/applications' },
  { label: 'Extensions', href: '/app/extensions' },
  { label: 'Updates', href: '/app/updates' },
  { label: 'Maintenance', href: '/app/maintenance' },
  { label: 'Privacy', href: '/app/privacy' },
  { label: 'Schedule', href: '/app/schedule' },
]

/**
 * There are only nine of ⌘1..⌘9, and more screens than that.
 *
 * The first nine keep their shortcut, in rail order, so the numbers still
 * match what the eye sees. The rest are in the menu without one — which is
 * how AppKit itself handles a Window menu longer than the digits.
 */
const MAX_SHORTCUTS = 9

/**
 * Go to a screen the way clicking the rail would.
 *
 * Clicking the rail's own anchor keeps SPA navigation, the active-state sync
 * and the scroll reset that a bare `location.href` would all skip.
 */
function go(href: string): void {
  const link = document.querySelector<HTMLAnchorElement>(`[data-rail-item][href="${href}"]`)
  if (link)
    link.click()
  else
    window.location.href = href
}

/**
 * Collapse or restore the rail.
 *
 * Craft's toolbar has a sidebar button and it does nothing in this window.
 * It is wired to `toggleSidebar:` on an NSSplitViewController, which is what a
 * `--native-sidebar` window has; this app draws its own rail in the page and
 * asks the runtime only for the vibrancy behind it (`--web-sidebar-material`),
 * so there is no split view for that selector to act on and no event the page
 * can hear. Verified by clicking it against a build whose CSS does honour
 * `data-sidebar-collapsed`: the rail stayed put.
 *
 * So the menu carries the real one, on the shortcut every Mac app uses for it.
 * Setting the attribute is the whole job — the stylesheet takes the rail to
 * zero and the content column, which paints its own background, expands over
 * the material strip that was behind it.
 *
 * The attribute is the same one Craft stamps for native sidebars, deliberately:
 * if a future runtime does wire that button up for web sidebars, it will set
 * this and the two paths agree rather than fight.
 */
function toggleSidebar(): void {
  const root = document.documentElement
  const collapsed = root.hasAttribute('data-sidebar-collapsed')
  if (collapsed)
    root.removeAttribute('data-sidebar-collapsed')
  else
    root.setAttribute('data-sidebar-collapsed', 'true')
}

/** Re-run whatever the current screen calls a scan. */
function rescan(): void {
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
    onClick: () => openSettings('menu'),
  }

  // After About and its separator when there is one, which is where every Mac
  // app puts it; first otherwise.
  const separator = appMenu.items.findIndex(item => (item as { separator?: boolean }).separator)
  const at = separator === -1 ? 0 : separator + 1
  appMenu.items.splice(at, 0, settings, { separator: true })
  return menus
}

/**
 * Open the settings panel.
 *
 * `craft.settings.open()` dispatches `craft:settings:open` on the window,
 * which is the same event Craft raises for its own Settings item — so the
 * panel listens in one place. Off-bridge, in a browser, the event is
 * dispatched directly and the panel works the same way.
 */
function openSettings(source: string): void {
  const settings = (globalThis as { craft?: { settings?: { open?: (source: string) => void } } }).craft?.settings
  if (settings?.open) {
    settings.open(source)
    return
  }

  window.dispatchEvent(new CustomEvent('craft:settings:open', { detail: { source } }))
}

menu.set({
  menus: [
    ...withSettingsItem(standardMenus.leading(APP_NAME)),
    {
      label: 'View',
      items: [
        { label: 'Rescan', shortcut: 'cmd+r', onClick: rescan },
        { separator: true },
        { label: 'Hide Sidebar', shortcut: 'cmd+alt+s', onClick: toggleSidebar },
        { separator: true },
        ...SCREENS.map((screen, index) => ({
          label: screen.label,
          ...(index < MAX_SHORTCUTS ? { shortcut: `cmd+${index + 1}` } : {}),
          onClick: () => go(screen.href),
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
