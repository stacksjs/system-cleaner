/** The dedicated native tray page owns the status item and its popover. */
import { app, nativeWindow } from '@stacksjs/desktop/browser'
import { openDashboard, openSettings } from '../lib/app-windows'
import { watchAppearance } from '../lib/appearance'

// The published SystemTray wrapper does not expose setTitle, and sends object
// payloads where this Craft API takes strings/arrays. Use its documented tray API.
interface TrayBridge {
  setTitle: (title: string) => Promise<unknown>
  setIcon: (symbol: string) => Promise<unknown>
  setTooltip: (text: string) => Promise<unknown>
  setMenu: (items: TrayMenuItem[]) => Promise<unknown>
  onMenuAction: (callback: (detail: { action?: string }) => void) => unknown
}
type TrayMenuItem = { title: string, label: string, action: string } | { type: 'separator', separator: true }
interface TrayHost { tray?: TrayBridge, window?: { hide?: () => void, show?: () => void } }
const host = (window as unknown as { craft?: TrayHost }).craft

function report(error: unknown): void {
  window.dispatchEvent(new CustomEvent('systemcleaner:tray-error', { detail: error instanceof Error ? error.message : 'Could not open the window. Please try again.' }))
}

function hide(): void { host?.window?.hide?.() }
async function openApp(): Promise<void> {
  try {
    await app.showDockIcon()
    await openDashboard()
    hide()
  }
  catch (error) { report(error) }
}
async function settings(): Promise<void> {
  try {
    await openSettings()
    hide()
  }
  catch (error) { report(error) }
}

Object.assign(window, {
  trayOpenApp: openApp,
  trayOpenSettings: settings,
  trayHide: hide,
  trayQuit: () => app.quit(),
  trayUpdateTooltip: (summary: string) => host?.tray?.setTooltip(`SystemCleaner — ${summary}`),
})

async function install(): Promise<void> {
  watchAppearance()
  if (!nativeWindow.available || !host?.tray) return
  const response = await fetch('/api/platform', { method: 'POST', cache: 'no-store' })
  const info = await response.json() as { platform?: string }
  if (info.platform !== 'macos') return
  const tray = host.tray
  // AppKit tints the brand artwork as a template for the menu bar and selection.
  const icon = await fetch('/images/tray-template.png')
  if (!icon.ok) throw new Error('Could not load the SystemCleaner menu-bar icon.')
  const bytes = new Uint8Array(await icon.arrayBuffer())
  await tray.setIcon('data:image/png;base64,' + btoa(String.fromCharCode(...bytes)))
  await tray.setTitle('')
  await tray.setTooltip('SystemCleaner — live system stats')
  const item = (title: string, action: string): TrayMenuItem => ({ title, label: title, action })
  const channel = new BroadcastChannel('systemcleaner-tray')
  channel.addEventListener('message', event => {
    if (event.data?.action === 'show') host.window?.show?.()
  })
  await tray.setMenu([
    item('Open SystemCleaner', 'open-app'), item('Settings…', 'settings'),
    { type: 'separator', separator: true }, item('Refresh Stats', 'refresh-stats'),
    { type: 'separator', separator: true }, item('Quit SystemCleaner', 'quit'),
  ])
  tray.onMenuAction(({ action }) => {
    if (action === 'open-app') void openApp()
    if (action === 'settings') void settings()
    if (action === 'refresh-stats') window.dispatchEvent(new Event('systemcleaner:tray-refresh'))
    if (action === 'quit') void app.quit()
  })
  // Keep the full app's ordinary launch experience. Closing it leaves this
  // native tray page alive; reopening reuses the named window and its state.
  await openApp()
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { void install().catch(report) }, { once: true })
else void install().catch(report)
