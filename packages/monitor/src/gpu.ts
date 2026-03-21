import * as os from 'node:os'
import { exec } from '@system-cleaner/core'
import type { GpuMetrics } from './types'

let cachedGpuInfo: { model: string, vendor: string, vramMB: number } | null = null
let cacheTime = 0
const CACHE_TTL = 600_000 // 10 minutes for static GPU info

/**
 * Collect GPU metrics
 */
export async function getGpuMetrics(): Promise<GpuMetrics | null> {
  // Get static GPU info (cached)
  const info = await getGpuInfo()
  if (!info)
    return null

  // Get dynamic usage
  const usage = await getGpuUsage()

  return {
    model: info.model,
    vendor: info.vendor,
    vramMB: info.vramMB,
    usagePercent: usage.percent,
    temperature: usage.temperature,
  }
}

async function getGpuInfo(): Promise<{ model: string, vendor: string, vramMB: number } | null> {
  if (cachedGpuInfo && Date.now() - cacheTime < CACHE_TTL)
    return cachedGpuInfo

  const result = await exec(
    'system_profiler SPDisplaysDataType 2>/dev/null',
    { timeout: 10_000 },
  )

  if (!result.ok)
    return null

  const output = result.stdout

  // Parse chipset/model
  const modelMatch = output.match(/Chipset Model:\s*(.+)/i)
    || output.match(/Chip:\s*(.+)/i)
  const model = modelMatch?.[1]?.trim() || 'Unknown GPU'

  // Parse vendor
  const vendorMatch = output.match(/Vendor:\s*(.+)/i)
  const vendor = vendorMatch?.[1]?.trim()
    || (os.arch() === 'arm64' ? 'Apple' : 'Unknown')

  // Parse VRAM
  const vramMatch = output.match(/VRAM\s*(?:\(Total\))?:\s*(\d+)\s*(MB|GB)/i)
  let vramMB = 0
  if (vramMatch) {
    vramMB = Number.parseInt(vramMatch[1])
    if (vramMatch[2] === 'GB')
      vramMB *= 1024
  }

  // Apple Silicon uses unified memory
  if (vramMB === 0 && os.arch() === 'arm64')
    vramMB = Math.round(os.totalmem() / 1e6)

  cachedGpuInfo = { model, vendor, vramMB }
  cacheTime = Date.now()
  return cachedGpuInfo
}

async function getGpuUsage(): Promise<{ percent: number, temperature?: number }> {
  if (os.arch() === 'arm64') {
    return getAppleSiliconGpuUsage()
  }

  // Try nvidia-smi for discrete GPUs
  const result = await exec('nvidia-smi --query-gpu=utilization.gpu,temperature.gpu --format=csv,noheader,nounits 2>/dev/null', { timeout: 3000 })
  if (result.ok) {
    const parts = result.stdout.split(',').map(s => s.trim())
    return {
      percent: Number.parseInt(parts[0]) || 0,
      temperature: Number.parseInt(parts[1]) || undefined,
    }
  }

  return { percent: 0 }
}

async function getAppleSiliconGpuUsage(): Promise<{ percent: number, temperature?: number }> {
  // powermetrics requires sudo — try but don't fail
  const result = await exec(
    'sudo powermetrics --samplers gpu_power -i1000 -n1 2>/dev/null | grep "GPU active residency"',
    { timeout: 5000 },
  )

  if (result.ok) {
    const match = result.stdout.match(/([\d.]+)%/)
    if (match) {
      return { percent: Math.round(Number.parseFloat(match[1])) }
    }
  }

  // Fallback: estimate from ioreg
  const ioResult = await exec('ioreg -r -d 1 -c IOAccelerator 2>/dev/null | grep "PerformanceStatistics" -A 20', { timeout: 3000 })
  if (ioResult.ok) {
    const utilizationMatch = ioResult.stdout.match(/"Device Utilization %"\s*=\s*(\d+)/)
    if (utilizationMatch) {
      return { percent: Number.parseInt(utilizationMatch[1]) }
    }
  }

  return { percent: 0 }
}
