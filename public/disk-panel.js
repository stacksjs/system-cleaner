(function() {
  if (window.__diskPanelInit) return;
  window.__diskPanelInit = true;

  var PAL = ['#FF6B6B','#4ECDC4','#45B7D1','#96CEB4','#F7DC6F','#DDA0DD','#98D8C8','#F8C471','#BB8FCE','#85C1E9','#82E0AA','#F1948A','#AED6F1','#D7BDE2','#F5B7B1','#73C6B6','#F0B27A','#A9CCE3','#D2B4DE','#A3E4D7'];
  var CFG = { centerR: 60, maxR: 280, maxDepth: 4, padAngle: 0.004, minAngle: 0.005, maxSegs: 400 };

  function fmtBytes(b) {
    if (b >= 1e12) return (b/1e12).toFixed(1)+' TB';
    if (b >= 1e9) return (b/1e9).toFixed(1)+' GB';
    if (b >= 1e6) return (b/1e6).toFixed(1)+' MB';
    if (b >= 1e3) return (b/1e3).toFixed(1)+' KB';
    return b+' B';
  }
  function lighten(hex, amt) {
    var r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
    r=Math.min(255,Math.round(r+(255-r)*amt));g=Math.min(255,Math.round(g+(255-g)*amt));b=Math.min(255,Math.round(b+(255-b)*amt));
    return '#'+r.toString(16).padStart(2,'0')+g.toString(16).padStart(2,'0')+b.toString(16).padStart(2,'0');
  }
  function arcPath(sa,ea,ir,or2) {
    var a=sa+CFG.padAngle/2,b=ea-CFG.padAngle/2;if(b-a<0.001)return '';
    var la=(b-a>Math.PI)?1:0,sx=Math.sin(a),sy=-Math.cos(a),ex=Math.sin(b),ey=-Math.cos(b);
    return 'M '+(sx*or2).toFixed(2)+' '+(sy*or2).toFixed(2)+' A '+or2+' '+or2+' 0 '+la+' 1 '+(ex*or2).toFixed(2)+' '+(ey*or2).toFixed(2)+' L '+(ex*ir).toFixed(2)+' '+(ey*ir).toFixed(2)+' A '+ir+' '+ir+' 0 '+la+' 0 '+(sx*ir).toFixed(2)+' '+(sy*ir).toFixed(2)+' Z';
  }
  function computeLayout(node, maxD) {
    var rw = (CFG.maxR - CFG.centerR) / maxD;
    function go(nd, sa, ea, depth) {
      nd._d=depth;nd._sa=sa;nd._ea=ea;
      if(depth>0){nd._ir=CFG.centerR+(depth-1)*rw;nd._or=CFG.centerR+depth*rw;}
      if(nd.c&&nd.c.length&&depth<maxD){var cur=sa,span=ea-sa;for(var i=0;i<nd.c.length;i++){if(nd.s<=0)continue;var cs=(nd.c[i].s/nd.s)*span;go(nd.c[i],cur,cur+cs,depth+1);cur+=cs;}}
    }
    go(node,0,2*Math.PI,0);
  }
  function flatten(node,arr,ci){
    if(node._d===undefined||arr.length>=CFG.maxSegs)return;
    if(node._d===0){if(node.c)for(var i=0;i<node.c.length;i++)flatten(node.c[i],arr,i);return;}
    if(node._ea-node._sa<CFG.minAngle)return;
    var col=lighten(PAL[(node._colorIdx === undefined ? ci : node._colorIdx)%PAL.length],Math.max(0,(node._d-1)*0.15));
    var d=arcPath(node._sa,node._ea,node._ir,node._or);if(!d)return;
    arr.push({idx:arr.length,d:d,color:col,name:node.n,fullPath:node.p||'',size:node.s,formattedSize:fmtBytes(node.s),depth:node._d,aggregate:!!node.aggregate,isDir:node.d!==false,childCount:node.c?node.c.length:0,percent:'0',colorIdx:ci,_node:node});
    if(node.c && node._d < CFG.maxDepth)for(var j=0;j<node.c.length;j++)flatten(node.c[j],arr,ci);
  }
  function normalize(node) {
    var result = { aggregate: !!node.aggregate, n: node.name || node.n, s: node.sizeBytes || node.s || 0, p: node.path || node.p || '', d: node.isDirectory !== undefined ? node.isDirectory : (node.d !== false) };
    result.c = (node.children || node.c || []).map(normalize);
    return result;
  }
  function findTreePath(node, path) {
    if (node.p === path) return node;
    for (var i = 0; i < node.c.length; i++) { var hit = findTreePath(node.c[i], path); if (hit) return hit; }
    return null;
  }
  function pruneFromTree(node, targetPath) {
    if (!node || !node.c) return 0;
    for (var i = 0; i < node.c.length; i++) {
      if (node.c[i].p === targetPath) {
        var removed = node.c.splice(i, 1)[0];
        node.s = Math.max(0, node.s - (removed.s || 0));
        return removed.s || 0;
      }
      var freed = pruneFromTree(node.c[i], targetPath);
      if (freed) { node.s = Math.max(0, node.s - freed); return freed; }
    }
    return 0;
  }

  var segs = [];
  var tree = null;
  var viewStack = [];
  var currentRoot = null;
  var branchColors = new Map();
  function assignColors(node, inherited) {
    if (inherited !== undefined) node._colorIdx = inherited;
    (node.c || []).forEach(function(child) {
      var key = JSON.stringify([child.p, !!child.aggregate]);
      if (inherited === undefined && !branchColors.has(key)) branchColors.set(key, branchColors.size % PAL.length);
      assignColors(child, inherited === undefined ? branchColors.get(key) : inherited);
    });
  }

  window.__diskExecQueue = window.__diskExecQueue || [];
  window.__diskTopItems = [];
  window.__diskHovered = null;
  window.__diskScanInfo = null;

  function getDiskScopeEl() {
    var layout = document.querySelector('.disk-layout');
    if (!layout) return null;
    if (layout.hasAttribute('data-stx-scope')) return layout;
    return layout.closest('[data-stx-scope]');
  }

  function getDiskScope() {
    var el = getDiskScopeEl();
    if (!el) return null;
    var id = el.getAttribute('data-stx-scope');
    if (window.stx && window.stx._scopes && id && window.stx._scopes[id]) return window.stx._scopes[id];
    return el.__stx_scope || null;
  }

  function flushDiskExecQueue() {
    var el = getDiskScopeEl();
    if (!el || !el.__stx_execute) return;
    while (window.__diskExecQueue.length) el.__stx_execute(window.__diskExecQueue.shift());
  }

  function diskExec(stmt) {
    var el = getDiskScopeEl();
    if (el && el.__stx_execute) {
      flushDiskExecQueue();
      el.__stx_execute(stmt);
      return;
    }
    window.__diskExecQueue.push(stmt);
  }

  function patchDiskScope(fields) {
    if (Object.prototype.hasOwnProperty.call(fields, 'scanState')) window.__diskLiveScanning = fields.scanState === 'scanning';
    // Any state change that is not an error clears the last one, so a retry
    // does not run underneath a stale message.
    if (Object.prototype.hasOwnProperty.call(fields, 'scanState') && fields.scanState !== 'error')
      fields.scanError = '';
    if (Object.prototype.hasOwnProperty.call(fields, 'scanState') && fields.scanState !== 'scanning') {
      fields.scanProgress = '';
      fields.scanProgressPath = '';
      fields.scanStalled = false;
    }

    var parts = [];
    for (var key in fields) {
      if (!Object.prototype.hasOwnProperty.call(fields, key)) continue;
      var v = fields[key];
      if (key === 'topItems' || key === 'scanInfo' || key === 'hovered') {
        window['__diskPatch_' + key] = v;
        parts.push(key + ' = window.__diskPatch_' + key);
      } else if (typeof v === 'string') {
        parts.push(key + ' = ' + JSON.stringify(v));
      } else if (v === null) {
        parts.push(key + ' = null');
      } else {
        parts.push(key + ' = ' + JSON.stringify(v));
      }
    }
    if (parts.length) diskExec(parts.join('; '));
    return !!getDiskScopeEl() && !!getDiskScopeEl().__stx_execute;
  }

  function renderSegments(root) {
    currentRoot = root;
    assignColors(tree || root);
    computeLayout(root, CFG.maxDepth);
    var ns = []; flatten(root, ns, 0);
    var rs = root.s;
    for (var i = 0; i < ns.length; i++) ns[i].percent = rs > 0 ? ((ns[i].size / rs) * 100).toFixed(1) : '0';
    segs = ns;

    var segGroup = document.getElementById('segments-group');
    if (segGroup) {
      window.renderDiskChart(segGroup, segs.map(function(segment) {
        return { key: JSON.stringify([segment.fullPath, segment.aggregate]), idx: segment.idx,
          start: segment._node._sa, end: segment._node._ea, inner: segment._node._ir, outer: segment._node._or,
          color: segment.color, label: segment.name + ' — ' + segment.formattedSize + ' (' + segment.percent + '%)' };
      }));
    }
    var cb = document.getElementById('center-back');
    if (cb) cb.style.opacity = viewStack.length > 0 ? '0.6' : '0';

    var top = segs.filter(function(s){ return s.depth === 1; })
                  .sort(function(a,b){ return b.size - a.size; })
                  .slice(0, 20);
    var maxS = top.length > 0 ? top[0].size : 1;
    window.__diskTopItems = top.map(function(t){
      return {
        idx: t.idx, color: t.color, name: t.name,
        formattedSize: t.formattedSize, size: t.size,
        fullPath: t.fullPath, isDir: t.isDir, depth: t.depth,
        childCount: t.childCount, percent: t.percent,
        barPct: Math.max(3, Math.round((t.size / maxS) * 100)),
      };
    });
    var label = fmtBytes(root.s);
    patchDiskScope({
      topItems: window.__diskTopItems,
      defaultSize: label,
      defaultName: root.n,
      rootName: root.n,
      // The sidebar heading is "Home: chris" at the scan root and "Folder:
      // Code" once you drill in — it read "Home: Code" before, which is not a
      // place that exists.
      drilled: viewStack.length > 0,
      scanTotalLabel: label,
      hovered: window.__diskHovered ? segs.find(function(segment) { return segment.fullPath === window.__diskHovered.fullPath && segment.aggregate === window.__diskHovered.aggregate; }) || null : null,
    });
  }

  function bindSvgEvents() {
    var diskLayout = document.querySelector('.disk-layout');
    if (!diskLayout || diskLayout.__diskBound) return;
    diskLayout.__diskBound = true;
    diskLayout.addEventListener('mouseover', function(e) {
      var seg = e.target.closest('.segment');
      if (seg) {
        var idx = parseInt(seg.getAttribute('data-idx'));
        var s = segs[idx];
        if (s) { window.__diskHovered = s; patchDiskScope({ hovered: s }); }
      }
    });
    // Deliberately no mouseout handler.
    //
    // Clearing on mouseout made the inspector's own buttons unreachable: they
    // live on the far side of the window, so the trip to click Reveal in Finder
    // leaves the segment, empties the panel, and the click lands on nothing.
    // Every press of that button did exactly nothing, which is not a thing a
    // user can be expected to diagnose.
    //
    // The inspector now holds the last segment until another is hovered. That
    // is also what a details pane is for — you look away from the chart to read
    // it, and it should still be there when you do.
    // Right-click acts on whatever is under the pointer, the way a Finder
    // window does — not on whatever happened to be selected last.
    diskLayout.addEventListener('contextmenu', function(e) {
      var seg = e.target.closest('.segment');
      if (!seg) return;
      e.preventDefault();
      var s = segs[parseInt(seg.getAttribute('data-idx'))];
      if (s) openSegmentMenu(s, e.clientX, e.clientY);
    });
    diskLayout.addEventListener('click', function(e) {
      var seg = e.target.closest('.segment');
      if (seg) {
        var idx = parseInt(seg.getAttribute('data-idx'));
        var s = segs[idx];
        if (s && s.isDir && s._node && s._node.c && s._node.c.length > 0) {
          viewStack.push(currentRoot);
          renderSegments(s._node);
        }
      }
      if (e.target.closest('.center-bg')) {
        if (viewStack.length > 0) renderSegments(viewStack.pop());
      }
    });
  }

  function applyScanResult(data, cached) {
    var focusedPath = currentRoot && currentRoot.p;
    tree = data.tree.n ? data.tree : normalize(data.tree);
    viewStack = viewStack.map(function(node) { return findTreePath(tree, node.p); }).filter(Boolean);
    window.__diskTree = tree;
    window.__diskScanInfo = {
      folderCount: data.folderCount,
      fileCount: data.fileCount,
      scanTime: data.scanTime,
      truncated: !!data.truncated,
      // How much of the picture is missing, and for which of the two reasons.
      // "Partial" on its own tells nobody whether to trust the number.
      unmeasured: data.unmeasured || 0,
      unreadable: data.unreadable || 0,
      cached: !!cached,
    };
    patchDiskScope({
      scanInfo: window.__diskScanInfo,
      scanState: data.cancelled ? 'cancelled' : 'done',
      hasResults: tree.s > 0,
    });
    bindSvgEvents();
    renderSegments(findTreePath(tree, focusedPath) || tree);
    flushDiskExecQueue();

    // A fresh scan that took a while and finished while the user was elsewhere.
    // Cached results never notify: nothing happened, the screen just remembered.
    if (!cached && window.notifyIfAway) {
      var seconds = parseFloat(String(data.scanTime || '0')) || 0;
      window.notifyIfAway({
        elapsedMs: seconds * 1000,
        title: 'Disk scan finished',
        body: fmtBytes(tree.s) + ' across ' + data.folderCount + ' folders.',
      });
    }
  }

  function fmtCount(n) {
    return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n);
  }

  function shortenPath(p) {
    if (!p) return '';
    var home = p.indexOf('/Users/');
    var rel = home === 0 ? '~' + p.slice(p.indexOf('/', 7)) : p;
    // Keep the tail: the leading directories are the same for every update,
    // so the end of the path is the part that shows movement.
    return rel.length > 46 ? '…' + rel.slice(-45) : rel;
  }

  // A scan runs for tens of seconds. Polling for its progress is what turns a
  // motionless spinner into something a person can tell is alive — and what
  // makes a slow scan tolerable rather than suspicious.
  // Turn one progress payload into the fields the panel renders. Split out of
  // the poll so a caller that already holds a payload — the rejoin path fetched
  // one to decide whether a scan was running at all — can show it immediately
  // instead of discarding it and waiting for the next tick.
  function applyProgress(d) {
    if (!d || !d.scanning || d.kind !== 'tree') return;
    var fields = {
      scanProgress: fmtCount(d.scanned) + ' items · ' + Math.round(d.elapsedMs / 1000) + 's',
      scanProgressPath: shortenPath(d.path),
      scanProgressFullPath: d.path || '',
      // A walk that has counted nothing after several seconds is not slow, it
      // is stopped — parked in a syscall macOS will not return from until
      // someone answers a permission prompt. Saying so beats counting seconds
      // up to a timeout the user cannot interpret.
      scanStalled: false,
    };
    // The headline climbs while the scan runs. Every byte in it has been
    // measured exactly, so it is the answer so far rather than an estimate —
    // and watching it pass the number the old scanner used to stop at is the
    // clearest possible statement that the scan is still doing something.
    if (d.measuredBytes > 0) fields.scanTotalLabel = fmtBytes(d.measuredBytes) + ' so far';
    if (d.snapshot && d.snapshot.tree && d.snapshot.tree.sizeBytes > 0) {
      var focusedPath = currentRoot && currentRoot.p;
      tree = normalize(d.snapshot.tree);
      window.__diskTree = tree;
      viewStack = viewStack.map(function(node) { return findTreePath(tree, node.p); }).filter(Boolean);
      fields.hasResults = true;
      fields.scanTotalLabel = fmtBytes(tree.s) + ' so far';
      bindSvgEvents();
      renderSegments(findTreePath(tree, focusedPath) || tree);
    }
    patchDiskScope(fields);
  }

  var attachedScan = null;
  var renderedScanId = null;
  var renderedResult = null;
  function renderSession(session) {
    if (!document.querySelector('.disk-layout')) return;
    var active = ['queued', 'running', 'cancelling'].indexOf(session.status) !== -1;
    var result = session.result;
    if (session.id !== renderedScanId) {
      renderedScanId = session.id;
      renderedResult = null;
      viewStack = [];
      currentRoot = null;
      branchColors.clear();
      patchDiskScope({ hasResults: false, topItems: [], scanInfo: null, scanTotalLabel: '0 B so far' });
    }
    var elapsed = Math.max(0, (session.finishedAt || Date.now()) - (session.startedAt || Date.now()));
    patchDiskScope({ scanId: session.id, scanStatus: session.status, cancelling: session.status === 'cancelling',
      scanState: active ? 'scanning' : session.status === 'cancelled' ? 'cancelled' : session.status === 'failed' ? 'error' : 'done',
      scanError: result && result.error || '',
    });
    if (active) {
      applyProgress(Object.assign({}, session.progress, { kind: 'tree', scanning: true, elapsedMs: elapsed }));
      if (session.status === 'queued') patchDiskScope({ scanProgress: 'Queued — waiting for another scan' });
      if (session.status === 'cancelling') patchDiskScope({ scanProgress: 'Cancelling…' });
    }
    else if (result && result.tree) {
      if (renderedResult !== result) { applyScanResult(result, true); renderedResult = result; }
    }
    if (!active) patchDiskScope({ scanProgress: fmtCount(session.progress.scanned) + ' items · ' + Math.round(elapsed / 1000) + 's',
      scanProgressPath: shortenPath(session.progress.path) });
  }
  function diskPanelMount() {
    if (!document.querySelector('.disk-layout')) return;
    flushDiskExecQueue();
    bindSvgEvents();
    if (attachedScan) attachedScan();
    renderedResult = null;
    attachedScan = window.scanSessions.subscribe('tree', renderSession);

  }
  window.addEventListener('stx:navigate', function() {
    if (attachedScan) attachedScan();
    attachedScan = null;
  });
  window.diskPanelMount = diskPanelMount;
  window.startDiskScan = function() {
    window.scanSessions.start('tree', {}).catch(function(error) { window.nativeAlert('Could not start scan', error.message); });
  };
  window.cancelDiskScan = function() {
    window.scanSessions.cancel('tree').catch(function(error) { window.nativeAlert('Could not cancel scan', error.message); });
  };

  // ── Context menu ────────────────────────────────────────────────
  // Built rather than borrowed: the window has no native menu to hang this off,
  // so it imitates one — same metrics, same dismissal rules, same keyboard
  // behaviour. Anything less reads as a web page pretending to be an app.
  var menuEl = null;
  var pendingMenuTarget = null;

  // Craft context menus use their own action channel, separate from menubars.
  // Replace the listener on SPA remount so it never holds a previous page's target.
  if (window._diskMenuAction) window.removeEventListener('craft:contextmenu:action', window._diskMenuAction);
  window._diskMenuAction = function(e) {
    var id = e && e.detail && e.detail.id;
    var s = pendingMenuTarget;
    if (!id || !s || e.detail.targetId !== s.fullPath) return;
    pendingMenuTarget = null;
    if (id === 'sc.reveal') window.diskRevealInFinder(s.fullPath);
    else if (id === 'sc.copy') window.nativeCopy(s.fullPath);
    else if (id === 'sc.drill') drillInto(s);
    else if (id === 'sc.trash' && !window.__diskLiveScanning) window.diskDeletePath(s.fullPath, s.name, s.size);
  };
  window.addEventListener('craft:contextmenu:action', window._diskMenuAction);

  function drillInto(s) {
    if (!s || !s.isDir || !s._node || !s._node.c || !s._node.c.length) return;
    viewStack.push(currentRoot);
    renderSegments(s._node);
  }

  function closeSegmentMenu() {
    if (!menuEl) return;
    menuEl.remove();
    menuEl = null;
    document.removeEventListener('mousedown', onMenuOutside, true);
    document.removeEventListener('keydown', onMenuKey, true);
    window.removeEventListener('blur', closeSegmentMenu);
    window.removeEventListener('resize', closeSegmentMenu);
    document.removeEventListener('scroll', closeSegmentMenu, true);
  }

  function onMenuOutside(e) {
    if (menuEl && !menuEl.contains(e.target)) closeSegmentMenu();
  }

  function onMenuKey(e) {
    if (!menuEl) return;
    if (e.key === 'Escape') { e.preventDefault(); closeSegmentMenu(); return; }

    var items = Array.prototype.slice.call(menuEl.querySelectorAll('.ctx-item:not([disabled])'));
    if (!items.length) return;
    var at = items.indexOf(document.activeElement);

    if (e.key === 'ArrowDown') { e.preventDefault(); items[(at + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(at - 1 + items.length) % items.length].focus(); }
    else if (e.key === 'Enter' && at >= 0) { e.preventDefault(); items[at].click(); }
  }

  // Native when the window can open one, the styled fallback otherwise.
  // `@stacksjs/desktop`'s contextMenu.show() reports which happened, so this
  // never has to guess — and a browser tab still gets a working right-click.
  function openSegmentMenu(s, x, y) {
    closeSegmentMenu();
    if (s.aggregate) return;

    var native = window.craft && window.craft.nativeUI;
    if (native && typeof native.showContextMenu === 'function') {
      pendingMenuTarget = s;
      // No accelerators: nothing here is bound to a key, and an accelerator the
      // app does not honour is a promise it breaks. `cmd+delete` also rendered
      // as ⌘D, which means something else entirely.
      var items = [
        { id: 'sc.reveal', title: 'Reveal in Finder', icon: 'folder' },
        { id: 'sc.copy', title: 'Copy Path', icon: 'doc.on.doc' },
      ];
      if (s.isDir && s.childCount)
        items.push({ id: 'sc.sep1', title: '', type: 'separator' }, { id: 'sc.drill', title: 'Open in Chart', icon: 'chart.pie' });
      items.push({ id: 'sc.sep2', title: '', type: 'separator' }, { id: 'sc.trash', title: 'Delete…', icon: 'trash', enabled: !window.__diskLiveScanning });

      try {
        native.showContextMenu({ targetId: s.fullPath, targetType: 'general', x: Math.round(x), y: Math.round(y), items: items });
        return;
      }
      catch (_) {
        // Fall through to the DOM menu below.
        pendingMenuTarget = null;
      }
    }

    menuEl = document.createElement('div');
    menuEl.className = 'ctx-menu';
    menuEl.setAttribute('role', 'menu');

    var header = document.createElement('div');
    header.className = 'ctx-header';
    header.textContent = s.name;
    menuEl.appendChild(header);

    function addItem(label, danger, onPick) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'ctx-item' + (danger ? ' is-danger' : '');
      b.setAttribute('role', 'menuitem');
      b.textContent = label;
      b.addEventListener('click', function() { closeSegmentMenu(); onPick(); });
      menuEl.appendChild(b);
      return b;
    }

    function addSeparator() {
      var sep = document.createElement('div');
      sep.className = 'ctx-sep';
      menuEl.appendChild(sep);
    }

    addItem('Reveal in Finder', false, function() { window.diskRevealInFinder(s.fullPath); });
    addItem('Copy Path', false, function() {
      window.nativeCopy(s.fullPath);
    });

    if (s.isDir && s.childCount) {
      addSeparator();
      addItem('Open in Chart', false, function() { drillInto(s); });
    }

    addSeparator();
    addItem('Delete…', true, function() {
      if (window.__diskLiveScanning) return;
      window.diskDeletePath(s.fullPath, s.name, s.size);
    });

    // Offscreen first so it can be measured, then placed. Flipping rather than
    // clamping keeps the corner nearest the pointer anchored, which is what
    // macOS does when a menu meets an edge.
    menuEl.style.visibility = 'hidden';
    document.body.appendChild(menuEl);
    var r = menuEl.getBoundingClientRect();
    var left = x + r.width > window.innerWidth - 8 ? Math.max(8, x - r.width) : x;
    var top = y + r.height > window.innerHeight - 8 ? Math.max(8, y - r.height) : y;
    menuEl.style.left = left + 'px';
    menuEl.style.top = top + 'px';
    menuEl.style.visibility = '';

    document.addEventListener('mousedown', onMenuOutside, true);
    document.addEventListener('keydown', onMenuKey, true);
    window.addEventListener('blur', closeSegmentMenu);
    window.addEventListener('resize', closeSegmentMenu);
    document.addEventListener('scroll', closeSegmentMenu, true);
  }

  window.diskRevealInFinder = function(path) {
    window.revealPath(path);
  };

  window.diskDeletePath = async function(path, name, sizeBytes) {
    if (window.__diskLiveScanning) return;
    var sizeStr = fmtBytes(sizeBytes || 0);
    var ok = await window.nativeConfirm({
      title: 'Delete “' + name + '”?',
      message: sizeStr + ' will be removed from ' + path + '. This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    fetch('/api/delete-path', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: path }) })
      .then(function(r) { return r.json(); })
      .then(function(r) {
        if (r.success) {
          try { localStorage.removeItem(DISK_CACHE_KEY); } catch (_) {}
          if (tree) pruneFromTree(tree, path);
          renderSegments(currentRoot && currentRoot.p !== path ? currentRoot : tree);
          patchDiskScope({ hovered: null });
        } else {
          window.nativeAlert('Could not delete “' + name + '”', r.error || 'The scanner gave no reason.');
        }
      })
      .catch(function(err) {
        window.nativeAlert('Could not delete “' + name + '”', err.message);
      });
  };

  if (document.querySelector('.disk-layout')) diskPanelMount();
})();
