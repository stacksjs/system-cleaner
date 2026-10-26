/**
 * The menu bar item: how much is safe to clean, and a button that cleans it.
 *
 * The number is the same set Quick Clean's Select All takes — `/safe-to-clean`
 * and `/clean-safe` both derive it from `safeCleanTargets()` on the server, so
 * the title cannot advertise an amount the button then declines to remove.
 *
 * ## Why this talks to `window.craft` directly
 *
 * The other scripts here go through `@stacksjs/desktop/browser` precisely so
 * they do not hand-roll bridge calls (see the note at the top of
 * `app-menu.ts`). This one cannot. `createSystemTray` returns an instance with
 * `setIcon`/`setTooltip`/`setMenu` and no way to set the status item's title,
 * and the title *is* this feature — a menu bar item that shows no number is
 * just a second way to open the app.
 *
 * It is also wrong against this Craft runtime. It calls the bridge with
 * wrapper objects, `setTitle({ title })` and `setMenu({ items })`, where Craft
 * takes a bare string and a bare array:
 *
 *     setTitle: function (t) { return _send('tray', 'setTitle', String(t)) }
 *     setMenu:  function (i) { return _send('tray', 'setMenu', _stringify(i || [])) }
 *
 * Run as the package calls it, the menu bar reads `[object Object]` and the
 * menu is dropped with `parseMenuJSON: root is not array`. Both confirmed
 * against craft-runtime with `--log-level debug`. So the bridge shape below is
 * the correct one, not a shortcut around the package.
 *
 * ## Why a page can own a menu bar item
 *
 * The launcher passes `--system-tray --keep-running`, so closing the window
 * leaves the process — and this page — alive. The webview is throttled when no
 * window is showing (timers drop to roughly 0.5 Hz, measured), which is why
 * nothing here depends on a tight interval: the poll is slow on purpose and
 * menu clicks arrive as events, which are not throttled.
 */

/**
 * The slice of Craft's tray bridge this uses.
 *
 * Declared here rather than taken from `CraftTrayAPI`, which the ambient
 * typings supply, because that interface has no `onMenuAction` — the runtime
 * ships it (it dispatches `craft:tray:menuAction`, and the handler is in the
 * injected bridge next to `onClick`), and without it there is no way to learn
 * that someone picked a menu item.
 */
interface TrayBridge {
  setTitle: (title: string) => Promise<unknown>
  setTooltip: (tooltip: string) => Promise<unknown>
  setMenu: (items: TrayMenuItem[]) => Promise<unknown>
  onMenuAction: (cb: (detail: { action?: string }) => void) => unknown
  onClick: (cb: () => void) => unknown
}

/**
 * Written with both spellings of every key, on purpose.
 *
 * Craft's own `MenuItem` typing documents `label` and `type: 'separator'`,
 * while the strings in the `parseMenuJSON` region of the runtime carry
 * `title`, `action` and `submenu` and no `label` at all. A menu built the
 * wrong way does not fail loudly — it parses, and renders rows with empty
 * names — so the two sources disagreeing is not something to resolve by
 * picking one and hoping. Both are set to the same value; the parser reads
 * whichever it knows and ignores the other.
 */
type TrayMenuItem =
  | { title: string, label: string, action: string, enabled?: boolean }
  | { separator: true, type: 'separator' }

/** What this needs off the rest of the bridge, beyond the tray itself. */
interface CraftShell {
  window?: { show: () => unknown, focus: () => unknown }
  app?: { quit: () => unknown, notify: (opts: Record<string, unknown>) => unknown }
}

/** Five minutes. The figure moves at the speed a cache directory fills. */
const POLL_MS = 5 * 60_000

/** Long enough for the agent's own startup work to be out of the way. */
const FIRST_REFRESH_MS = 3_000

