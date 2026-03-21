import * as os from 'node:os'
import { exec, execSync } from '@system-cleaner/core'
import type { CpuMetrics } from './types'

let lastCpuTimes: { idle: number, total: number }[] | null = null

/**
 * Collect CPU metrics
 */
export async function getCpuMetrics(): Promise<CpuMetrics> {
  const cpus = os.cpus()
  const loadAvg = os.loadavg()

  // CPU usage calculated from delta between readings
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
    // First reading — fall back to load average estimation
    usagePercent = Math.min(100, Math.round((loadAvg[0] / cpus.length) * 100))
    for (let i = 0; i < cpus.length; i++)
      perCoreUsage.push(usagePercent)
  }

  lastCpuTimes = currentTimes

  // Detect P/E cores on Apple Silicon
  const { performanceCores, efficiencyCores } = await detectCoreTypes()

  // CPU temperature (may not be available)
  const temperature = await getCpuTemperature()

  return {
    modelName: cpus[0]?.model || 'Unknown',
    logicalCores: cpus.length,
    physicalCores: Number.parseInt(execSync('sysctl -n hw.physicalcpu') || '0') || cpus.length,
    performanceCores,
    efficiencyCores,
    usagePercent: Math.max(0, Math.min(100, usagePercent)),
    perCoreUsage,
    loadAvg1: loadAvg[0],
    loadAvg5: loadAvg[1],
    loadAvg15: loadAvg[2],
    temperature,
  }
}

async function detectCoreTypes(): Promise<{ performanceCores: number, efficiencyCores: number }> {
  if (os.arch() !== 'arm64')
    return { performanceCores: 0, efficiencyCores: 0 }

  const [pResult, eResult] = await Promise.all([
    exec('sysctl -n hw.perflevel0.logicalcpu 2>/dev/null'),
    exec('sysctl -n hw.perflevel1.logicalcpu 2>/dev/null'),
  ])

  return {
    performanceCores: pResult.ok ? Number.parseInt(pResult.stdout) || 0 : 0,
    efficiencyCores: eResult.ok ? Number.parseInt(eResult.stdout) || 0 : 0,
  }
}

async function getCpuTemperature(): Promise<number | undefined> {
  // Try powermetrics (requires sudo, so this is best-effort)
  const result = await exec('sudo powermetrics --samplers smc -i1 -n1 2>/dev/null | grep "CPU die temperature"', { timeout: 3000 })
  if (result.ok) {
    const match = result.stdout.match(/([\d.]+)\s*C/)
    if (match)
      return Number.parseFloat(match[1])
  }
  return undefined
}
