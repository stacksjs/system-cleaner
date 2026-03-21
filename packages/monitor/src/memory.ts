import * as os from 'node:os'
import { exec } from '@system-cleaner/core'
import type { MemoryMetrics } from './types'

/**
 * Collect memory metrics using vm_stat for detailed breakdown
 */
export async function getMemoryMetrics(): Promise<MemoryMetrics> {
  const totalBytes = os.totalmem()
  const freeBytes = os.freemem()
  const usedBytes = totalBytes - freeBytes

  // Get detailed vm_stat data for macOS-specific metrics
  const vmStat = await parseVmStat()

  // Get swap info
  const swap = await getSwapInfo()

  const usagePercent = Math.round((usedBytes / totalBytes) * 100)

  // Use macOS memory_pressure command for accurate pressure detection
  let pressure: 'nominal' | 'warning' | 'critical' = 'nominal'
  const pressureResult = await exec('memory_pressure 2>/dev/null | head -1', { timeout: 2000 })
  if (pressureResult.ok) {
    const output = pressureResult.stdout.toLowerCase()
    if (output.includes('critical'))
      pressure = 'critical'
    else if (output.includes('warn'))
      pressure = 'warning'
  }
  else {
    // Fallback to percentage-based estimation
    if (usagePercent > 90)
      pressure = 'critical'
    else if (usagePercent > 75)
      pressure = 'warning'
  }

  return {
    totalBytes,
    usedBytes,
    freeBytes,
    activeBytes: vmStat.active,
    wiredBytes: vmStat.wired,
    compressedBytes: vmStat.compressed,
    swapUsedBytes: swap.used,
    swapTotalBytes: swap.total,
    usagePercent,
    pressure,
  }
}

interface VmStatData {
  active: number
  wired: number
  compressed: number
  inactive: number
  free: number
  pageSize: number
}

async function parseVmStat(): Promise<VmStatData> {
  const result = await exec('vm_stat', { timeout: 3000 })
  if (!result.ok) {
    return { active: 0, wired: 0, compressed: 0, inactive: 0, free: 0, pageSize: 4096 }
  }

  const output = result.stdout
  const pageSize = Number.parseInt(output.match(/page size of (\d+) bytes/)?.[1] || '4096')

  const getPages = (label: string): number => {
    const match = output.match(new RegExp(`${label}:\\s+(\\d+)`))
    return match ? Number.parseInt(match[1]) * pageSize : 0
  }

  return {
    active: getPages('Pages active'),
    wired: getPages('Pages wired down'),
    compressed: getPages('Pages occupied by compressor'),
    inactive: getPages('Pages inactive'),
    free: getPages('Pages free'),
    pageSize,
  }
}

async function getSwapInfo(): Promise<{ used: number, total: number }> {
  const result = await exec('sysctl -n vm.swapusage', { timeout: 3000 })
  if (!result.ok)
    return { used: 0, total: 0 }

  // Format: "total = 2048.00M  used = 512.00M  free = 1536.00M"
  const parseVal = (label: string): number => {
    const match = result.stdout.match(new RegExp(`${label}\\s*=\\s*([\\d.]+)(\\w)`))
    if (!match)
      return 0
    const val = Number.parseFloat(match[1])
    if (Number.isNaN(val))
      return 0
    const unit = match[2].toUpperCase()
    if (unit === 'G')
      return val * 1e9
    if (unit === 'M')
      return val * 1e6
    if (unit === 'K')
      return val * 1e3
    return val
  }

  return {
    total: parseVal('total'),
    used: parseVal('used'),
  }
}
