import type { ControlResult, ManagedConnection } from '../../app/Support/Vpn/control'
import type { VpnStatus } from '../../app/Support/Vpn/status'

type Operation = 'connect' | 'disconnect' | 'install'
type Reading = VpnStatus & {
  connection: ManagedConnection | null
  operation: Operation | null
  needsRestore: boolean
  restriction: string | null
}
type Routing = 'mesh' | 'exit'

const PROFILE = 'systemcleaner-vpn-profile'

function savedProfile(): { coordinator: string, routing: Routing } {
  try {
    const profile = JSON.parse(localStorage.getItem(PROFILE) || '{}')
    return {
      coordinator: typeof profile.coordinator === 'string' ? profile.coordinator : '',
      routing: profile.routing === 'exit' ? 'exit' : 'mesh',
    }
  }
  catch {
    return { coordinator: '', routing: 'mesh' }
  }
}

async function request<T>(action: string, body: object, timeout: number): Promise<T & ControlResult> {
  const response = await fetch(`/api/vpn-${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  })
  const result = await response.json()
  if (!result?.success)
    throw new Error(result?.error || 'The VPN service did not respond.')
  return result
}

function vpnXData() {
  const profile = savedProfile()
  let poll: number | undefined
  let refreshRequest = 0
  let onFocus: (() => void) | undefined

  return {
    reading: null as Reading | null,
    coordinator: profile.coordinator,
    routing: profile.routing,
    authKey: '',
    showKey: false,
    working: null as Operation | null,
    refreshing: false,
    statusError: '',
    notice: '',
    failed: false,

    init() {
      onFocus = () => { void this.refresh() }
      window.addEventListener('focus', onFocus)
      poll = window.setInterval(onFocus, 4000)
      void this.refresh()
    },

    stop() {
      window.clearInterval(poll)
      if (onFocus)
        window.removeEventListener('focus', onFocus)
      refreshRequest++
    },

    async refresh(force = false) {
      if (this.refreshing && !force)
        return
      const sequence = ++refreshRequest
      this.refreshing = true
      try {
        const reading = await request<Reading>('status', { refresh: force }, 26_000)
        if (sequence === refreshRequest) {
          this.reading = reading
          this.statusError = ''
        }
      }
      catch {
        if (sequence === refreshRequest)
          this.statusError = this.reading ? 'Status is temporarily unavailable. Showing the last reading.' : 'Could not reach the VPN service. Try refreshing.'
      }
      finally {
        if (sequence === refreshRequest)
          this.refreshing = false
      }
    },

    operation() {
      return this.working || this.reading?.operation
    },

    available() {
      return Boolean(this.reading?.supported && !this.reading?.restriction)
    },

    title() {
      const operation = this.operation()
      if (operation === 'install') return 'Installing Localtunnels'
      if (operation === 'connect') return 'Connecting'
      if (operation === 'disconnect') return 'Disconnecting'
      if (!this.reading) return this.statusError ? 'Status unavailable' : 'Checking status'
      if (!this.available()) return 'VPN unavailable'
      if (this.reading.connected) return 'Connected'
      if (this.reading.connection) return 'Tunnel not ready'
      if (this.reading.needsRestore) return 'Network restore needed'
      if (this.reading.core.updateRequired) return 'Update required'
      return this.reading.core.healthy ? 'Disconnected' : 'Setup required'
    },

    summary() {
      const operation = this.operation()
      if (operation === 'install') return 'Downloading and checking the VPN core.'
      if (operation === 'connect' || operation === 'disconnect') return 'Approve the administrator prompt if macOS asks.'
      if (!this.reading) return 'Localtunnels VPN'
      if (this.reading.restriction) return this.reading.restriction
      if (!this.reading.supported) return 'Localtunnels VPN control is available on macOS.'
      if (this.reading.connected)
        return this.reading.connection?.mode === 'exit' ? 'Internet traffic and DNS use your network’s exit node.' : 'Private network traffic uses the tunnel.'
      if (this.reading.connection) return 'The VPN process is running, but the tunnel interface is unavailable.'
      if (this.reading.needsRestore) return 'Restore the network settings from the previous exit-node session.'
      if (this.reading.core.updateRequired) return 'Update the VPN core for faster reconnects and reliable exit-node routing.'
      if (!this.reading.core.healthy) return 'Install the VPN core to join your private network.'
      return 'Connect to your network’s Localtunnels coordinator.'
    },

    tone() {
      if (this.operation()) return 'working'
      return this.reading?.connected ? 'connected' : 'idle'
    },

    coreSummary() {
      if (!this.reading) return 'Checking…'
      if (!this.reading.core.available) return 'Not installed'
      if (this.reading.core.updateRequired) return 'Update available'
      return this.reading.core.healthy ? this.reading.core.version || 'Ready' : 'Self-test failed'
    },

    setupLabel() {
      if (this.operation() === 'install') return 'Installing…'
      if (this.reading?.core.updateRequired) return 'Update Localtunnels'
      return this.reading?.core.available ? 'Repair Localtunnels' : 'Install Localtunnels'
    },

    async act(action: Operation) {
      if (!this.available() || this.operation())
        return
      const coordinator = this.coordinator.trim()
      if (action === 'connect' && (!this.reading?.core.healthy || !coordinator))
        return

      this.failed = false
      this.notice = ''
      this.working = action
      try {
        await request(action, action === 'connect' ? {
          coordinatorUrl: coordinator,
          authKey: this.authKey.trim(),
          useExit: this.routing === 'exit' ? 'auto' : '',
        } : {}, 175_000)
        if (action === 'connect') {
          this.authKey = ''
          this.showKey = false
          try {
            localStorage.setItem(PROFILE, JSON.stringify({ coordinator, routing: this.routing }))
          }
          catch {
            // The connection can still be used when storage is unavailable.
          }
        }
      }
      catch (error) {
        const message = error instanceof Error ? error.message : 'The VPN operation failed.'
        this.failed = message !== 'Cancelled'
        this.notice = this.failed ? message : 'Authorization cancelled.'
      }
      finally {
        await this.refresh(true)
        this.working = null
      }
    },
  }
}

export function registerVpnState(): void {
  Object.assign(window, { vpnXData })
}
