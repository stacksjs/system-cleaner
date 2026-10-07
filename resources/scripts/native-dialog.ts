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

/**
 * Run a call that blocks on the user, with the bridge's reaper switched off.
 *
 * The injected bridge reaps every in-flight request after
 * `__craftBridgeRequestTimeoutMs` — 30s by default — and rejects it. That is
 * right for a native side that has gone quiet and wrong for a sheet the user
 * is still reading. Past 30s the answer is thrown away: the sheet is still up,
 * the user clicks the action, and the reply arrives to find no pending entry
 * and is dropped. The handler dies on the rejection with nothing on screen to
 * say so — the same silent nothing this file exists to stop.
 *
 * The bridge reads the knob once per call and treats 0 as "no reaper", and its
 * own comment names modal dialogs as the case for bumping it. Set it only
 * around these calls rather than globally, so a native call that really has
 * stranded anywhere else is still reaped. Depth-counted because the pickers go
 * through the same helper and a sheet can open over one.
 */
let decisionsInFlight = 0

async function whileUserDecides<T>(call: () => Promise<T>): Promise<T> {
  const host = window as unknown as { __craftBridgeRequestTimeoutMs?: number }
  const previous = host.__craftBridgeRequestTimeoutMs
  if (decisionsInFlight === 0)
    host.__craftBridgeRequestTimeoutMs = 0
  decisionsInFlight++
  try {
    return await call()
  }
  finally {
    decisionsInFlight--
    if (decisionsInFlight === 0) {
      if (previous === undefined)
        delete host.__craftBridgeRequestTimeoutMs
      else
        host.__craftBridgeRequestTimeoutMs = previous
    }
  }
}

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
  const buttons = [options.confirmLabel || 'OK', 'Cancel']
  const CANCEL = 1

  // `defaultButton` used to be `destructive ? 1 : 0` — the same index as
  // `cancelButton`, to make Return mean Cancel on a destructive question. Two
  // fields naming one button is a contradiction each side of the bridge is
  // free to resolve its own way, and they resolved it differently: the web
  // fallback special-cases the collision and still reports 0 for the action
  // button, while a host that puts its default button first can report the
  // action as 1. `response === 0` then reads a confirmed dialog as cancelled,
  // and the caller returns having done nothing at all — which is exactly what
  // Clean Selected did in the packaged app and never did in a browser.
  //
  // So say it once. `cancelButton` already carries the whole intent: Escape
  // dismisses, and a host that keys Return to the cancel button honours the
  // safe default without a second field to disagree about.
  // Ask the host for a yes/no, not for a button index.
  //
  // `showMessageBox` answers `{ response: n }`, and n does not mean what the
  // Electron-shaped type implies. Pressing the action button on
  // ['Clean Selected', 'Cancel'] returns 1 — the index of Cancel — so every
  // confirmed dialog read as a cancellation and the caller did nothing.
  //
  // Two readings fit that one observation: the host is 1-based
  // (NSAlertFirstButtonReturn), or it adds buttons in the AppKit order with
  // the default first. They disagree about what Cancel returns, and picking
  // wrong maps Cancel onto the destructive action. So do not pick: the bridge
  // also exposes `showConfirm`, documented as "true if OK was clicked, false
  // if cancelled", which carries no index to misread. It takes okLabel and
  // cancelLabel, so the action button keeps its name.
  // The injected `craft.dialog.showConfirm` takes a message STRING, not the
  // options object craft-native's own wrapper accepts — passing an object
  // renders "[object Object]" and falls back to OK/Cancel. So compose the
  // question and the consequence into one string.
  //
  // The cost is the named action button: this path can only offer OK/Cancel,
  // where `showMessageBox` could say "Clean Selected". That is a real loss and
  // it is worth it, because showMessageBox's answer cannot be trusted. It
  // returns `{ response: 1 }` when the action is pressed on a two-button
  // sheet, and the two readings that explain it — 1-based indexing, or AppKit
  // button order — disagree about what Cancel returns. Picking wrong maps
  // Cancel onto the destructive action. `showConfirm` answers a boolean, which
  // has no index to misread, so it cannot be wrong in that direction.
  const dialogApi = (window as unknown as {
    craft?: { dialog?: { showConfirm?: (message: string) => Promise<unknown> } }
  }).craft?.dialog

  if (typeof dialogApi?.showConfirm === 'function') {
    const prompt = options.message
      ? `${options.title}\n\n${options.message}`
      : options.title
    // Reaping this one would discard an answer the user did give; and an
    // error escaping here kills the @click handler that called us, with no
    // banner since a01d4c0 to show for it. Decline instead: a question we
    // could not hear the answer to is not a yes.
    let answer: unknown
    try {
      answer = await whileUserDecides(() => dialogApi.showConfirm!(prompt))
    }
    catch {
      return false
    }

    // Craft answers `{ ok: true }`, not a bare boolean — craft-native's own
    // wrapper reads `!!(payload && payload.ok === true)` for this exact
    // reason. Accept either, because the documented return type is boolean
    // and a host that honours it should also work.
    //
    // Everything else declines. A host answering in a third shape costs a
    // click; reading an unknown shape as consent costs a folder.
    if (answer === true)
      return true
    if (answer && typeof answer === 'object')
      return (answer as { ok?: unknown }).ok === true
    return false
  }

  // No showConfirm on this host. Fall back to the index comparison, which
  // reads the documented 0-based convention and so fails closed on a host
  // that means something else — a second click, rather than a deletion
  // nobody asked for.
  const raw = await whileUserDecides(() => showMessageBox({
    type: options.destructive ? 'warning' : 'question',
    title: APP_NAME,
    message: options.title,
    detail: options.message,
    buttons,
    cancelButton: CANCEL,
  }))
  const { response } = raw as { response?: number }

  // Index into the array rather than comparing the number, so an index the
  // host never should have sent reads as "not the action" instead of as a
  // confirmation. Being wrong in that direction costs a second click; being
  // wrong in the other empties a folder nobody asked about.
  return typeof response === 'number' && buttons[response] === buttons[0]
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
    const result = await whileUserDecides(() => showOpenDialog({
      title: title || 'Choose a folder to scan',
      canChooseDirectories: true,
      buttonLabel: 'Scan',
    }))
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
    const result = await whileUserDecides(() => showOpenDialog({
      title: title || 'Choose files or folders',
      canChooseFiles: true,
      canChooseDirectories: true,
      multiSelections: true,
      buttonLabel: 'Choose',
    }))
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
