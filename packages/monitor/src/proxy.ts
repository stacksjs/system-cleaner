import { exec } from '@system-cleaner/core'

export interface ProxyStatus {
  enabled: boolean
  type: string // 'HTTP' | 'HTTPS' | 'SOCKS' | 'PAC' | 'WPAD' | 'TUN' | 'none'
  host: string
}

/**
 * Detect proxy configuration.
 * Four-tier detection matching Mole:
 *   1. Environment variables (https_proxy, http_proxy, all_proxy)
 *   2. macOS scutil --proxy (SOCKS, HTTPS, HTTP, PAC, WPAD)
 *   3. Active TUN interfaces (VPN heuristic)
 *   4. No proxy
 */
export async function getProxyStatus(): Promise<ProxyStatus> {
  // Tier 1: Environment variables
  for (const key of ['https_proxy', 'HTTPS_PROXY', 'http_proxy', 'HTTP_PROXY', 'all_proxy', 'ALL_PROXY']) {
    const val = process.env[key]
    if (val) {
      const type = key.toLowerCase().includes('https') ? 'HTTPS' : key.toLowerCase().includes('http') ? 'HTTP' : 'SOCKS'
      return { enabled: true, type, host: val }
    }
  }

  // Tier 2: macOS system proxy via scutil
  const scutil = await exec('scutil --proxy 2>/dev/null', { timeout: 2000 })
  if (scutil.ok) {
    const output = scutil.stdout

    // SOCKS proxy
    if (/SOCKSEnable\s*:\s*1/.test(output)) {
      const host = output.match(/SOCKSProxy\s*:\s*(\S+)/)?.[1] || ''
      const port = output.match(/SOCKSPort\s*:\s*(\d+)/)?.[1] || ''
      return { enabled: true, type: 'SOCKS', host: host && port ? `${host}:${port}` : host || port }
    }

    // HTTPS proxy
    if (/HTTPSEnable\s*:\s*1/.test(output)) {
      const host = output.match(/HTTPSProxy\s*:\s*(\S+)/)?.[1] || ''
      const port = output.match(/HTTPSPort\s*:\s*(\d+)/)?.[1] || ''
      return { enabled: true, type: 'HTTPS', host: host && port ? `${host}:${port}` : host || port }
    }

    // HTTP proxy
    if (/HTTPEnable\s*:\s*1/.test(output)) {
      const host = output.match(/HTTPProxy\s*:\s*(\S+)/)?.[1] || ''
      const port = output.match(/HTTPPort\s*:\s*(\d+)/)?.[1] || ''
      return { enabled: true, type: 'HTTP', host: host && port ? `${host}:${port}` : host || port }
    }

    // PAC (Proxy Auto-Config)
    if (/ProxyAutoConfigEnable\s*:\s*1/.test(output)) {
      const url = output.match(/ProxyAutoConfigURLString\s*:\s*(\S+)/)?.[1] || ''
      return { enabled: true, type: 'PAC', host: url }
    }

    // WPAD (Web Proxy Auto-Discovery)
    if (/ProxyAutoDiscoveryEnable\s*:\s*1/.test(output)) {
      return { enabled: true, type: 'WPAD', host: 'auto-discovery' }
    }
  }

  // Tier 3: TUN interface detection (VPN heuristic)
  const netstat = await exec('netstat -ibn 2>/dev/null | grep -E "^(utun|tun)"', { timeout: 2000 })
  if (netstat.ok && netstat.stdout) {
    for (const line of netstat.stdout.split('\n')) {
      const parts = line.trim().split(/\s+/)
      if (parts.length >= 7) {
        const rxBytes = Number.parseInt(parts[6]) || 0
        const txBytes = Number.parseInt(parts[9]) || 0
        if (rxBytes + txBytes > 0) {
          return { enabled: true, type: 'TUN', host: parts[0] }
        }
      }
    }
  }

  return { enabled: false, type: 'none', host: '' }
}