/**
 * Binary units, matching the sizes every screen in the app prints.
 *
 * Kept to one decimal and no wider: NSStatusItem clips a title past about 20
 * characters, and the menu bar is the one place in this app where a long
 * string costs other apps their space rather than wrapping.
 */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0)
    return '0 B'

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }

  return `${unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

async function post<T>(endpoint: string): Promise<T | null> {
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    if (!res.ok)
      return null
    return await res.json() as T
  }
  catch {
    return null
  }
}

function install(tray: TrayBridge, craft: CraftShell): void {
  let busy = false

  /** What the menu says when there is nothing to do, so the row never vanishes. */
  function item(text: string, action: string, enabled = true): TrayMenuItem {
    return { title: text, label: text, action, enabled }
  }

  const separator: TrayMenuItem = { separator: true, type: 'separator' }

  function menuFor(bytes: number): TrayMenuItem[] {
    return [
      bytes > 0
        ? item(`Clean ${formatBytes(bytes)}`, 'clean')
        : item('Nothing to clean', 'none', false),
      separator,
      item('Open SystemCleaner', 'open'),
      item('Rescan', 'rescan'),
      separator,
      // `quit` is one of Craft's built-in actions, so this still works if the
      // page is too throttled to answer the event in time.
      item('Quit SystemCleaner', 'quit'),
    ]
  }

  async function refresh(): Promise<void> {
    const data = await post<{ bytes?: number, count?: number }>('/api/safe-to-clean')

    // A failed scan leaves the last good number rather than claiming 0 B.
    // Zero is a real answer here — "your Mac is clean" — and must not be what
    // a dropped request looks like.
    if (!data)
      return

    const bytes = Number(data.bytes) || 0
    await tray.setTitle(formatBytes(bytes))
    await tray.setTooltip(bytes > 0
      ? `SystemCleaner — ${formatBytes(bytes)} safe to clean in ${data.count ?? 0} location${data.count === 1 ? '' : 's'}`
      : 'SystemCleaner — nothing to clean')
    await tray.setMenu(menuFor(bytes))
  }

  async function clean(): Promise<void> {
    // The menu can be opened again while the sweep runs, and `cleanDirectory`
    // over the same paths twice is a race worth not having.
    if (busy)
      return
    busy = true

    try {
      await tray.setTitle('Cleaning…')
      const result = await post<{ freedBytes?: number, cleaned?: number, skipped?: number }>('/api/clean-safe')

      if (result) {
        const freed = Number(result.freedBytes) || 0
        craft.app?.notify({
          title: 'SystemCleaner',
          body: freed > 0
            ? `Freed ${formatBytes(freed)} from ${result.cleaned ?? 0} location${result.cleaned === 1 ? '' : 's'}.`
            : 'Nothing was removed.',
        })
      }
    }
    finally {
      busy = false
      await refresh()
    }
  }

  tray.onMenuAction((detail) => {
    switch (detail?.action) {
      case 'clean':
        void clean()
        break
      case 'open':
        craft.window?.show()
        craft.window?.focus()
        break
      case 'rescan':
        void refresh()
        break
      case 'quit':
        craft.app?.quit()
        break
    }
  })

  // Left-clicking the item opens the menu on its own in AppKit only when a
  // menu is attached; the click event still arrives, and bringing the window
  // back is the thing most likely to be wanted from a plain click.
  tray.onClick(() => {
    craft.window?.show()
    craft.window?.focus()
  })

  // Not immediately. The first measure is 68 `du` walks, and firing them while
  // the agent is still booting and the first screen is still fetching makes
  // them contend — each one that runs past its 15-second timeout reports 0
  // rather than an error, so the opening number comes out low. Measured at
  // launch it read 159 MB against a settled 197 MB. A couple of seconds of a
  // blank title costs nothing next to a wrong one.
  setTimeout(() => void refresh(), FIRST_REFRESH_MS)
  setInterval(() => void refresh(), POLL_MS)
}

declare global {
  interface Window {
    __systemCleanerTray?: boolean
  }
}

// Every app page loads this, and a full page load re-runs it. Registering the
// handlers twice would clean twice on one click.
if (!window.__systemCleanerTray) {
  // `window.craft` carries the ambient Craft typing, which describes the tray
  // without `onMenuAction`; this narrows to the shape used above. Absent
  // entirely in a browser and in a runtime built without tray support, and in
  // both cases the app is simply window-only.
  const craft = (window as { craft?: { tray?: unknown } & CraftShell }).craft

  if (craft?.tray) {
    window.__systemCleanerTray = true
    install(craft.tray as TrayBridge, craft)
  }
}

export {}
