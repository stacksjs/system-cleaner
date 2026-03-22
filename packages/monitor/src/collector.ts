import * as os from 'node:os'
import type { SystemSnapshot } from '@system-cleaner/core'
import type { CollectorState, MonitorOptions } from './types'
import { getCpuMetrics } from './cpu'
import { getMemoryMetrics } from './memory'
import { getDiskIoMetrics } from './disk-io'
import { getNetworkMetrics } from './network'
import { getGpuMetrics } from './gpu'
import { getBatteryMetrics } from './battery'
import { getTopProcesses } from './processes'
import { calculateHealthScore } from './health'

/**
 * Collect a full system snapshot
 */
export async function collectSnapshot(
  state: CollectorState,
  options: MonitorOptions = {},
): Promise<SystemSnapshot> {
  const includeCpu = options.includeCpu !== false
  const includeMemory = options.includeMemory !== false
  const includeDisk = options.includeDisk !== false
  const includeNetwork = options.includeNetwork !== false
  const includeGpu = options.includeGpu !== false
  const includeBattery = options.includeBattery !== false
  const includeProcesses = options.includeProcesses !== false
  const processCount = options.processCount ?? 20

  // Collect all metrics concurrently
  const [cpu, memory, diskIo, network, gpu, battery, processes] = await Promise.all([
    includeCpu ? getCpuMetrics() : defaultCpuMetrics(),
    includeMemory ? getMemoryMetrics() : defaultMemoryMetrics(),
    includeDisk ? getDiskIoMetrics(state) : { partitions: [] },
    includeNetwork ? getNetworkMetrics(state) : { interfaces: [] },
    includeGpu ? getGpuMetrics() : null,
    includeBattery ? getBatteryMetrics() : null,
    includeProcesses ? getTopProcesses(processCount) : [],
  ])

  // Timestamp set after all metrics collected (not before)
  const health = calculateHealthScore(cpu, memory, diskIo, battery)
  const timestamp = new Date()

  return {
    timestamp,
    cpu,
    memory,
    diskIo,
    network,
    gpu,
    battery,
    processes,
    health,
  }
}

/**
 * Create initial collector state
 */
export function createCollectorState(): CollectorState {
  return {
    lastNetworkSnapshot: new Map(),
    lastDiskSnapshot: new Map(),
  }
}

/**
 * Start continuous monitoring with a callback on each snapshot.
 * Guards against tick overlap — if a collection is still running when the
 * next interval fires, the new tick is skipped.
 */
export function startMonitoring(
  options: MonitorOptions & { onSnapshot: (snapshot: SystemSnapshot) => void },
): { stop: () => void } {
  const state = createCollectorState()
  const intervalMs = options.intervalMs ?? 2000
  let running = true
  let collecting = false

  const tick = async () => {
    if (!running || collecting)
      return
    collecting = true
    try {
      const snapshot = await collectSnapshot(state, options)
      if (running)
        options.onSnapshot(snapshot)
    }
    catch {
      // Skip failed collections
    }
    finally {
      collecting = false
    }
  }

  // Immediately collect first snapshot
  tick()

  const interval = setInterval(tick, intervalMs)

  return {
    stop: () => {
      running = false
      clearInterval(interval)
    },
  }
}

// Default metrics when collection is disabled (no dynamic requires)
function defaultCpuMetrics() {
  const cpus = os.cpus()
  return {
    modelName: cpus[0]?.model || 'Unknown',
    logicalCores: cpus.length,
    physicalCores: cpus.length,
    performanceCores: 0,
    efficiencyCores: 0,
    usagePercent: 0,
    perCoreUsage: [] as number[],
    loadAvg1: 0,
    loadAvg5: 0,
    loadAvg15: 0,
  }
}

function defaultMemoryMetrics() {
  return {
    totalBytes: os.totalmem(),
    usedBytes: os.totalmem() - os.freemem(),
    freeBytes: os.freemem(),
    activeBytes: 0,
    wiredBytes: 0,
    compressedBytes: 0,
    swapUsedBytes: 0,
    swapTotalBytes: 0,
    usagePercent: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100),
    pressure: 'nominal' as const,
  }
}
