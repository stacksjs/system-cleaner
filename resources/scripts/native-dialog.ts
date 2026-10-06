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
/**
 * The sheet we draw ourselves when there is no host to ask.
 *
 * Deliberately not `window.confirm`. In a browser that works; in the packaged
 * app it is inert, and the packaged app is the one place a confirm has to be
 * right. One implementation that behaves the same in both beats two that
 * differ exactly where it matters.
 *
 * Returns the same `{ response }` shape the bridge does, so the caller reads
 * one result either way. Escape, the backdrop and Cancel all answer with the
 * cancel index; nothing resolves it twice.
 */
function inPageConfirm(
  options: ConfirmOptions,
  buttons: string[],
  cancelIndex: number,
): Promise<{ response: number }> {
  return new Promise((resolve) => {
    const host = document.createElement('div')
    host.setAttribute('data-native-confirm', '')
    host.style.cssText = 'position:fixed;inset:0;z-index:10000;display:grid;place-items:center;'
      + 'background:color-mix(in srgb, #000 32%, transparent);backdrop-filter:blur(2px);'

    const card = document.createElement('div')
    card.setAttribute('role', 'alertdialog')
    card.setAttribute('aria-modal', 'true')
    card.style.cssText = 'min-width:300px;max-width:min(420px,calc(100vw - 48px));'
      + 'padding:20px;border:.5px solid var(--line);border-radius:12px;'
      + 'background:var(--surface);color:var(--ink);box-shadow:var(--shadow);'
      + "font-family:-apple-system,'SF Pro Text',system-ui,sans-serif;"

    const h = document.createElement('div')
    h.textContent = options.title
    h.style.cssText = 'font-size:13px;font-weight:600;margin-bottom:6px;'
    card.appendChild(h)

    if (options.message) {
      const p = document.createElement('div')
      p.textContent = options.message
      p.style.cssText = 'font-size:12px;line-height:1.45;color:var(--secondary);margin-bottom:16px;'
      card.appendChild(p)
    }

    const row = document.createElement('div')
    row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;'

    let settled = false
    const done = (response: number) => {
      if (settled)
        return
      settled = true
      document.removeEventListener('keydown', onKey, true)
      host.remove()
      resolve({ response })
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        done(cancelIndex)
      }
    }

    buttons.forEach((label, i) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = label
      const isAction = i !== cancelIndex
      const tint = options.destructive ? 'var(--red)' : 'var(--accent)'
      b.style.cssText = 'padding:5px 14px;border-radius:6px;font:inherit;font-size:12px;'
        + 'font-weight:500;cursor:pointer;border:.5px solid var(--line);'
        + (isAction
          ? `background:${tint};color:#fff;border-color:transparent;`
          : 'background:var(--surface-soft);color:var(--ink);')
      b.addEventListener('click', () => done(i))
      row.appendChild(b)
    })

    card.appendChild(row)
    host.appendChild(card)
    // Clicking the backdrop is a dismissal; clicking the card is not.
    host.addEventListener('mousedown', (e) => { if (e.target === host) done(cancelIndex) })
    document.addEventListener('keydown', onKey, true)
    document.body.appendChild(host)

    const focusIndex = buttons.findIndex((_, i) => i !== cancelIndex)
    const first = row.children[focusIndex >= 0 ? focusIndex : 0] as HTMLButtonElement | undefined
    first?.focus()
  })
}

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
  const request = {
    type: (options.destructive ? 'warning' : 'question') as 'warning' | 'question',
    title: APP_NAME,
    message: options.title,
    detail: options.message,
    buttons,
    cancelButton: CANCEL,
  }

  // Ask the host directly when there is a host, rather than going through
  // `showMessageBox`'s fallback chain.
  //
  // That chain ends in `window.confirm`, and `window.confirm` inside a Craft
  // window is not a dialog — WKWebView only draws one if the host implements
  // `runJavaScriptConfirmPanel`, and when it does not the call returns `false`
  // immediately, having shown nothing. `showMessageBox` catches a failing
  // bridge, warns to a console nobody is reading, and falls through to exactly
  // that. So a broken bridge and a user pressing Cancel arrive at the caller as
  // the same `false`, and every confirm in the packaged app answered itself No:
  // Clean Selected did nothing, Empty Trash did nothing, and neither said why.
  //
  // Calling the bridge here lets its failure throw, so callers that already
  // handle a dialog that cannot be drawn can say so. And where there is no
  // bridge at all we draw our own sheet rather than trusting `confirm`, which
  // is the one path that is inert precisely where the app ships.
  type BoxResult = { response?: number, buttonIndex?: number }
  const bridge = (window as unknown as { craft?: { dialog?: { showMessageBox?: (o: typeof request) => Promise<BoxResult> } } }).craft?.dialog

  const raw: BoxResult = bridge?.showMessageBox
    ? await bridge.showMessageBox(request)
    : await inPageConfirm(options, buttons, CANCEL)

  // Craft answers `{ buttonIndex }`; the web shapes answer `{ response }`.
  // Nothing in the chain reconciled the two, so `const { response } = ...`
  // read `undefined` off every native dialog, `buttons[undefined]` was
  // `undefined`, and the comparison below said "not the action" no matter
  // which button was pressed. That is the whole reason a confirmed sheet
  // cleaned nothing: the dialog was drawn, the user pressed the action, and
  // the answer was discarded on the way back.
  //
  // Read both, and fall back to the cancel index when neither is a number, so
  // a host that answers in some third shape declines rather than proceeds.
  const index = typeof raw.response === 'number'
    ? raw.response
    : typeof raw.buttonIndex === 'number' ? raw.buttonIndex : CANCEL

  // Index into the array rather than comparing the number, so an index the
  // host never should have sent reads as "not the action" instead of as a
  // confirmation. Being wrong in that direction costs a second click; being
  // wrong in the other empties a folder nobody asked about.
  return buttons[index] === buttons[0]
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
