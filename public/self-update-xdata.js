window.selfUpdateXData = function () {
  let observer
  let timer
  let focus
  let visible = false
  let requestId = 0
  let pendingStatus = false
  let localError = false

  return {
    self: { stage: 'idle', currentVersion: '', latestVersion: null, percent: 0 },
    selfActionBusy: false,

    init() {
      const refresh = () => { void this.refreshSelfStatus() }
      focus = () => { if (visible) refresh() }
      window.addEventListener('focus', focus)
      observer = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting
        clearInterval(timer)
        if (visible) {
          refresh()
          timer = setInterval(refresh, 750)
        }
      })
      observer.observe(this.$el)
    },

    stop() {
      requestId++
      visible = false
      observer?.disconnect()
      clearInterval(timer)
      window.removeEventListener('focus', focus)
    },

    async refreshSelfStatus() {
      if (this.selfActionBusy || pendingStatus || localError || document.hidden) return
      pendingStatus = true
      try {
        const status = await this.selfPost('status')
        if (status?.stage === 'idle' && visible) await this.checkSelfUpdate()
      }
      finally {
        pendingStatus = false
      }
    },

    async selfPost(endpoint) {
      const id = ++requestId
      try {
        const response = await fetch('/api/self-update/' + endpoint, {
          method: 'POST',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
          signal: AbortSignal.timeout(25_000),
        })
        const result = await response.json()
        if (!response.ok || result.success === false) throw new Error(result.error || 'Update request failed.')
        if (id === requestId) this.self = { ...this.self, ...result }
        return id === requestId ? result : null
      }
      catch (error) {
        if (id === requestId && this.self.stage !== 'restarting') this.selfError(error)
        return null
      }
    },

    selfError(error) {
      localError = true
      this.self = { ...this.self, stage: 'error', error: error.message || 'Could not contact the updater.' }
    },

    async checkSelfUpdate() {
      if (this.selfActionBusy || this.self.stage === 'checking') return
      this.selfActionBusy = true
      localError = false
      this.self = { ...this.self, stage: 'checking', error: null }
      try { await this.selfPost('check') }
      finally { this.selfActionBusy = false }
    },

    async downloadSelfUpdate() {
      if (this.selfActionBusy || this.self.stage !== 'available') return
      this.selfActionBusy = true
      localError = false
      this.self = { ...this.self, stage: 'downloading', percent: 0, bytesDownloaded: 0, error: null }
      try { await this.selfPost('download') }
      finally { this.selfActionBusy = false }
    },

    async installSelfUpdate() {
      if (this.selfActionBusy || this.self.stage !== 'ready') return
      this.selfActionBusy = true
      requestId++
      try {
        const confirmed = await window.nativeConfirm({
          title: 'Install SystemCleaner ' + this.self.latestVersion + '?',
          message: 'SystemCleaner will briefly close and reopen on the new version.',
          confirmLabel: 'Install and Restart',
        })
        if (!confirmed) return
        this.self = { ...this.self, stage: 'installing', error: null }
        await this.selfPost('install')
      }
      catch (error) {
        this.selfError(error)
      }
      finally {
        this.selfActionBusy = false
      }
    },

    selfInstalling() {
      return this.self.stage === 'installing' || this.self.stage === 'restarting'
    },

    selfHeadline() {
      return this.self.latestVersion ? 'SystemCleaner ' + this.self.latestVersion : 'SystemCleaner'
    },

    selfDetailLine() {
      switch (this.self.stage) {
        case 'unsupported': return this.self.unsupportedReason || 'Updates are unavailable for this copy.'
        case 'checking': return 'Checking for updates…'
        case 'up-to-date': return 'SystemCleaner is up to date.'
        case 'available': return 'A software update is available.'
        case 'downloading': return 'Downloading update…'
        case 'ready': return 'Ready to install. SystemCleaner will reopen after the update.'
        case 'installing': return 'Verifying and installing the update…'
        case 'restarting': return 'Update installed. Reopening SystemCleaner…'
        case 'error': return ''
        default: return this.self.currentVersion ? 'Check for a newer version.' : 'Reading update status…'
      }
    },

    selfProgressLabel() {
      const { bytesDownloaded, bytesTotal, percent } = this.self
      if (!bytesTotal) return ''
      return (bytesDownloaded / 1e6).toFixed(1) + ' of ' + (bytesTotal / 1e6).toFixed(1) + ' MB · ' + Math.round(percent) + '%'
    },

    selfCheckedLabel() {
      const when = new Date(this.self.checkedAt || '')
      return Number.isNaN(when.getTime()) ? '' : 'Last checked ' + when.toLocaleString()
    },
  }
}
