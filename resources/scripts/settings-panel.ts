/**
 * Opening Settings, from the main window.
 *
 * Settings used to be a sheet drawn over the dashboard by this file. It is now
 * a window of its own — `/app/settings`, in `resources/views/app/settings.stx`
 * — because that is what Settings is on a Mac: its own window, opened by Cmd+,
 * and closed without disturbing what you were looking at. A sheet meant the app
 * could not be looked at while it was being configured, which is exactly when
 * you want to see what a setting changed.
 *
 * So what is left here is the opener, plus the half of the appearance work
 * that belongs to *this* window.
 *
 * Craft's bridge raises `craft:settings:open` when the application menu's
 * Settings item is picked, and `app-menu.ts` adds that item — so the menubar,
 * Cmd+, and the profile chip all arrive here as one event.
 */
import { openSettings } from '../lib/app-windows'
import { watchAppearance } from '../lib/appearance'

function wire(): void {
  // Delegated, because the chip that opens Settings lives in the top strip and
  // this script runs before nothing in particular — a delegated listener
  // cannot go stale across an SPA navigation.
  document.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof Element))
      return
    if (target.closest('[data-open-settings]')) {
      event.preventDefault()
      openSettings()
    }
  })

  // Craft's Settings item, this app's menu item, and the profile chip all land
  // here.
  window.addEventListener('craft:settings:open', openSettings)

  // Cmd+, from the page as well as from the menubar. Inside the window the
  // keystroke reaches the web view whenever the menu item is not what handled
  // it, and in a browser there is no menubar to carry it at all.
  document.addEventListener('keydown', (event) => {
    if (event.key === ',' && event.metaKey && !event.shiftKey && !event.altKey) {
      event.preventDefault()
      openSettings()
    }
  })

  watchAppearance()

}

if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', wire)
else
  wire()
