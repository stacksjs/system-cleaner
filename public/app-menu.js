/**
 * The application menu, and a notification for scans that outlast your
 * attention.
 *
 * Without `craft.menu.set` a Craft app inherits AppKit's default menubar:
 * SystemCleaner / Edit / View / Window, with nothing of the app in it. Every
 * screen is reachable only by clicking the rail, there is no ⌘R, and Edit's
 * Copy and Paste are inert because nothing claimed the roles. That is the
 * difference between an app and a website in a window.
 *
 * Menu picks arrive on `craft:menu:action`, the same channel the disk chart's
 * context menu uses, so ids here are prefixed `app.` and those are `sc.`.
 */
(function () {
  var VIEWS = [
    { id: 'dashboard', label: 'Dashboard', href: '/app', key: '1' },
    { id: 'startup', label: 'Startup Items', href: '/app/startup', key: '2' },
    { id: 'extensions', label: 'Extensions', href: '/app/extensions', key: '3' },
    { id: 'processes', label: 'Processes', href: '/app/processes', key: '4' },
    { id: 'disk', label: 'Disk Usage', href: '/app/disk', key: '5' },
    { id: 'large-files', label: 'Large Files', href: '/app/large-files', key: '6' },
    { id: 'system', label: 'System', href: '/app/system', key: '7' },
    { id: 'updates', label: 'Updates', href: '/app/updates', key: '8' },
    { id: 'cleanup', label: 'Quick Clean', href: '/app/cleanup', key: '9' },
  ];

  function hasMenu() {
    return !!(window.craft && window.craft.menu && typeof window.craft.menu.set === 'function');
  }

  /**
   * Go to a screen the way clicking the rail would.
   *
   * Clicking the rail's own anchor keeps SPA navigation, the active-state sync
   * and the scroll reset that a bare `location.href` would all skip.
   */
  function go(href) {
    var link = document.querySelector('[data-rail-item][href="' + href + '"]');
    if (link) link.click();
    else window.location.href = href;
  }

  /** Re-run whatever the current screen calls a scan. */
  function rescan() {
    var path = window.location.pathname;
    if (path === '/app/disk' && typeof window.startDiskScan === 'function') {
      window.startDiskScan();
      return;
    }
    // The other two live in x-data scopes, which expose their methods on the
    // element. Clicking the screen's own button is the one path that is right
    // for all of them and cannot fall out of sync with what the button does.
    var button = document.querySelector('[data-rescan]');
    if (button) button.click();
  }

  /**
   * The whole menubar.
   *
   * `setAppMenu` builds a fresh NSMenu and calls `setMainMenu:` — it replaces
   * the bar, it does not merge into it. Whatever you supply is the entire bar,
   * so anything you leave out is gone.
   *
   * And by AppKit convention the *first* menu is the application menu: its
   * title is replaced by the app name whatever you call it. That is what made
   * the earlier attempts look haunted. Supplying Edit, View and Window left a
   * bar reading SystemCleaner, View, Window — Edit had not failed, it had been
   * consumed as the app menu. Supplying View alone emptied the bar for the same
   * reason, with nothing left over to render.
   *
   * So: an app menu first, then everything the bar should carry.
   *
   * Roles do the work wherever AppKit has a selector for it. A role wires the
   * item to that selector with a nil target, so the responder chain performs
   * it; cut/copy/paste *must* take this path, since an id round-tripping
   * through JS cannot reach the field editor and Copy would do nothing inside
   * the filter fields.
   */
  function build() {
    var viewItems = [
      { id: 'app.rescan', label: 'Rescan', shortcut: 'cmd+r' },
      { id: 'app.sep.rescan', separator: true },
    ].concat(VIEWS.map(function (v) {
      return { id: 'app.view.' + v.id, label: v.label, shortcut: 'cmd+' + v.key };
    }));
    viewItems.push({ id: 'app.sep.view', separator: true });
    viewItems.push({ id: 'app.fullscreen', label: 'Enter Full Screen', role: 'fullscreen' });

    return {
      menus: [
        {
          // First, so AppKit takes it as the application menu and titles it.
          label: 'SystemCleaner',
          items: [
            { id: 'app.about', label: 'About SystemCleaner', role: 'about' },
            { id: 'app.sep.app1', separator: true },
            { id: 'app.hide', label: 'Hide SystemCleaner', role: 'hide', shortcut: 'cmd+h' },
            { id: 'app.hideothers', label: 'Hide Others', role: 'hideOthers', shortcut: 'cmd+alt+h' },
            { id: 'app.showall', label: 'Show All', role: 'showAll' },
            { id: 'app.sep.app2', separator: true },
            { id: 'app.quit', label: 'Quit SystemCleaner', role: 'quit', shortcut: 'cmd+q' },
          ],
        },
        {
          label: 'Edit',
          items: [
            { id: 'app.undo', label: 'Undo', role: 'undo', shortcut: 'cmd+z' },
            { id: 'app.redo', label: 'Redo', role: 'redo', shortcut: 'cmd+shift+z' },
            { id: 'app.sep.edit', separator: true },
            { id: 'app.cut', label: 'Cut', role: 'cut', shortcut: 'cmd+x' },
            { id: 'app.copy', label: 'Copy', role: 'copy', shortcut: 'cmd+c' },
            { id: 'app.paste', label: 'Paste', role: 'paste', shortcut: 'cmd+v' },
            { id: 'app.selectall', label: 'Select All', role: 'selectAll', shortcut: 'cmd+a' },
          ],
        },
        { label: 'View', items: viewItems },
        {
          label: 'Window',
          items: [
            { id: 'app.minimize', label: 'Minimize', role: 'minimize', shortcut: 'cmd+m' },
            { id: 'app.zoom', label: 'Zoom', role: 'zoom' },
            { id: 'app.sep.window', separator: true },
            { id: 'app.close', label: 'Close Window', role: 'close', shortcut: 'cmd+w' },
          ],
        },
      ],
    };
  }

  function onAction(event) {
    var id = event && event.detail && event.detail.id;
    if (!id || id.indexOf('app.') !== 0) return;

    if (id === 'app.rescan') {
      rescan();
      return;
    }

    if (id.indexOf('app.view.') === 0) {
      var wanted = id.slice('app.view.'.length);
      for (var i = 0; i < VIEWS.length; i++) {
        if (VIEWS[i].id === wanted) {
          go(VIEWS[i].href);
          return;
        }
      }
    }
  }

  if (!window._appMenuBound) {
    window._appMenuBound = true;
    window.addEventListener('craft:menu:action', onAction);
    if (hasMenu()) {
      try { window.craft.menu.set(build()); }
      catch (_) { /* a window with the default bar is still a working app */ }
    }
  }
})();
