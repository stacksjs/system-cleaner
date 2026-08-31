/**
 * Native confirm, alert, folder picker, clipboard and notification.
 *
 * `window.confirm` inside a Craft window draws WebKit's own dialog: a grey
 * sheet in the page's font, with OK/Cancel and no way to name the action. It is
 * the one thing in this app that unmistakably is not a Mac app, and it sits on
 * every consequential action — deleting a folder, killing a process, removing a
 * launch daemon. An NSAlert has the app's icon, a real title and body, and
 * buttons the app names, and is modal to the window rather than to the page so
 * it cannot end up hidden behind something.
 *
 * The bridge detection, the web fallbacks and the try/catch around each call
 * live in `@stacksjs/desktop` now. What stays here is the part that is this
 * app's judgement rather than the framework's: what the buttons are called,
 * which action is destructive, and when a finished scan is worth a
 * notification.
 *
 * These are attached to `window` because their callers are `@click` handlers in
 * stx views and the two x-data scripts, none of which are modules.
 */
import { clipboard, notifications, showMessageBox, showOpenDialog } from '@stacksjs/desktop/browser'

const APP_NAME = 'SystemCleaner'

export interface ConfirmOptions {
  /** The question, as the bold first line of the sheet. */
  title: string
  /** The consequence, in the smaller second paragraph. */
  message?: string
  /** Names the action button — "Delete", "Kill", "Update". */
  confirmLabel?: string
  /** Tints the action red and makes Return mean Cancel. */
  destructive?: boolean
}

/**
 * Ask a yes/no question. Resolves true when the user picks the action.
 *
 * The action button is named after the action because a dialog whose buttons
 * read OK and Cancel makes the reader go back and re-read the body to work out
 * which one does the thing.
 */
async function nativeConfirm(options: ConfirmOptions): Promise<boolean> {
  const { response } = await showMessageBox({
    type: options.destructive ? 'warning' : 'question',
    title: APP_NAME,
    message: options.title,
    detail: options.message,
    buttons: [options.confirmLabel || 'OK', 'Cancel'],
    // A destructive default is the *safe* one: Return cancels. Confirming
    // still means button 0, which is what `showMessageBox` resolves.
    defaultButton: options.destructive ? 1 : 0,
    cancelButton: 1,
  })
  return response === 0
}

/** Report something that already happened and cannot be undone from here. */
async function nativeAlert(title: string, message?: string): Promise<void> {
  await showMessageBox({
    type: 'error',
    title: APP_NAME,
    message: title,
    detail: message,
    buttons: ['OK'],
  })
}

/**
 * Put text on the pasteboard.
 *
 * `navigator.clipboard` in a WKWebView is gated on a user gesture the bridge
 * does not always carry, and fails silently when it is not — a Copy Path that
 * quietly does nothing. NSPasteboard has no such condition, and `clipboard`
 * prefers it and falls back on its own.
 */
async function nativeCopy(text: string): Promise<boolean> {
  try {
    await clipboard.writeText(text)
    return true
  }
  catch {
    return false
  }
}

/**
 * Ask for a folder with the system's own open panel.
 *
 * Resolves the chosen path, or null when the user cancelled or there is no
 * panel to open.
 */
async function nativeChooseFolder(title?: string): Promise<string | null> {
  try {
    const result = await showOpenDialog({
      title: title || 'Choose a folder to scan',
      canChooseDirectories: true,
      buttonLabel: 'Scan',
    })
    return result.canceled ? null : (result.filePaths?.[0] ?? null)
  }
  catch {
    return null
  }
}

/**
 * Ask for one or more files or folders.
 *
 * The shredder needs this and the folder picker cannot give it: what people
 * want to erase is usually a handful of documents, not a directory. Same panel,
 * with files allowed and multiple selection on.
 */
async function nativeChooseItems(title?: string): Promise<string[]> {
  try {
    const result = await showOpenDialog({
      title: title || 'Choose files or folders',
      canChooseFiles: true,
      canChooseDirectories: true,
      multiSelections: true,
      buttonLabel: 'Choose',
    })
    return result.canceled ? [] : (result.filePaths ?? [])
  }
  catch {
    return []
  }
}

export interface AwayNotice {
  title: string
  body?: string
  /** How long the job actually took. */
  elapsedMs: number
  /** Below this, say nothing. Default 10s. */
  minMs?: number
}

/**
 * Tell the user a long job finished, but only if they looked away.
 *
 * A scan takes forty-five seconds, which is long enough to go and do something
 * else and miss the result — exactly what Notification Center is for. It is
 * also exactly the wrong thing when the window is in front: a banner announcing
 * something the user is already looking at is noise. Both conditions are
 * checked here rather than at the four call sites.
 */
async function notifyIfAway(options: AwayNotice): Promise<void> {
  if (options.elapsedMs < (options.minMs ?? 10_000))
    return
  if (document.hasFocus())
    return

  try {
    await notifications.show({ title: options.title, body: options.body || '' })
  }
  catch {
    // A refused notification permission is not worth surfacing: the result is
    // on screen either way.
  }
}

declare global {
  interface Window {
    nativeConfirm: typeof nativeConfirm
    nativeAlert: typeof nativeAlert
    nativeCopy: typeof nativeCopy
    nativeChooseFolder: typeof nativeChooseFolder
    nativeChooseItems: typeof nativeChooseItems
    notifyIfAway: typeof notifyIfAway
  }
}

window.nativeConfirm = nativeConfirm
window.nativeAlert = nativeAlert
window.nativeCopy = nativeCopy
window.nativeChooseFolder = nativeChooseFolder
window.nativeChooseItems = nativeChooseItems
window.notifyIfAway = notifyIfAway
