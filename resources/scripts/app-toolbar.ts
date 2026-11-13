/**
 * Who this Mac belongs to, from the Mac itself.
 *
 * The account picture is the one piece of personalisation that costs the user
 * nothing to set up: they already chose it, at login, and every native app on
 * the machine shows it back to them. A window that scans your disks and lists
 * your processes and cannot say whose they are reads like a tool pointed at a
 * stranger's computer.
 *
 * The endpoint answers with a data URI or with nothing, and "nothing" is a
 * perfectly ordinary answer — plenty of accounts have no picture set. The
 * fallback is the initial, which is why the name is fetched even when the
 * image is not.
 */
function loadProfile(): void {
  const chip = document.querySelector<HTMLElement>('[data-profile-chip]')
  if (!chip)
    return

  fetch('/api/user-profile', { method: 'POST' })
    .then(r => r.json())
    .then((d: { success?: boolean, fullName?: string, shortName?: string, picture?: string | null, hostName?: string }) => {
      if (!d?.success)
        return

      const name = d.fullName || d.shortName || ''
      const label = chip.querySelector<HTMLElement>('[data-profile-name]')
      if (label && name)
        label.textContent = name

      const host = document.querySelector<HTMLElement>('[data-profile-host]')
      if (host && d.hostName)
        host.textContent = d.hostName

      const avatar = chip.querySelector<HTMLElement>('[data-profile-picture]')
      if (!avatar)
        return

      if (d.picture) {
        const img = document.createElement('img')
        img.src = d.picture
        img.alt = ''
        avatar.replaceChildren(img)
      }
      else if (name) {
        // The initial, not a generic silhouette: a letter that is *yours* still
        // personalises the corner, and a grey bust does not.
        avatar.textContent = name.trim().charAt(0).toUpperCase()
      }

      chip.title = [name, d.hostName].filter(Boolean).join(' · ')
    })
    .catch(() => {})
}

/**
 * The count on Updates, in two places.
 *
 * Promoting Updates out of the rail cost it the scanning dot the rail gives
 * its items, and an errand you cannot see the size of is one you never run.
 * Moving it again, into a menu, would have cost it the badge as well — a
 * number nobody opens the menu to find is the same as no number.
 *
 * So the count stays on the item and a dot goes on the chip that opens it.
 * The dot says only "there is something in here", which is all a closed menu
 * can honestly say and all it needs to.
 *
 * The summary endpoint is cached on the agent side, so this is cheap enough to
 * ask for on every load.
 */
function loadUpdateCount(): void {
  const badge = document.querySelector<HTMLElement>('[data-updates-badge]')
  const dot = document.querySelector<HTMLElement>('[data-updates-dot]')
  if (!badge)
    return

  fetch('/api/updates-summary', { method: 'POST' })
    .then(r => r.json())
    .then((d: { success?: boolean, total?: number }) => {
      const total = d?.success ? (d.total || 0) : 0
      badge.textContent = total > 99 ? '99+' : String(total)
      badge.toggleAttribute('hidden', total === 0)
      dot?.toggleAttribute('hidden', total === 0)
    })
    .catch(() => {})
}

/**
 * The account menu.
 *
 * A `role="menu"` rather than a popover of links, because that is what it is:
 * one control that opens a short list, closes on Escape, on a click outside,
 * on a choice, and on navigating away. Arrow keys move between items — a menu
 * that traps the keyboard at its first item is a menu only the mouse can use.
 *
 * Bound directly rather than delegated: this bar is rendered once into the
 * shell and outlives every SPA navigation, so there is no second copy to
 * rebind to and nothing to go stale.
 */
function menuParts(): { chip: HTMLElement, menu: HTMLElement } | null {
  const chip = document.querySelector<HTMLElement>('[data-profile-chip]')
  const menu = document.querySelector<HTMLElement>('[data-profile-menu]')
  return chip && menu ? { chip, menu } : null
}

function menuIsOpen(): boolean {
  const parts = menuParts()
  return !!parts && !parts.menu.hasAttribute('hidden')
}

function setMenuOpen(open: boolean): void {
  const parts = menuParts()
  if (!parts)
    return

  parts.menu.toggleAttribute('hidden', !open)
  parts.chip.setAttribute('aria-expanded', String(open))
}

function closeMenu(options?: { restoreFocus?: boolean }): void {
  if (!menuIsOpen())
    return

  setMenuOpen(false)
  if (options?.restoreFocus)
    menuParts()?.chip.focus()
}

/** Every item, in the order they are drawn — the order the arrow keys follow. */
function menuItems(): HTMLElement[] {
  const menu = menuParts()?.menu
  return menu ? Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]')) : []
}

function focusMenuItem(step: number): void {
  const items = menuItems()
  if (!items.length)
    return

  const current = items.indexOf(document.activeElement as HTMLElement)
  // From the chip — nothing in the list focused yet — Down opens on the first
  // item and Up on the last, which is what an AppKit menu does.
  const next = current === -1
    ? (step > 0 ? 0 : items.length - 1)
    : (current + step + items.length) % items.length

  items[next].focus()
}

function onMenuKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && menuIsOpen()) {
    event.preventDefault()
    closeMenu({ restoreFocus: true })
    return
  }

  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')
    return

  // An arrow on the chip opens the menu on its first or last item, which is
  // what a menu button does on every platform. Anywhere else with the menu
  // shut, the arrows are the page's.
  const target = event.target instanceof Element ? event.target : null
  const onChip = !!target?.closest('[data-profile-chip]')
  if (!menuIsOpen() && !onChip)
    return

  event.preventDefault()
  setMenuOpen(true)
  focusMenuItem(event.key === 'ArrowDown' ? 1 : -1)
}

function onDocumentPointerDown(event: Event): void {
  const target = event.target
  if (!(target instanceof Element) || !menuIsOpen())
    return

  // A click on the chip is the toggle's business, not the dismisser's.
  if (!target.closest('[data-profile]'))
    closeMenu()
}

function onMenuClick(event: Event): void {
  const target = event.target
  if (!(target instanceof Element))
    return

  if (target.closest('[data-profile-chip]')) {
    event.preventDefault()
    const opening = !menuIsOpen()
    setMenuOpen(opening)
    if (opening)
      focusMenuItem(1)
    return
  }

  // Anything picked inside the menu has done its job by the time it bubbles
  // here: a link is navigating, and Settings has raised its own event.
  if (target.closest('[role="menuitem"]'))
    closeMenu()
}

function wireMenu(): void {
  document.addEventListener('click', onMenuClick)
  document.addEventListener('pointerdown', onDocumentPointerDown)
  document.addEventListener('keydown', onMenuKeydown)
}

function syncTopNav(): void {
  const path = location.pathname
  for (const item of Array.from(document.querySelectorAll<HTMLAnchorElement>('[data-topnav-item]'))) {
    const href = item.getAttribute('href') || ''
    const selected = path === href || path.startsWith(`${href}/`)
    item.toggleAttribute('data-active', selected)
    if (selected)
      item.setAttribute('aria-current', 'page')
    else
      item.removeAttribute('aria-current')
  }
}

function syncSidebar(): void {
  const collapsed = document.documentElement.hasAttribute('data-sidebar-collapsed')
  document.querySelector('#app-sidebar')?.toggleAttribute('inert', collapsed)
  const toggle = document.querySelector<HTMLButtonElement>('[data-toolbar-sidebar]')
  if (!toggle) return
  toggle.setAttribute('aria-expanded', String(!collapsed))
  toggle.setAttribute('aria-label', collapsed ? 'Show Sidebar' : 'Hide Sidebar')
  toggle.title = `${collapsed ? 'Show' : 'Hide'} Sidebar (⌥⌘S)`
}

// Each entry owns its position. Keep the forward boundary per tab so a reload
// preserves availability without altering the router's navigation or scroll state.
const HISTORY_KEY = 'systemcleaner-toolbar-history'
let position = Number(history.state?.[HISTORY_KEY] ?? 0)
let end = position
try {
  if (typeof history.state?.[HISTORY_KEY] === 'number')
    end = Math.max(position, Number(sessionStorage.getItem(HISTORY_KEY) || 0))
}
catch { /* Availability still works for this document if storage is unavailable. */ }

function syncHistory(): void {
  const entry = history.state?.[HISTORY_KEY]
  if (typeof entry === 'number') position = entry
  else {
    position += 1
    end = position
  }
  history.replaceState({ ...history.state, [HISTORY_KEY]: position }, '')
  try { sessionStorage.setItem(HISTORY_KEY, String(end)) }
  catch { /* History itself remains available. */ }
  const back = document.querySelector<HTMLButtonElement>('[data-toolbar-back]')
  const forward = document.querySelector<HTMLButtonElement>('[data-toolbar-forward]')
  if (back) back.disabled = position <= 0
  if (forward) forward.disabled = position >= end
}

function wireToolbar(): void {
  if (!document.querySelector('.topnav')) return
  history.replaceState({ ...history.state, [HISTORY_KEY]: position }, '')
  document.querySelector('[data-toolbar-sidebar]')?.addEventListener('click', () => {
    document.documentElement.toggleAttribute('data-sidebar-collapsed')
  })
  document.querySelector('[data-toolbar-back]')?.addEventListener('click', () => history.back())
  document.querySelector('[data-toolbar-forward]')?.addEventListener('click', () => history.forward())
  new MutationObserver(syncSidebar).observe(document.documentElement, { attributes: true, attributeFilter: ['data-sidebar-collapsed'] })
  window.addEventListener('stx:navigate', () => {
    closeMenu()
    syncTopNav()
    syncHistory()
  })
  window.addEventListener('popstate', syncHistory)
  wireMenu()
  syncTopNav()
  syncSidebar()
  syncHistory()
  loadProfile()
  loadUpdateCount()
  setInterval(loadUpdateCount, 300_000)
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireToolbar, { once: true })
else wireToolbar()
