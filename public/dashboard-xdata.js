window.dashboardXData = function () {
  return {
    stats: null,
    statsLoading: true,
    pendingUpdates: null,

    init() {
      var self = this
      var load = window.__dashboardStatsPromise
        || fetch('/api/dashboard-stats', { method: 'POST' }).then(function (r) { return r.json() })
      window.__dashboardStatsPromise = load
      load
        .then(function (d) {
          if (d.success) self.stats = d
          self.statsLoading = false
        })
        .catch(function () { self.statsLoading = false })

      ;(window.__updatesSummaryPromise
        || fetch('/api/updates-summary', { method: 'POST' }).then(function (r) { return r.json() }))
        .then(function (d) { self.pendingUpdates = d.success ? d.total : 0 })
        .catch(function () { self.pendingUpdates = 0 })
    },

    // Methods, not 'get' accessors. The stx runtime does not preserve
    // getters when it wires an x-data object into its reactive scope, so the
    // ring rendered the fallback 75 forever instead of the scored value.
    healthScore() { return this.stats ? this.stats.healthScore : 75 },
    healthLabel() {
      var s = this.healthScore()
      return s >= 90 ? 'Excellent' : s >= 75 ? 'Good' : s >= 60 ? 'Fair' : s >= 40 ? 'Poor' : 'Critical'
    },
    healthColor() {
      var s = this.healthScore()
      return s >= 60 ? (s >= 75 ? 'var(--green)' : 'var(--orange)') : 'var(--red)'
    },
    healthDashoffset() {
      return String(2 * Math.PI * 40 * (1 - this.healthScore() / 100))
    },

    // Memory colour is derived here rather than baked into the HTML: the
    // packaged app serves prerendered pages, so a server-rendered colour would
    // describe the build machine's memory forever.
    //
    // These helpers return a `var(--token)`, not a hex, so the dashboard
    // follows the colour mode. That constrains where the value may land: a
    // custom property resolves in a CSS declaration but NOT in an SVG
    // presentation attribute, so every consumer must bind through `:style`
    // and never through `:stroke` / `:fill`.
    memColor() {
      var p = this.stats ? this.stats.memPercent : 0
      return p > 80 ? 'var(--red)' : p > 60 ? 'var(--orange)' : 'var(--green)'
    },
    memDotStyle() { return 'background: ' + this.memColor() },
    memFillStyle() {
      var p = this.stats ? this.stats.memPercent : 0
      return 'width: ' + p + '%; background: ' + this.memColor() + ';'
    },

    diskDotColor(pct) {
      if (pct > 90) return 'var(--red)'
      if (pct > 75) return 'var(--orange)'
      return 'var(--green)'
    },
    startupDotColor(count) {
      if (count > 30) return 'var(--red)'
      if (count > 15) return 'var(--orange)'
      return 'var(--green)'
    },
    cpuTextClass(cpu) {
      if (cpu > 50) return 'text-apple-red'
      if (cpu > 20) return 'text-apple-orange'
      return ''
    },
    cpuBarClass(cpu) {
      if (cpu > 50) return 'bg-apple-red'
      if (cpu > 20) return 'bg-apple-orange'
      return 'bg-apple-green'
    },
    cpuBarStyle(cpu) {
      return 'width: ' + Math.min(100, cpu) + '%;'
    },
    healthScoreStyle() {
      return 'color: ' + this.healthColor()
    },
    diskDotStyle(pct) {
      return 'background: ' + this.diskDotColor(pct)
    },
    startupDotStyle(count) {
      return 'background: ' + this.startupDotColor(count)
    },
    diskProgressStyle(pct) {
      return 'width: ' + pct + '%; background: ' + this.diskDotColor(pct) + ';'
    },
  }
}
