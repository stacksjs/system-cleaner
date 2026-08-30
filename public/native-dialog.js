/**
 * Native confirm and alert, with a web fallback.
 *
 * `window.confirm` inside a Craft window draws WebKit's own dialog: a grey
 * sheet in the page's own font, with "OK"/"Cancel" and no way to name the
 * action. It is the one thing in this app that unmistakably is not a Mac app,
 * and it sits on every consequential action — deleting a folder, killing a
 * process, removing a launch daemon.
 *
 * `craft.dialog.showMessageBox` is an NSAlert: the app's icon, a real title and
 * body, buttons the app names, and a destructive button macOS tints red. It is
 * also modal to the window rather than to the page, so it cannot be missed
 * behind something.
 *
 * Both calls are async, because a native sheet is. Callers that used to branch
 * on `confirm()` need `await`.
 */
(function () {
  function hasNative() {
    return !!(window.craft && window.craft.dialog && typeof window.craft.dialog.showMessageBox === 'function');
  }

  /**
   * Ask a yes/no question. Resolves true when the user picks the action.
   *
   * `confirmLabel` names the button — "Delete", "Kill", "Update" — because a
   * dialog whose buttons read OK and Cancel makes the reader re-read the body
   * to work out which one does the thing.
   */
  window.nativeConfirm = async function (options) {
    var title = options.title || '';
    var message = options.message || '';
    var confirmLabel = options.confirmLabel || 'OK';

    if (!hasNative()) {
      // The web dialog has one string, so the title has to carry the question.
      return window.confirm(title + (message ? '\n\n' + message : ''));
    }

    try {
      var result = await window.craft.dialog.showMessageBox({
        type: options.destructive ? 'warning' : 'question',
        title: 'SystemCleaner',
        message: title,
        detail: message,
        buttons: [confirmLabel, 'Cancel'],
        defaultId: options.destructive ? 1 : 0,
        cancelId: 1,
      });
      return (result && result.response) === 0;
    }
    catch (_) {
      return window.confirm(title + (message ? '\n\n' + message : ''));
    }
  };

  /**
   * Put text on the pasteboard.
   *
   * `navigator.clipboard` in a WKWebView is gated on a user gesture the bridge
   * does not always carry, and fails silently when it is not — a Copy Path that
   * quietly does nothing. `craft.clipboard` is NSPasteboard and has no such
   * condition.
   */
  window.nativeCopy = async function (text) {
    if (window.craft && window.craft.clipboard && typeof window.craft.clipboard.writeText === 'function') {
      try {
        await window.craft.clipboard.writeText(text);
        return true;
      }
      catch (_) { /* fall through to the web path */ }
    }

    if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      }
      catch (_) {}
    }

    return false;
  };

  /**
   * Ask for a folder with the system's own open panel.
   *
   * Resolves the chosen path, or null when there is no native panel to open or
   * the user cancelled. Callers keep their own fallback for the browser.
   */
  window.nativeChooseFolder = async function (title) {
    if (!(window.craft && window.craft.dialog && typeof window.craft.dialog.showOpenDialog === 'function'))
      return null;

    try {
      var result = await window.craft.dialog.showOpenDialog({
        title: title || 'Choose a folder to scan',
        properties: ['openDirectory'],
        buttonLabel: 'Scan',
      });
      if (!result || result.canceled) return null;
      var paths = result.filePaths || [];
      return paths.length > 0 ? paths[0] : null;
    }
    catch (_) {
      return null;
    }
  };

  /** Report something that already happened and cannot be undone from here. */
  window.nativeAlert = async function (title, message) {
    if (!hasNative()) {
      window.alert(title + (message ? '\n\n' + message : ''));
      return;
    }

    try {
      await window.craft.dialog.showMessageBox({
        type: 'error',
        title: 'SystemCleaner',
        message: title,
        detail: message || '',
        buttons: ['OK'],
        defaultId: 0,
      });
    }
    catch (_) {
      window.alert(title + (message ? '\n\n' + message : ''));
    }
  };
})();
