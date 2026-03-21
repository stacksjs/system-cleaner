import * as os from 'node:os'
import { exec, execSync } from '@system-cleaner/core'
import type { CpuMetrics } from './types'

let lastCpuTimes: { idle: number, total: number }[] | null = null
let cachedTopology: { pCores: number, eCores: number } | null = null
let topologyCacheTime = 0
const TOPOLOGY_CACHE_TTL = 600_000 // 10 minutes

/**
 * Collect CPU metrics with per-core usage and Apple Silicon topology.
 * Uses a two-read delta pattern for accurate usage calculation.
 */
export async function getCpuMetrics(): Promise<CpuMetrics> {
  const cpus = os.cpus()
  const loadAvg = os.loadavg()

  // Calculate per-core usage from delta between readings
  const currentTimes = cpus.map((cpu) => {
    const total = Object.values(cpu.times).reduce((a, b) => a + b, 0)
    return { idle: cpu.times.idle, total }
  })

  let usagePercent = 0
  const perCoreUsage: number[] = []

  if (lastCpuTimes && lastCpuTimes.length === currentTimes.length) {
    let totalIdle = 0
    let totalDelta = 0

    for (let i = 0; i < currentTimes.length; i++) {
      const idleDelta = currentTimes[i].idle - lastCpuTimes[i].idle
      const totalDeltaCore = currentTimes[i].total - lastCpuTimes[i].total
      if (totalDeltaCore > 0) {
        const coreUsage = Math.round((1 - idleDelta / totalDeltaCore) * 100)
        perCoreUsage.push(Math.max(0, Math.min(100, coreUsage)))
      }
      else {
        perCoreUsage.push(0)
      }
      totalIdle += idleDelta
      totalDelta += totalDeltaCore
    }

    usagePercent = totalDelta > 0 ? Math.round((1 - totalIdle / totalDelta) * 100) : 0
  }
  else {
    // First reading — fall back to ps-based aggregation (matching Mole's fallback)
    const psResult = await exec('ps -Aceo pcpu 2>/dev/null | tail -n +2 | awk \'{s+=$1} END {print s}\'', { timeout: 3000 })
    if (psResult.ok) {
      const totalPercent = Number.parseFloat(psResult.stdout) || 0
      usagePercent = Math.min(100, Math.round(totalPercent / cpus.length))
    }
    else {
      usagePercent = Math.min(100, Math.round((loadAvg[0] / cpus.length) * 100))
    }
    for (let i = 0; i < cpus.length; i++)
      perCoreUsage.push(usagePercent)
  }

  lastCpuTimes = currentTimes

  // P/E core topology (cached)
  const { pCores, eCores } = await detectCoreTopology()

  // CPU temperature via ioreg (Apple Silicon) — non-blocking, best-effort
  const temperature = await getCpuTemperature()

  return {
    modelName: cpus[0]?.model || 'Unknown',
    logicalCores: cpus.length,
    physicalCores: Number.parseInt(execSync('sysctl -n hw.physicalcpu') || '0') || cpus.length,
    performanceCores: pCores,
    efficiencyCores: eCores,
    usagePercent: Math.max(0, Math.min(100, usagePercent)),
    perCoreUsage,
    loadAvg1: loadAvg[0],
    loadAvg5: loadAvg[1],
    loadAvg15: loadAvg[2],
    temperature,
  }
}

async function detectCoreTopology(): Promise<{ pCores: number, eCores: number }> {
  if (cachedTopology && Date.now() - topologyCacheTime < TOPOLOGY_CACHE_TTL)
    return cachedTopology

  if (os.arch() !== 'arm64') {
    cachedTopology = { pCores: 0, eCores: 0 }
    topologyCacheTime = Date.now()
    return cachedTopology
  }

  const [pResult, eResult] = await Promise.all([
    exec('sysctl -n hw.perflevel0.logicalcpu 2>/dev/null'),
    exec('sysctl -n hw.perflevel1.logicalcpu 2>/dev/null'),
  ])

  cachedTopology = {
    pCores: pResult.ok ? Number.parseInt(pResult.stdout) || 0 : 0,
    eCores: eResult.ok ? Number.parseInt(eResult.stdout) || 0 : 0,
  }
  topologyCacheTime = Date.now()
  return cachedTopology
}

/**
 * Read CPU temperature via ioreg (Apple Silicon) or sysctl fallback.
 * Matches Mole's approach: ioreg → sysctl thermal level → undefined.
 */
async function getCpuTemperature(): Promise<number | undefined> {
  // Apple Silicon: ioreg for battery temperature (proxy for SoC temp)
  if (os.arch() === 'arm64') {
    const result = await exec('ioreg -rn AppleSmartBattery 2>/dev/null | grep Temperature', { timeout: 2000 })
    if (result.ok) {
      const match = result.stdout.match(/"Temperature"\s*=\s*(\d+)/)
      if (match) {
        return Number.parseInt(match[1]) / 100
      }
    }

    // Fallback: sysctl thermal level → estimate
    const thermalResult = await exec('sysctl -n machdep.xcpm.cpu_thermal_level 2>/dev/null', { timeout: 1000 })
    if (thermalResult.ok) {
      const level = Number.parseInt(thermalResult.stdout) || 0
      return 45 + level * 0.5
    }
  }

  return undefined
}
