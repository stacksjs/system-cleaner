/**
 * The settings panel, and the ⌘, that opens it.
 *
 * Craft's bridge raises `craft:settings:open` when the application menu's
 * Settings item is picked, and `craft.settings.open()` dispatches the same
 * event from the page — so both entry points, the menu item this app adds in
 * `app-menu.ts` and the profile chip in the top strip, arrive here as one
 * event. Listening for the event rather than reaching for the bridge is also
 * what lets the panel work in a browser, where the marketing site renders this
 * same shell and there is no bridge at all.
 *
 * Markup lives in `resources/components/SettingsPanel.stx`. This file is only
 * the wiring: what each control reads, what it writes, and where that lands.
 */
import { nativeAutoLaunch } from '@stacksjs/desktop/browser'

/**
 * Where the appearance bootstrap keeps its state.
 *
 * `@appearanceBootstrap` in the layout reads this key before first paint and
 * applies the result to the root element. It has always read it; nothing has
 * ever written it, so the colour mode has been stuck on `system` since the
 * shell was built. Writing the same shape it reads is the whole integration —
 * there is no second source of truth to keep in step.
 */
const APPEARANCE_KEY = 'systemcleaner-appearance'

/** Keys this panel owns that are the app's own preference, not appearance. */
const PREFS_KEY = 'systemcleaner-preferences'

type ColorMode = 'system' | 'light' | 'dark'

const COLOR_MODES: ColorMode[] = ['system', 'light', 'dark']

function readJson(key: string): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  }
  catch {
    // A private window, a cleared store, or something else's JSON under our
    // key. Defaults are a correct answer to all three.
    return {}
  }
}

function writeJson(key: string, value: Record<string, unknown>): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  }
  catch {
    // Nothing to do and nothing worth saying: the control still moved, and the
    // setting simply will not survive the window.
  }
}

function currentColorMode(): ColorMode {
  const stored = readJson(APPEARANCE_KEY).colorMode
  return COLOR_MODES.includes(stored as ColorMode) ? stored as ColorMode : 'system'
}

/**
 * The one piece of the window this page does not draw.
 *
 * Craft puts an NSVisualEffectView behind the whole web view, and AppKit
 * resolves that material against the *window's* appearance, not the page's.
 * Choosing dark here without saying so left a dark page washed over a light
 * material — and the window buttons, which AppKit also draws, stayed light
 * beside it.
 *
 * `setAppearance` is Craft's answer to that, and 'system' is a real value
 * rather than a synonym for light: it hands the window back to the Mac, so it
 * keeps following a sunset switch as it did before anything pinned it.
 *
 * Absent in a browser — the marketing site renders this same shell — and
 * absent in a Craft too old to have it. Optional chaining covers both; there
 * is nothing to fall back to and nothing that needs one.
 */
interface CraftWindowAppearance {
  window?: { setAppearance?: (appearance: ColorMode) => Promise<void> }
}

function applyNativeAppearance(mode: ColorMode): void {
  const craft = (window as unknown as { craft?: CraftWindowAppearance }).craft
  craft?.window?.setAppearance?.(mode)?.catch(() => {})
}

/**
 * Apply a colour mode now, the way the bootstrap applies it at load.
 *
 * Everything the bootstrap writes has to move together: the stylesheet keys
 * its palette off `:root.dark`, `data-color-mode` is what the bootstrap reads
 * back, and `data-theme` is the resolved answer for anything that wants it
 * without computing `prefers-color-scheme` itself. Writing some and not others
 * leaves the document disagreeing with itself — which it did, silently, for
 * `data-theme`: only the bootstrap ever set it, so it described the mode the
 * window opened in rather than the one it was in.
 *
 * This is a second copy of the bootstrap's rules, and a second copy is how
 * they came apart in the first place. `@appearanceBootstrap` publishes
 * `window.__stxAppearance` from the STX release after 0.2.258; when this app
 * is on it, this function and `setColorMode` below become calls to
 * `setColorMode` there and there is one implementation again.
 */
function applyColorMode(mode: ColorMode): void {
  const root = document.documentElement
  root.setAttribute('data-color-mode', mode)

  const dark = mode === 'dark'
    || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  root.classList.toggle('dark', dark)
  root.dataset.theme = dark ? 'dark' : 'light'
  applyNativeAppearance(mode)
}

function setColorMode(mode: ColorMode): void {
  const appearance = readJson(APPEARANCE_KEY)
  appearance.colorMode = mode
  writeJson(APPEARANCE_KEY, appearance)
  applyColorMode(mode)
  syncSegmented('colorMode', mode)
}

/** Follow the system while — and only while — the mode is `system`. */
function watchSystemAppearance(): void {
  const query = window.matchMedia('(prefers-color-scheme: dark)')
  query.addEventListener('change', () => {
    if (currentColorMode() === 'system')
      applyColorMode('system')
  })
}

function syncSegmented(id: string, value: string): void {
  const options = document.querySelectorAll<HTMLElement>(`[data-settings-option="${id}"]`)
  for (const option of Array.from(options)) {
    const selected = option.getAttribute('data-value') === value
    option.toggleAttribute('data-active', selected)
    option.setAttribute('aria-checked', String(selected))
  }
}

function syncSwitch(id: string, on: boolean): void {
  const control = document.querySelector<HTMLElement>(`[data-settings-switch="${id}"]`)
  if (!control)
    return
  control.toggleAttribute('data-on', on)
  control.setAttribute('aria-checked', String(on))
}

function readPref(key: string, fallback: boolean): boolean {
  const value = readJson(PREFS_KEY)[key]
  return typeof value === 'boolean' ? value : fallback
}

