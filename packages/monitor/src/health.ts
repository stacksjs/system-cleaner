import type { CpuMetrics, HealthScore, MemoryMetrics, DiskIoMetrics, BatteryMetrics } from './types'

/**
 * Calculate a composite health score (0-100) from system metrics.
 *
 * Matches Mole's weighted algorithm:
 *   CPU:     30%  (threshold: 30% normal, 70% high)
 *   Memory:  25%  (threshold: 50% normal, 80% high + pressure)
 *   Disk:    20%  (threshold: 70% warn, 90% critical)
 *   Thermal: 15%  (threshold: 60°C normal, 85°C high)
 *   IO:      10%  (threshold: 50 MB/s normal, 150 MB/s high)
 */
export function calculateHealthScore(
  cpu: CpuMetrics,
  memory: MemoryMetrics,
  disk: DiskIoMetrics,
  battery: BatteryMetrics | null,
  startupItemCount = 0,
): HealthScore {
  const factors: HealthScore['factors'] = []
  let score = 100

  // ── CPU (weight: 30) ───────────────────────────────────────
  const cpuUsage = cpu.usagePercent
  if (cpuUsage > 70) {
    const penalty = Math.min(30, Math.round(((cpuUsage - 70) / 30) * 30))
    score -= penalty
    factors.push({ name: 'CPU', impact: penalty, description: `CPU at ${cpuUsage}%` })
  }
  else if (cpuUsage > 30) {
    const penalty = Math.min(15, Math.round(((cpuUsage - 30) / 40) * 15))
    score -= penalty
    factors.push({ name: 'CPU', impact: penalty, description: `CPU at ${cpuUsage}%` })
  }

  // Load average relative to cores
  const loadRatio = cpu.loadAvg5 / Math.max(cpu.logicalCores, 1)
  if (loadRatio > 2) {
    const penalty = Math.min(10, Math.round((loadRatio - 2) * 5))
    score -= penalty
    factors.push({ name: 'Load', impact: penalty, description: `Load ${cpu.loadAvg5.toFixed(1)} (${loadRatio.toFixed(1)}x cores)` })
  }

  // ── Memory (weight: 25) ────────────────────────────────────
  if (memory.usagePercent > 80) {
    const penalty = Math.min(25, Math.round(((memory.usagePercent - 80) / 20) * 25))
    score -= penalty
    factors.push({ name: 'Memory', impact: penalty, description: `Memory at ${memory.usagePercent}%` })
  }
  else if (memory.usagePercent > 50) {
    const penalty = Math.min(12, Math.round(((memory.usagePercent - 50) / 30) * 12))
    score -= penalty
    if (penalty >= 3)
      factors.push({ name: 'Memory', impact: penalty, description: `Memory at ${memory.usagePercent}%` })
  }

  // Memory pressure adds extra penalty
  if (memory.pressure === 'critical') {
    score -= 15
    factors.push({ name: 'Memory Pressure', impact: 15, description: 'Critical memory pressure' })
  }
  else if (memory.pressure === 'warning') {
    score -= 5
    factors.push({ name: 'Memory Pressure', impact: 5, description: 'Warning memory pressure' })
  }

  // Swap over 2GB is a strong signal
  if (memory.swapUsedBytes > 2e9) {
    const swapGB = memory.swapUsedBytes / 1e9
    const penalty = Math.min(10, Math.round(swapGB * 3))
    score -= penalty
    factors.push({ name: 'Swap', impact: penalty, description: `${swapGB.toFixed(1)} GB swap used` })
  }

  // ── Disk (weight: 20) — worst partition determines penalty ──
  let worstDiskPenalty = 0
  let worstDiskDesc = ''
  for (const partition of disk.partitions) {
    let penalty = 0
    let desc = ''
    if (partition.usedPercent > 90) {
      penalty = Math.min(20, Math.round(((partition.usedPercent - 90) / 10) * 20))
      desc = `${partition.mountPoint} at ${partition.usedPercent}% — ${formatGB(partition.freeBytes)} free`
    }
    else if (partition.usedPercent > 70) {
      penalty = Math.min(10, Math.round(((partition.usedPercent - 70) / 20) * 10))
      desc = `${partition.mountPoint} at ${partition.usedPercent}%`
    }
    if (penalty > worstDiskPenalty) {
      worstDiskPenalty = penalty
      worstDiskDesc = desc
    }
  }
  if (worstDiskPenalty > 0) {
    score -= worstDiskPenalty
    factors.push({ name: 'Disk', impact: worstDiskPenalty, description: worstDiskDesc })
  }

  // ── Thermal (weight: 15) — via CPU temperature ─────────────
  if (cpu.temperature !== undefined) {
    if (cpu.temperature >= 85) {
      const penalty = Math.min(15, Math.round(((cpu.temperature - 85) / 15) * 15))
      score -= penalty
      factors.push({ name: 'Temperature', impact: penalty, description: `CPU at ${cpu.temperature.toFixed(0)}°C — overheating` })
    }
    else if (cpu.temperature >= 60) {
      const penalty = Math.min(7, Math.round(((cpu.temperature - 60) / 25) * 7))
      score -= penalty
      if (penalty >= 3)
        factors.push({ name: 'Temperature', impact: penalty, description: `CPU at ${cpu.temperature.toFixed(0)}°C` })
    }
  }

  // ── Disk IO (weight: 10) ───────────────────────────────────
  const totalIo = disk.partitions.reduce((sum, p) => sum + p.readBytesPerSec + p.writeBytesPerSec, 0)
  const ioMBps = totalIo / 1e6
  if (ioMBps > 150) {
    const penalty = Math.min(10, Math.round(((ioMBps - 150) / 150) * 10))
    score -= penalty
    factors.push({ name: 'Disk IO', impact: penalty, description: `Heavy disk IO: ${ioMBps.toFixed(0)} MB/s` })
  }

  // ── Startup items ──────────────────────────────────────────
  if (startupItemCount > 20) {
    const penalty = Math.min(5, Math.floor((startupItemCount - 20) / 10))
    score -= penalty
    if (penalty > 0)
      factors.push({ name: 'Startup', impact: penalty, description: `${startupItemCount} startup items` })
  }

  // ── Battery health ─────────────────────────────────────────
  if (battery?.isPresent && battery.healthPercent < 80) {
    const penalty = Math.min(5, Math.round((80 - battery.healthPercent) * 0.25))
    score -= penalty
    factors.push({ name: 'Battery', impact: penalty, description: `Battery health at ${battery.healthPercent}%` })
  }

  // ── Final score ────────────────────────────────────────────
  score = Math.max(0, Math.min(100, score))

  let label: HealthScore['label']
  let color: string

  if (score >= 90) {
    label = 'Excellent'
    color = '#34c759'
  }
  else if (score >= 75) {
    label = 'Good'
    color = '#30d158'
  }
  else if (score >= 60) {
    label = 'Fair'
    color = '#ff9f0a'
  }
  else if (score >= 40) {
    label = 'Poor'
    color = '#ff453a'
  }
  else {
    label = 'Critical'
    color = '#ff453a'
  }

  return { score, label, color, factors }
}

function formatGB(bytes: number): string {
  return `${(bytes / 1e9).toFixed(1)} GB`
}
