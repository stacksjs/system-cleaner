import { nativeWindow } from '@stacksjs/desktop/browser'

/** The Settings window's identity. Craft keys existing windows on it. */
const SETTINGS_WINDOW = 'settings'

/**
 * Open Settings, or bring it forward.
 *
 * The name is what makes the second Cmd+, reach the first window: Craft looks
 * for a window already open under it and orders that one front instead of
 * building another. Everything else here describes the same kind of window the
 * app itself is — a hidden titlebar with the buttons over the sidebar, and one
 * native material behind the whole view for the page to paint its two surfaces
 * onto.
 *
 * In a browser — the marketing site renders this same shell — `nativeWindow`
 * falls back to a tab under the same name, which is the honest equivalent
 * there and needs no branch here.
 */
export function openSettings(): Promise<{ name: string }> {
  return nativeWindow.open({
    name: SETTINGS_WINDOW,
    title: 'Settings',
    url: new URL('/app/settings', window.location.origin).toString(),
    // System Settings' own proportions. Tall enough for the longest pane
    // without scrolling, narrow enough to sit beside the main window rather
    // than over it.
    width: 715,
    height: 640,
    // The sidebar is a fixed 250px, so there is a width below which the detail
    // pane stops being a pane and starts being a column of wrapped labels.
    minWidth: 660,
    minHeight: 460,
    titlebarHidden: true,
    // The material goes behind the *whole* view, not behind a leading strip.
    //
    // The strip is the closer description of what this window looks like, and
    // it is the wrong flag: Craft pins a sidebar-span material to
    // `NSAppearanceNameVibrantLight` and washes it with a fixed light tint, so
    // in dark mode the sidebar would be a pale band beside a dark page. The
    // window span carries no colour of its own, which leaves the page to paint
    // both surfaces — a translucent sidebar over the material, an opaque
    // content pane — and those flip with the theme because they are the page's
    // own tokens. It is the same arrangement the main window uses, and the
    // same reason.
    webWindowMaterial: true,
    // Craft draws a sidebar toggle and two history arrows beside the window
    // buttons on a web-sidebar window. Neither belongs here: System Settings'
    // sidebar does not collapse, and its back and forward live in the content
    // pane's toolbar — which is where this window draws its own. Left on,
    // there are two pairs of arrows in one window meaning different things.
    chromeControls: false,
    // The same website data store the main window uses. Craft's default is an
    // ephemeral store *per window*, so without this the Settings window would
    // write every preference somewhere only it can read, and lose them on
    // quit — which is exactly what it did.
    persistentStorage: true,
  })
}

/** Keep one full app window, including its scans and navigation, behind the tray. */
export function openDashboard(): Promise<{ name: string }> {
  return nativeWindow.open({
    name: 'dashboard', title: 'SystemCleaner', url: new URL('/app', location.origin).toString(),
    width: 1400, height: 900, minWidth: 900, minHeight: 650,
    titlebarHidden: true, webWindowMaterial: true, chromeControls: false, persistentStorage: true,
  })
}
