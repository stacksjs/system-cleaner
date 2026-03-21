import { exec } from '@system-cleaner/core'
import type { NetworkInterfaceMetrics, NetworkMetrics } from '@system-cleaner/core'
import type { CollectorState } from './types'

// Interfaces to monitor (skip loopback, virtual)
const MONITORED_PREFIXES = ['en', 'bridge', 'awdl']
const SKIP_PREFIXES = ['lo', 'gif', 'stf', 'ap', 'llw', 'anpi']

/**
 * Collect network metrics with rate calculation
 */
export async function getNetworkMetrics(state: CollectorState): Promise<NetworkMetrics> {
  const result = await exec('netstat -ibn 2>/dev/null', { timeout: 5000 })
  if (!result.ok)
    return { interfaces: [] }

  const lines = result.stdout.split('\n').slice(1)
  const interfaces: NetworkInterfaceMetrics[] = []
  const seen = new Set<string>()
  const now = Date.now()

  for (const line of lines) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 7)
      continue

    const name = parts[0]
    if (seen.has(name))
      continue
    if (SKIP_PREFIXES.some(p => name.startsWith(p)))
      continue
    if (!MONITORED_PREFIXES.some(p => name.startsWith(p)))
      continue

    seen.add(name)

    // netstat -ibn columns: Name, Mtu, Network, Address, Ipkts, Ierrs, Ibytes, Opkts, Oerrs, Obytes
    const rxTotalBytes = Number.parseInt(parts[6]) || 0
    const txTotalBytes = Number.parseInt(parts[9]) || 0

    if (rxTotalBytes === 0 && txTotalBytes === 0)
      continue

    // Calculate rates from previous snapshot
    let rxBytesPerSec = 0
    let txBytesPerSec = 0
    const prev = state.lastNetworkSnapshot.get(name)

    if (prev) {
      const timeDeltaSec = (now - prev.timestamp) / 1000
      if (timeDeltaSec > 0) {
        rxBytesPerSec = Math.max(0, (rxTotalBytes - prev.rxBytes) / timeDeltaSec)
        txBytesPerSec = Math.max(0, (txTotalBytes - prev.txBytes) / timeDeltaSec)
      }
    }

    // Update snapshot
    state.lastNetworkSnapshot.set(name, { rxBytes: rxTotalBytes, txBytes: txTotalBytes, timestamp: now })

    // Get IP address
    const ipAddress = await getInterfaceIp(name)
    const isUp = rxTotalBytes > 0 || txTotalBytes > 0

    interfaces.push({
      name,
      ipAddress,
      rxBytesPerSec,
      txBytesPerSec,
      rxTotalBytes,
      txTotalBytes,
      isUp,
    })
  }

  return { interfaces }
}

async function getInterfaceIp(interfaceName: string): Promise<string> {
  const result = await exec(`ipconfig getifaddr ${interfaceName} 2>/dev/null`, { timeout: 2000 })
  return result.ok ? result.stdout.trim() : ''
}
