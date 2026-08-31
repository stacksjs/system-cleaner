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
  { label: 'Dashboard', href: '/app' },
  { label: 'Startup Items', href: '/app/startup' },
  { label: 'Extensions', href: '/app/extensions' },
  { label: 'Processes', href: '/app/processes' },
  { label: 'Disk Usage', href: '/app/disk' },
  { label: 'Large Files', href: '/app/large-files' },
  { label: 'Duplicates', href: '/app/duplicates' },
  { label: 'Applications', href: '/app/applications' },
  { label: 'Maintenance', href: '/app/maintenance' },
  { label: 'Updates', href: '/app/updates' },
  { label: 'Quick Clean', href: '/app/cleanup' },
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
menu.set({
  menus: [
    ...standardMenus.leading(APP_NAME),
    {
      label: 'View',
      items: [
        { label: 'Rescan', shortcut: 'cmd+r', onClick: rescan },
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
