import { nativeWindow } from '@stacksjs/desktop/browser'

export const APPEARANCE_KEY = 'systemcleaner-appearance'
export const COLOR_MODES = ['system', 'light', 'dark'] as const
export type ColorMode = typeof COLOR_MODES[number]

function readAppearance(): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(APPEARANCE_KEY) || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  }
  catch {
    return {}
  }
}

export function currentColorMode(): ColorMode {
  const mode = readAppearance().colorMode
  return COLOR_MODES.includes(mode as ColorMode) ? mode as ColorMode : 'system'
}

let notifyChange: ((mode: ColorMode) => void) | undefined

function applyColorMode(mode: ColorMode): void {
  const root = document.documentElement
  const dark = mode === 'dark' || (mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  root.dataset.colorMode = mode
  root.dataset.theme = dark ? 'dark' : 'light'
  root.classList.toggle('dark', dark)
  void nativeWindow.setAppearance(mode)
  notifyChange?.(mode)
}

export function setColorMode(mode: ColorMode): void {
  localStorage.setItem(APPEARANCE_KEY, JSON.stringify({ ...readAppearance(), colorMode: mode }))
  applyColorMode(mode)
}

/** Each window owns its native appearance; all windows share the preference. */
export function watchAppearance(onChange?: (mode: ColorMode) => void): void {
  notifyChange = onChange
  const sync = () => applyColorMode(currentColorMode())
  window.addEventListener('storage', (event) => {
    if (event.key === APPEARANCE_KEY || event.key === null)
      sync()
  })
  window.addEventListener('focus', sync)
  window.addEventListener('craft:window:focus', sync)
  window.addEventListener('pageshow', sync)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible')
      sync()
  })
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (currentColorMode() === 'system')
      sync()
  })
  sync()
}