function writePref(key: string, value: boolean): void {
  const prefs = readJson(PREFS_KEY)
  prefs[key] = value
  writeJson(PREFS_KEY, prefs)
}

/**
 * The login item, which is the one switch here with a real system side.
 *
 * `nativeAutoLaunch` resolves false rather than throwing when there is no
 * bridge, and the *reported* state is what the switch shows — never the state
 * the user just asked for. A switch that slides to on when the write failed is
 * a lie the user only discovers at their next restart.
 */
async function syncOpenAtLogin(): Promise<void> {
  try {
    syncSwitch('openAtLogin', await nativeAutoLaunch.isEnabled())
  }
  catch {
    syncSwitch('openAtLogin', false)
  }
}

async function toggleOpenAtLogin(): Promise<void> {
  const control = document.querySelector<HTMLElement>('[data-settings-switch="openAtLogin"]')
  const wanted = !(control?.hasAttribute('data-on') ?? false)

  try {
    if (wanted)
      await nativeAutoLaunch.enable()
    else
      await nativeAutoLaunch.disable()
  }
  catch {
    // Fall through to the read below, which is the only thing that decides
    // what the switch shows.
  }

  await syncOpenAtLogin()
}

let lastFocused: Element | null = null

function panelElements() {
  return {
    scrim: document.querySelector<HTMLElement>('[data-settings-scrim]'),
    panel: document.querySelector<HTMLElement>('[data-settings-panel]'),
  }
}

function openPanel(): void {
  const { scrim, panel } = panelElements()
  if (!scrim || !panel)
    return

  lastFocused = document.activeElement
  scrim.removeAttribute('hidden')

  // Read every control from its real source on open rather than trusting what
  // the panel was showing when it was last closed — the login item in
  // particular can be changed from System Settings while this window is up.
  syncSegmented('colorMode', currentColorMode())
  syncSwitch('notifyOnFinish', readPref('notifyOnFinish', true))
  void syncOpenAtLogin()

  panel.querySelector<HTMLElement>('[data-settings-close]')?.focus()
}

function closePanel(): void {
  const { scrim } = panelElements()
  if (!scrim || scrim.hasAttribute('hidden'))
    return

  scrim.setAttribute('hidden', '')
  if (lastFocused instanceof HTMLElement)
    lastFocused.focus()
}

function isOpen(): boolean {
  const { scrim } = panelElements()
  return !!scrim && !scrim.hasAttribute('hidden')
}

/**
 * What the app calls itself, for the footer.
 *
 * `app.getInfo()` is the bridge's answer and there is none in a browser, so
 * the name already in the markup stands as the fallback.
 */
async function fillAbout(): Promise<void> {
  const slot = document.querySelector<HTMLElement>('[data-settings-about]')
  if (!slot)
    return

  try {
    const { app } = await import('@stacksjs/desktop/browser')
    const info = await app.getInfo()
    // `0.0.0` is what the package answers with when there is no bridge to ask
    // — a browser, or `bun run dev`. Printing it would put a version number in
    // the footer that is not this app's.
    if (info?.version && info.version !== '0.0.0')
      slot.textContent = `${info.name || 'SystemCleaner'} ${info.version}`
  }
  catch {
    // Leave the markup's own text.
  }
}

function wire(): void {
  // Delegated, because the panel is rendered once into the shell and this
  // script runs before nothing in particular — there is no second panel to
  // rebind to, and a delegated listener cannot go stale.
  document.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof Element))
      return

    if (target.closest('[data-open-settings]')) {
      event.preventDefault()
      openPanel()
      return
    }

    if (target.closest('[data-settings-close]')) {
      closePanel()
      return
    }

    // A click on the scrim itself, not on the panel sitting on top of it.
    const scrim = target.closest('[data-settings-scrim]')
    if (scrim && !target.closest('[data-settings-panel]')) {
      closePanel()
      return
    }

    const option = target.closest<HTMLElement>('[data-settings-option]')
    if (option) {
      const id = option.getAttribute('data-settings-option')
      const value = option.getAttribute('data-value')
      if (id === 'colorMode' && COLOR_MODES.includes(value as ColorMode))
        setColorMode(value as ColorMode)
      return
    }

    const toggle = target.closest<HTMLElement>('[data-settings-switch]')
    if (toggle) {
      const id = toggle.getAttribute('data-settings-switch')
      if (id === 'openAtLogin') {
        void toggleOpenAtLogin()
      }
      else if (id === 'notifyOnFinish') {
        const next = !toggle.hasAttribute('data-on')
        writePref('notifyOnFinish', next)
        syncSwitch('notifyOnFinish', next)
      }
      return
    }

    // A link in the panel goes to a screen, so the panel should not still be
    // sitting over it when the user gets there.
    if (target.closest('[data-settings-link]'))
      closePanel()
  })

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isOpen()) {
      event.preventDefault()
      closePanel()
    }
  })

  // Craft's Settings item, this app's menu item, and the profile chip all land
  // here.
  window.addEventListener('craft:settings:open', openPanel as EventListener)

  // ⌘, from the page as well as from the menubar. In a browser there is no
  // menubar to carry the shortcut, and inside the window the keystroke reaches
  // the web view whenever the menu item is not what handled it.
  document.addEventListener('keydown', (event) => {
    if (event.key === ',' && event.metaKey && !event.shiftKey && !event.altKey) {
      event.preventDefault()
      if (isOpen())
        closePanel()
      else
        openPanel()
    }
  })

  applyColorMode(currentColorMode())
  watchSystemAppearance()
  void fillAbout()
}

if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', wire)
else
  wire()
