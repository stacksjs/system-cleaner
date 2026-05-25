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

    get healthScore() { return this.stats ? this.stats.healthScore : 75 },
    get healthLabel() {
      var s = this.healthScore
      return s >= 90 ? 'Excellent' : s >= 75 ? 'Good' : s >= 60 ? 'Fair' : s >= 40 ? 'Poor' : 'Critical'
    },
    get healthColor() {
      var s = this.healthScore
      return s >= 90 ? '#34c759' : s >= 75 ? '#30d158' : s >= 60 ? '#ff9f0a' : '#ff453a'
    },
    get healthDashoffset() {
      return String(2 * Math.PI * 40 * (1 - this.healthScore / 100))
    },

    diskDotColor(pct) {
      if (pct > 90) return '#ff453a'
      if (pct > 75) return '#ff9f0a'
      return '#30d158'
    },
    startupDotColor(count) {
      if (count > 30) return '#ff453a'
      if (count > 15) return '#ff9f0a'
      return '#30d158'
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
      return 'color: ' + this.healthColor
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
