import { nativeWindow } from '@stacksjs/desktop/browser'
import { openSettings } from '../lib/app-windows'
import { watchAppearance } from '../lib/appearance'
import { SETTINGS_PATH } from '../lib/sections'

let warming: Promise<void> | undefined

/** Fetch static Settings assets on the shared WebKit store while the dashboard is idle. */
function warmSettings(): void {
  if (warming || document.hidden || !nativeWindow.available) return
  warming = (async () => {
    const response = await fetch(SETTINGS_PATH)
    if (!response.ok) return
    const markup = new DOMParser().parseFromString(await response.text(), 'text/html')
    const assets = new Set(
      [...markup.querySelectorAll('link[rel="stylesheet"][href], script[src]')]
        .map(node => node.getAttribute('href') || node.getAttribute('src') || '')
        .filter(url => url.startsWith('/_stx/')),
    )
    await Promise.allSettled([...assets].map(async (url) => {
      const response = await fetch(url)
      if (response.ok) await response.arrayBuffer()
    }))
  })().catch(() => { warming = undefined })
}

function wire(): void {
  document.addEventListener('click', (event) => {
    const target = event.target
    if (target instanceof Element && target.closest('[data-open-settings]')) {
      event.preventDefault()
      void openSettings()
    }
  })

  window.addEventListener('craft:settings:open', () => { void openSettings() })
  document.addEventListener('keydown', (event) => {
    if (event.key === ',' && event.metaKey && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.defaultPrevented) {
      event.preventDefault()
      if (!event.repeat) void openSettings()
    }
  })

  watchAppearance()

  if (typeof window.requestIdleCallback === 'function')
    window.requestIdleCallback(warmSettings, { timeout: 2500 })
  else setTimeout(warmSettings, 750)
  document.addEventListener('visibilitychange', warmSettings)
}

if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', wire, { once: true })
else
  wire()
