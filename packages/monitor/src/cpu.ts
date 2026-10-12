import * as os from 'node:os'
import { exec, execSync } from '@system-cleaner/core'
import type { CpuMetrics } from './types'

let lastCpuTimes: { idle: number, total: number }[] | null = null
let cachedTopology: { pCores: number, eCores: number } | null = null
let topologyCacheTime = 0
let cachedPhysicalCores: number | null = null
const TOPOLOGY_CACHE_TTL = 600_000 // 10 minutes

/**
 * Processor utilisation, measured rather than inferred, on any platform.
 *
 * `os.cpus()` reports cumulative per-core times everywhere, so two samples a
 * short interval apart give true utilisation with no shell and no per-platform
 * command. That matters twice over:
 *
 *  - The dashboard derived CPU by summing `ps -Aceo pcpu` across processes and
 *    dividing by core count. `ps` does not exist on Windows, so the figure was
 *    always 0% — a busy machine reported as idle, and a health score that saw
 *    no CPU pressure and inflated itself accordingly.
 *  - Even on macOS that sum was a poor proxy: `ps` reports a process's
 *    *lifetime average* CPU, not what it is using now, and it counts no kernel
 *    time at all.
 *
 * The cost is the sampling window, which is why it is a parameter: the caller
 * decides how much accuracy a reading is worth.
 */
export async function sampleCpuUsage(windowMs = 120): Promise<{ usagePercent: number, perCoreUsage: number[] }> {
  const read = (): { idle: number, total: number }[] =>
    os.cpus().map(cpu => ({
      idle: cpu.times.idle,
      total: Object.values(cpu.times).reduce((a, b) => a + b, 0),
    }))

  const first = read()
  await new Promise(resolve => setTimeout(resolve, windowMs))
  const second = read()

  const perCoreUsage: number[] = []
  let idleDelta = 0
  let totalDelta = 0

  for (let i = 0; i < second.length; i++) {
    const previous = first[i]
    // A core that appeared between samples has nothing to compare against.
    if (!previous) {
      perCoreUsage.push(0)
      continue
    }
    const idle = second[i].idle - previous.idle
    const total = second[i].total - previous.total
    perCoreUsage.push(total > 0 ? clampPercent(Math.round((1 - idle / total) * 100)) : 0)
    idleDelta += idle
    totalDelta += total
  }

  return {
    usagePercent: totalDelta > 0 ? clampPercent(Math.round((1 - idleDelta / totalDelta) * 100)) : 0,
    perCoreUsage,
  }
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value))
}

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
    // No previous reading to diff against, so take the second sample here
    // rather than guessing. This used to aggregate `ps -Aceo pcpu` and fall
    // back to `os.loadavg()` — the first does not exist on Windows and the
    // second reports zeros there, so the very first CPU figure the app showed
    // on that platform was always 0%.
    const sampled = await sampleCpuUsage()
    usagePercent = sampled.usagePercent
    perCoreUsage.push(...sampled.perCoreUsage)
  }

  lastCpuTimes = currentTimes

  // P/E core topology (cached)
  const { pCores, eCores } = await detectCoreTopology()

  // CPU temperature via ioreg (Apple Silicon) — non-blocking, best-effort
  const temperature = await getCpuTemperature()

  return {
    modelName: cpus[0]?.model || 'Unknown',
    logicalCores: cpus.length,
    physicalCores: getPhysicalCores(cpus.length),
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

function getPhysicalCores(fallback: number): number {
  if (cachedPhysicalCores !== null)
    return cachedPhysicalCores
  cachedPhysicalCores = Number.parseInt(execSync('sysctl -n hw.physicalcpu') || '0') || fallback
  return cachedPhysicalCores
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
