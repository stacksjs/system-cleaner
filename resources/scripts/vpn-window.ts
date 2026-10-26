/**
 * The VPN window's native half.
 *
 * Everything this window *does* is in the page — the view owns its state and
 * its clock. What is left here is the two things a page cannot do for itself:
 * move a window that has no titlebar, and keep the window's native appearance
 * in step with the theme chosen in another window.
 *
 * Both are lifted from `settings-window.ts`, which is the other window in this
 * app with a hidden titlebar, rather than reinvented smaller.
 */
import { nativeWindow } from '@stacksjs/desktop/browser'

const APPEARANCE_KEY = 'systemcleaner-appearance'

type ColorMode = 'system' | 'light' | 'dark'

const COLOR_MODES: ColorMode[] = ['system', 'light', 'dark']

function currentColorMode(): ColorMode {
  try {
    const raw = localStorage.getItem(APPEARANCE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    const stored = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>).colorMode : null
    return COLOR_MODES.includes(stored as ColorMode) ? stored as ColorMode : 'system'
  }
  catch {
    // A private window, a cleared store, or someone else's JSON under our key.
    // The default is a correct answer to all three.
    return 'system'
  }
}

/**
 * Craft puts an NSVisualEffectView behind the whole web view, and AppKit
 * resolves that material against the *window's* appearance rather than the
 * page's. A dark page over a light material leaves the window buttons light
 * beside it, so the window has to be told which mode it is in — and told
 * again on every occasion it might have missed a change made elsewhere.
 */
function syncAppearance(): void {
  void nativeWindow.setAppearance(currentColorMode())
}

/**
 * Moving a window that has no titlebar.
 *
 * WebKit never implemented `-webkit-app-region: drag` — a WKWebView discards
 * the declaration, which is worse than rejecting it, because the stylesheet
 * then reads as though the window can be dragged while it cannot be moved at
 * all. `startDrag` hands the press to AppKit, which runs a real drag loop.
 *
 * The band that drags is the strip at the top, which is the one place this
 * window has no content of its own and the place the window buttons sit.
 */
function isDragSurface(target: EventTarget | null): boolean {
  if (!(target instanceof Element))
    return false
  // Anything pressable is not a handle, or the window would move whenever a
  // control was clicked and released a pixel off.
  if (target.closest('button, a, input, select, textarea, [role="button"]'))
    return false
  return !!target.closest('[data-window-drag]')
}

function wire(): void {
  document.addEventListener('mousedown', (event) => {
    if (event.button === 0 && isDragSurface(event.target))
      void nativeWindow.startDrag()
  })

  // Double-clicking a titlebar zooms the window, and this strip stands in for
  // one.
  document.addEventListener('dblclick', (event) => {
    if (isDragSurface(event.target))
      void nativeWindow.maximize()
  })

  // The theme is changed in the Settings window, so this one has to notice.
  // Three occasions, because none alone is enough: `storage` is the immediate
  // one, `focus` covers a change made while this window was behind, and the
  // call below covers a window opened after the change.
  window.addEventListener('storage', (event) => {
    if (event.key === APPEARANCE_KEY)
      syncAppearance()
  })
  window.addEventListener('focus', syncAppearance)
  window.addEventListener('craft:window:focus', syncAppearance)

  syncAppearance()
}

if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', wire, { once: true })
else
  wire()
