window.updatesXData = function () {
  return {
    loading: true,
    fullScan: false,
    brewFormulae: [],
    brewCasks: [],
    pantryOutdated: [],
    pantryPackages: [],
    pantryTrackedCount: 0,
    desktopApps: [],
    desktopOutdated: [],
    systemUpdates: [],
    clToolsInfo: { installed: false, version: null, installPath: null },
    macosVersion: null,
    updateScanCached: true,
    updateScannedAt: null,
    selected: [],
    updating: {},
    updated: {},
    toasts: [],
    toastId: 0,
    appFilter: 'all',

    init() {
      this.loadUpdates(false, false)
    },

    systemOutdatedCount() {
      return this.systemUpdates.length
    },

    totalOutdated() {
      return this.brewFormulae.length
        + this.brewCasks.length
        + this.pantryOutdated.length
        + this.desktopOutdated.length
        + this.systemUpdates.length
    },

    brewTotal() {
      return this.brewFormulae.length + this.brewCasks.length
    },

    filteredDesktopApps() {
      var f = this.appFilter
      return this.desktopApps.filter(function (app) {
        if (f === 'outdated') return app.updateAvailable
        if (f === 'uptodate') return !app.updateAvailable && app.source !== 'unknown' && app.source !== 'mas'
        return true
      })
    },

    allBrewKeys() {
      return this.brewFormulae.map(function (f) { return f.name })
        .concat(this.brewCasks.map(function (c) { return 'cask:' + c.name }))
    },

    applyData(data) {
      this.brewFormulae = data.brewFormulae || []
      this.brewCasks = data.brewCasks || []
      this.pantryOutdated = data.pantryOutdated || []
      this.pantryPackages = data.pantryPackages || []
      this.pantryTrackedCount = data.pantryTrackedCount != null
        ? data.pantryTrackedCount
        : (data.pantryPackages || []).length
      this.desktopApps = data.desktopApps || []
      this.desktopOutdated = data.desktopOutdated || []
      this.systemUpdates = data.systemUpdates || []
      this.clToolsInfo = data.clToolsInfo || { installed: false, version: null, installPath: null }
      this.macosVersion = data.macosVersion || null
      this.updateScanCached = data.updateScanCached !== false
      this.updateScannedAt = data.updateScannedAt || null
      this.syncUpdatesBadge()
    },

    syncUpdatesBadge() {
      var total = this.totalOutdated()
      var badge = document.getElementById('updates-badge')
      if (!badge) return
      if (total > 0) {
        badge.textContent = String(total)
        badge.style.display = ''
      } else {
        badge.textContent = ''
        badge.style.display = 'none'
      }
    },

    loadUpdates(fullScan, forceRefresh) {
      var self = this
      var useFullScan = !!fullScan
      var bustCache = !!forceRefresh
      var cacheKey = 'sc-updates-v2-' + (useFullScan ? 'full' : 'quick')

      if (!bustCache) {
        try {
          var raw = localStorage.getItem(cacheKey)
          if (raw) {
            var cached = JSON.parse(raw)
            if (Date.now() - cached.at < 5 * 60 * 1000) {
              self.applyData(cached.data)
              self.loading = false
            }
          }
        } catch (e) {}
      } else {
        this.loading = true
      }

      this.fullScan = useFullScan
      fetch('/api/updates-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullScan: useFullScan, forceRefresh: bustCache, tier: 'quick' }),
      })
        .then(function (r) { return r.json() })
        .then(function (data) {
          self.applyData(data)
          self.loading = false
          try {
            localStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), data: data }))
          } catch (e) {}
          return fetch('/api/updates-check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fullScan: useFullScan, forceRefresh: false, tier: 'full' }),
          })
        })
        .then(function (r) { return r && r.json ? r.json() : null })
        .then(function (fullData) {
          if (!fullData) return
          self.applyData(Object.assign({}, fullData, {
            brewFormulae: fullData.brewFormulae || self.brewFormulae,
            brewCasks: fullData.brewCasks || self.brewCasks,
            pantryOutdated: fullData.pantryOutdated || self.pantryOutdated,
          }))
          try {
            localStorage.setItem(cacheKey, JSON.stringify({
              at: Date.now(),
              data: {
                brewFormulae: self.brewFormulae,
                brewCasks: self.brewCasks,
                pantryOutdated: self.pantryOutdated,
                pantryPackages: self.pantryPackages,
                pantryTrackedCount: self.pantryTrackedCount,
                desktopApps: self.desktopApps,
                desktopOutdated: self.desktopOutdated,
                systemUpdates: self.systemUpdates,
                clToolsInfo: self.clToolsInfo,
                macosVersion: self.macosVersion,
                updateScanCached: self.updateScanCached,
                updateScannedAt: self.updateScannedAt,
              },
            }))
          } catch (e) {}
        })
        .catch(function () { self.loading = false })
    },

    refresh(fullScan) {
      this.updated = {}
      this.loadUpdates(!!fullScan, true)
      this.toast(fullScan ? 'Running full system update scan...' : 'Refreshing...', 'info')
    },

    kindLabel(kind) {
      if (kind === 'macos') return 'macOS'
      if (kind === 'cltools') return 'Xcode CLT'
      if (kind === 'safari') return 'Safari'
      if (kind === 'firmware') return 'Firmware'
      return 'System'
    },

    kindBadgeClass(kind) {
      if (kind === 'macos') return 'badge-blue'
      if (kind === 'cltools') return 'badge-purple'
      if (kind === 'safari') return 'badge-green'
      return 'badge-orange'
    },

    openSystemSettings() {
      fetch('/api/open-software-update', { method: 'POST' })
        .then(function (r) { return r.json() })
        .then(function (r) {
          if (r.success) this.toast('Opened System Settings', 'success')
          else this.toast('Could not open System Settings', 'error')
        }.bind(this))
    },

    openAppStore() {
      fetch('/api/open-app-store-updates', { method: 'POST' })
        .then(function (r) { return r.json() })
        .then(function (r) {
          if (r.success) this.toast('Opened App Store Updates', 'success')
          else this.toast('Could not open App Store', 'error')
        }.bind(this))
    },

    toggle(name) {
      var i = this.selected.indexOf(name)
      if (i === -1) this.selected.push(name)
      else this.selected.splice(i, 1)
    },

    isOn(name) { return this.selected.includes(name) },
    isUpdating(name) { return this.updating[name] === true },
    isUpdated(name) { return !!this.updated[name] },

    allOn(names) {
      if (names.every(function (n) { return this.selected.includes(n) }.bind(this)))
        this.selected = this.selected.filter(function (n) { return !names.includes(n) })
      else
        names.forEach(function (n) { if (!this.selected.includes(n)) this.selected.push(n) }.bind(this))
    },

    toast(msg, type) {
      var id = ++this.toastId
      this.toasts = this.toasts.concat([{ id: id, msg: msg, type: type || 'info' }])
      var self = this
      setTimeout(function () {
        self.toasts = self.toasts.filter(function (t) { return t.id !== id })
      }, 5000)
    },

    setUpdating(key, value) {
      var next = Object.assign({}, this.updating)
      if (value) next[key] = true
      else delete next[key]
      this.updating = next
    },

    doUpdate(name, type) {
      var key = type === 'cask' ? 'cask:' + name : name
      this.setUpdating(key, true)
      var self = this
      fetch('/api/brew-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, type: type }),
      })
        .then(function (r) { return r.json() })
        .then(function (r) {
          self.setUpdating(key, false)
          if (r.success) {
            self.updated = Object.assign({}, self.updated, Object.fromEntries([[key, true]]))
            self.toast(name + ' updated to ' + (r.version || 'latest'), 'success')
          } else {
            self.toast('Failed: ' + (r.error || 'Unknown'), 'error')
          }
        })
    },

    doUpdateSelected() {
      var items = this.selected.slice()
      if (items.length === 0) return
      if (!confirm('Update ' + items.length + ' packages?')) return
      var self = this
      items.forEach(function (key) {
        var isCask = key.startsWith('cask:')
        var name = isCask ? key.slice(5) : key
        self.doUpdate(name, isCask ? 'cask' : 'formula')
      })
    },

    doUpdateAll() {
      if (!confirm('Update all outdated Homebrew packages? This may take a while.')) return
      this.toast('Running brew upgrade...', 'info')
      var self = this
      fetch('/api/brew-update-all', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        .then(function (r) { return r.json() })
        .then(function (r) {
          if (r.success) { self.toast('All packages updated!', 'success'); self.refresh(false) }
          else self.toast('Update failed: ' + (r.error || 'Unknown'), 'error')
        })
    },

    doPantryUpdate(name) {
      var key = 'pantry:' + name
      this.setUpdating(key, true)
      var self = this
      fetch('/api/pantry-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name }),
      })
        .then(function (r) { return r.json() })
        .then(function (r) {
          self.setUpdating(key, false)
          if (r.success) {
            self.updated = Object.assign({}, self.updated, Object.fromEntries([[key, true]]))
            self.toast(name + ' updated', 'success')
          } else {
            self.toast('Failed: ' + (r.error || 'Unknown'), 'error')
          }
        })
    },

    doAppUpdate(name, caskToken) {
      var key = 'app:' + name
      this.setUpdating(key, true)
      var self = this
      fetch('/api/app-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, caskToken: caskToken }),
      })
        .then(function (r) { return r.json() })
        .then(function (r) {
          self.setUpdating(key, false)
          if (r.success) {
            self.updated = Object.assign({}, self.updated, Object.fromEntries([[key, true]]))
            self.toast(name + ' updated to ' + (r.version || 'latest'), 'success')
          } else {
            self.toast('Failed: ' + (r.error || 'Unknown'), 'error')
          }
        })
    },
  }
}
