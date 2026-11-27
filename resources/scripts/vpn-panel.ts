import { nativeWindow } from '@stacksjs/desktop/browser'
import { registerVpnState } from '../lib/vpn'

registerVpnState()

/** The window's identity. Craft keys "is it already open?" on it. */
const VPN_WINDOW = 'vpn'

/**
 * Open the VPN window, or bring it forward.
 *
 * The name is what makes a second press reach the first window: Craft looks
 * for one already open under it and orders that one front rather than building
 * another.
 *
 * In a browser — where these views also render — `nativeWindow` falls back to
 * a tab under the same name, which is the honest equivalent there and needs no
 * branch here.
 */
function openVpnWindow(): void {
  void nativeWindow.open({
    name: VPN_WINDOW,
    title: 'VPN',
    url: new URL('/app/vpn-window', window.location.origin).toString(),
    width: 420,
    height: 680,
    minWidth: 340,
    minHeight: 490,
    titlebarHidden: true,
    // One material behind the whole view, which the page then washes in its
    // own colour — the same arrangement as the other two windows, and for the
    // same reason: a sidebar-span material is pinned to vibrant light and
    // would stay pale in dark mode.
    webWindowMaterial: true,
    // Craft's sidebar toggle and history arrows belong to a window that has a
    // sidebar and navigates. This one has neither.
    chromeControls: false,
    // The same website data store the other windows use. Craft's default is
    // ephemeral and per-window, which would hide the chosen theme from this
    // window and lose anything it remembers on quit.
    persistentStorage: true,
  })
}

function wire(): void {
  // Delegated, because the button that opens this lives on a screen the SPA
  // router swaps in and out — a direct listener would go stale on the first
  // navigation away from the VPN screen.
  document.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof Element))
      return
    if (target.closest('[data-open-vpn-window]')) {
      event.preventDefault()
      openVpnWindow()
    }
  })
}

if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', wire, { once: true })
else
  wire()
