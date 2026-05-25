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
    var col=lighten(PAL[ci%PAL.length],Math.max(0,(node._d-1)*0.15));
    var d=arcPath(node._sa,node._ea,node._ir,node._or);if(!d)return;
    arr.push({idx:arr.length,d:d,color:col,name:node.n,fullPath:node.p||'',size:node.s,formattedSize:fmtBytes(node.s),depth:node._d,isDir:node.d!==false,childCount:node.c?node.c.length:0,percent:'0',colorIdx:ci,_node:node});
    if(node.c)for(var j=0;j<node.c.length;j++)flatten(node.c[j],arr,ci);
  }
  function normalize(node) {
    var result = { n: node.name || node.n, s: node.sizeBytes || node.s || 0, p: node.path || node.p || '', d: node.isDirectory !== undefined ? node.isDirectory : (node.d !== false) };
    result.c = (node.children || node.c || []).map(normalize);
    return result;
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
    computeLayout(root, CFG.maxDepth);
    var ns = []; flatten(root, ns, 0);
    var rs = root.s;
    for (var i = 0; i < ns.length; i++) ns[i].percent = rs > 0 ? ((ns[i].size / rs) * 100).toFixed(1) : '0';
    segs = ns;

    var segGroup = document.getElementById('segments-group');
    if (segGroup) {
      segGroup.innerHTML = '';
      var svgns = 'http://www.w3.org/2000/svg';
      for (var k = 0; k < segs.length; k++) {
        var p = document.createElementNS(svgns, 'path');
        p.setAttribute('class', 'segment');
        p.setAttribute('d', segs[k].d);
        p.setAttribute('fill', segs[k].color);
        p.setAttribute('data-idx', segs[k].idx);
        var t = document.createElementNS(svgns, 'title');
        t.textContent = segs[k].name + ' — ' + segs[k].formattedSize + ' (' + segs[k].percent + '%)';
        p.appendChild(t);
        segGroup.appendChild(p);
      }
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
      scanTotalLabel: label,
      hovered: null,
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
    diskLayout.addEventListener('mouseout', function(e) {
      var seg = e.target.closest('.segment');
      if (seg && (!e.relatedTarget || !e.relatedTarget.closest || !e.relatedTarget.closest('.segment'))) {
        window.__diskHovered = null;
        patchDiskScope({ hovered: null });
      }
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

  var DISK_CACHE_KEY = 'systemcleaner:disk-scan';
  var DISK_SCANNING_KEY = 'systemcleaner:disk-scanning';
  var DISK_CACHE_TTL = 10 * 60 * 1000;
  var diskPollTimer = null;

  function stopDiskPoll() {
    if (diskPollTimer) { clearInterval(diskPollTimer); diskPollTimer = null; }
  }

  function readCachedScan() {
    try {
      var raw = localStorage.getItem(DISK_CACHE_KEY);
      if (!raw) return null;
      var cached = JSON.parse(raw);
      if (Date.now() - cached.ts < DISK_CACHE_TTL) return cached.data;
    } catch (_) {}
    return null;
  }

  function applyScanResult(data, cached) {
    stopDiskPoll();
    viewStack = [];
    tree = data.tree.n ? data.tree : normalize(data.tree);
    window.__diskTree = tree;
    window.__diskScanInfo = {
      folderCount: data.folderCount,
      fileCount: data.fileCount,
      scanTime: data.scanTime,
      cached: !!cached,
    };
    patchDiskScope({
      scanInfo: window.__diskScanInfo,
      scanState: 'done',
    });
    bindSvgEvents();
    renderSegments(tree);
    flushDiskExecQueue();
  }

  function pollForScanComplete() {
    stopDiskPoll();
    var attempts = 0;
    diskPollTimer = setInterval(function() {
      attempts++;
      if (!window._diskScan.scanning) {
        var hit = readCachedScan();
        if (hit) {
          applyScanResult(hit, true);
          return;
        }
      }
      if (attempts >= 120) {
        stopDiskPoll();
        localStorage.removeItem(DISK_SCANNING_KEY);
        patchDiskScope({ scanState: 'idle' });
      }
    }, 500);
  }

  if (!window._diskScan) {
    window._diskScan = {
      scanning: false,
      run: function() {
        if (this.scanning) {
          patchDiskScope({ scanState: 'scanning' });
          pollForScanComplete();
          return;
        }
        this.scanning = true;
        localStorage.setItem(DISK_SCANNING_KEY, 'true');
        patchDiskScope({ scanState: 'scanning' });
        fetch('/api/disk-scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
          .then(function(r) {
            if (r.status === 409) {
              pollForScanComplete();
              return null;
            }
            return r.json();
          })
          .then(function(data) {
            if (!data) return;
            window._diskScan.scanning = false;
            localStorage.removeItem(DISK_SCANNING_KEY);
            if (!data.success) {
              stopDiskPoll();
              patchDiskScope({ scanState: 'idle' });
              return;
            }
            data.tree = normalize(data.tree);
            try { localStorage.setItem(DISK_CACHE_KEY, JSON.stringify({ ts: Date.now(), data: data })); } catch (_) {}
            if (typeof window._diskScan.onComplete === 'function') window._diskScan.onComplete(data);
          })
          .catch(function() {
            window._diskScan.scanning = false;
            localStorage.removeItem(DISK_SCANNING_KEY);
            stopDiskPoll();
            patchDiskScope({ scanState: 'idle' });
          });
      },
      onComplete: null,
    };
  }

  function doDiskPanelMount() {
    if (!document.querySelector('.disk-layout')) return;
    flushDiskExecQueue();
    window._diskScan.onComplete = function(data) { applyScanResult(data, false); };
    bindSvgEvents();

    var cached = readCachedScan();
    var scanningFlag = localStorage.getItem(DISK_SCANNING_KEY) === 'true';
    if (cached && !window._diskScan.scanning && scanningFlag) {
      localStorage.removeItem(DISK_SCANNING_KEY);
      scanningFlag = false;
    }

    if (window._diskScan.scanning || scanningFlag) {
      patchDiskScope({ scanState: 'scanning' });
      if (cached) applyScanResult(cached, true);
      else pollForScanComplete();
      return;
    }
    if (cached) applyScanResult(cached, true);
    else patchDiskScope({ scanState: 'idle' });
  }

  function diskPanelMount() {
    queueMicrotask(doDiskPanelMount);
  }
  window.diskPanelMount = diskPanelMount;

  if (!window._diskMountBound) {
    window._diskMountBound = true;
    window.addEventListener('stx:load', function() {
      flushDiskExecQueue();
      diskPanelMount();
    });
  }

  window.startDiskScan = function() {
    patchDiskScope({ scanState: 'scanning' });
    window._diskScan.run();
  };

  window.diskRevealInFinder = function(path) {
    fetch('/api/reveal-in-finder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: path }) }).catch(function(){});
  };

  window.diskDeletePath = function(path, name, sizeBytes) {
    var sizeStr = fmtBytes(sizeBytes || 0);
    if (!confirm('Delete "' + name + '" (' + sizeStr + ')?\n\n' + path + '\n\nThis cannot be undone.')) return;
    fetch('/api/delete-path', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: path }) })
      .then(function(r) { return r.json(); })
      .then(function(r) {
        if (r.success) {
          try { localStorage.removeItem(DISK_CACHE_KEY); } catch (_) {}
          if (tree) pruneFromTree(tree, path);
          renderSegments(currentRoot && currentRoot.p !== path ? currentRoot : tree);
          patchDiskScope({ hovered: null });
        } else {
          alert('Delete failed: ' + (r.error || 'Unknown'));
        }
      })
      .catch(function(err) {
        alert('Delete failed: ' + err.message);
      });
  };

  if (document.querySelector('.disk-layout')) diskPanelMount();
})();
