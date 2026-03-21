import type {
  BatteryMetrics,
  CpuMetrics,
  DiskIoMetrics,
  GpuMetrics,
  HealthScore,
  MemoryMetrics,
  NetworkMetrics,
  ProcessInfo,
  SystemSnapshot,
} from '@system-cleaner/core'

export type {
  BatteryMetrics,
  CpuMetrics,
  DiskIoMetrics,
  GpuMetrics,
  HealthScore,
  MemoryMetrics,
  NetworkMetrics,
  ProcessInfo,
  SystemSnapshot,
}

export interface MonitorOptions {
  intervalMs?: number
  includeCpu?: boolean
  includeMemory?: boolean
  includeDisk?: boolean
  includeNetwork?: boolean
  includeGpu?: boolean
  includeBattery?: boolean
  includeProcesses?: boolean
  processCount?: number
}

export interface CollectorState {
  lastNetworkSnapshot: Map<string, { rxBytes: number, txBytes: number, timestamp: number }>
  lastDiskSnapshot: Map<string, { readBytes: number, writeBytes: number, timestamp: number }>
}
