import * as os from 'node:os'
import { getPrimaryDiskInfo } from '@system-cleaner/core'
import { sampleCpuUsage } from '@system-cleaner/monitor'

export interface SystemStatus {
  sampledAt: number
  hostname: string
  cpu: { percent: number, model: string, cores: number }
  memory: { totalBytes: number, usedBytes: number, availableBytes: number, usedPercent: number }
  disk: { totalBytes: number, usedBytes: number, freeBytes: number, usedPercent: number } | null
  uptimeSeconds: number
}

export function memoryUsage(totalBytes: number, freeBytes: number): SystemStatus['memory'] {
  const availableBytes = Math.max(0, Math.min(totalBytes, freeBytes))
  const usedBytes = Math.max(0, totalBytes - availableBytes)
  return { totalBytes, availableBytes, usedBytes, usedPercent: totalBytes > 0 ? Math.round(usedBytes / totalBytes * 100) : 0 }
}

let pending: Promise<SystemStatus> | undefined
let diskRead: ReturnType<typeof getPrimaryDiskInfo> | undefined
let diskReadAt = 0

/** No process listings, cleanup walks, or startup-item scans for a tray refresh. */
export function getSystemStatus(): Promise<SystemStatus> {
  if (pending) return pending
  if (!diskRead || Date.now() - diskReadAt > 15000) {
    diskReadAt = Date.now()
    diskRead = getPrimaryDiskInfo().catch(() => null)
  }
  pending = Promise.all([sampleCpuUsage(), diskRead]).then(([cpu, disk]) => {
    const cpus = os.cpus()
    return {
      sampledAt: Date.now(), hostname: os.hostname(),
      cpu: { percent: cpu.usagePercent, model: cpus[0]?.model || 'Processor', cores: cpus.length },
      memory: memoryUsage(os.totalmem(), os.freemem()),
      disk: disk ? { totalBytes: disk.totalBytes, usedBytes: disk.usedBytes, freeBytes: disk.freeBytes, usedPercent: disk.usedPercent } : null,
      uptimeSeconds: os.uptime(),
    }
  }).finally(() => { pending = undefined })
  return pending
}
