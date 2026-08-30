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
   * The menubar, in the shape Craft's `setAppMenu` actually parses.
   *
   *   { menus: [ { label, items: [ { id, label, shortcut, separator, role } ] } ] }
   *
   * Two levels, not a tree: a menubar is a list of menus, each a list of items.
   * Shortcuts are `cmd+r`, not `Cmd+R`. Roles are how cut/copy/paste have to be
   * done — they wire the item to the AppKit selector with a nil target, so the
   * responder chain performs it. A JS round-trip cannot reach the field editor
   * or the webview's own clipboard actions, so Copy would do nothing in the
   * filter fields.
   */
  function build() {
    var viewItems = [
      { id: 'app.rescan', label: 'Rescan', shortcut: 'cmd+r' },
      { id: 'app.sep.rescan', separator: true },
    ].concat(VIEWS.map(function (v) {
      return { id: 'app.view.' + v.id, label: v.label, shortcut: 'cmd+' + v.key };
    }));
    // No Enter Full Screen here: Craft's own View menu already carries one, and
    // adding a second produced two entries a line apart, one of them without
    // its shortcut.

    return {
      // Only View. Two things learned by supplying more:
      //
      //   File never appeared. Menus are merged into the bar the runtime
      //   already has, so one it does not carry is dropped without a word —
      //   which is why Rescan sits at the top of View instead.
      //
      //   Edit *disappeared*. Supplying an Edit menu of role items removed the
      //   runtime's own, leaving no Edit at all and no Copy anywhere. Craft
      //   already wires cut/copy/paste to the AppKit selectors correctly, so
      //   redeclaring them bought nothing and cost the menu.
      //
      // Window is left alone for the same reason: the runtime's is already
      // right. This adds the one menu the runtime cannot know — the app's own
      // screens.
      menus: [
        { label: 'View', items: viewItems },
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
      catch (_) { /* a window with no menubar is still a working app */ }
    }
  }
})();
