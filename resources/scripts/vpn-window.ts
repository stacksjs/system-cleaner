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

import { watchAppearance } from '../lib/appearance'

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

  watchAppearance()

}

if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', wire, { once: true })
else
  wire()
