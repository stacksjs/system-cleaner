import * as os from 'node:os'
import * as path from 'node:path'
import { exec } from '@system-cleaner/core'
import type { ProcessInfo } from './types'

/**
 * Get top processes by CPU and memory usage
 */
export async function getTopProcesses(count = 20): Promise<ProcessInfo[]> {
  const result = await exec('ps aux 2>/dev/null', { timeout: 5000 })
  if (!result.ok)
    return []

  const lines = result.stdout.split('\n').slice(1)
  const totalMem = os.totalmem()
  const procs: ProcessInfo[] = []

  for (const line of lines) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 11)
      continue

    const user = parts[0]
    const pid = Number.parseInt(parts[1])
    const cpu = Number.parseFloat(parts[2]) || 0
    const mem = Number.parseFloat(parts[3]) || 0
    const command = parts.slice(10).join(' ')

    // Filter out low-usage system processes
    if (user === 'root' && cpu < 0.1 && mem < 0.1)
      continue
    if (command.startsWith('/usr/libexec/') && cpu < 0.1)
      continue
    if (command.startsWith('/System/') && cpu < 0.1 && mem < 0.1)
      continue

    // Only include processes with notable resource usage
    if (cpu >= 0.1 || mem >= 0.3) {
      const isSystem = user === 'root' || user.startsWith('_')
      procs.push({
        pid,
        name: path.basename(command.split(' ')[0]),
        fullCommand: command.slice(0, 200),
        user,
        cpuPercent: cpu,
        memoryPercent: mem,
        memoryMB: Math.round((mem * totalMem) / 100 / 1e6),
        isSystem,
      })
    }
  }

  // Sort by CPU descending
  procs.sort((a, b) => b.cpuPercent - a.cpuPercent)
  return procs.slice(0, count)
}

/**
 * Get all running processes (no filter)
 */
export async function getAllProcesses(): Promise<ProcessInfo[]> {
  const result = await exec('ps aux 2>/dev/null', { timeout: 5000 })
  if (!result.ok)
    return []

  const lines = result.stdout.split('\n').slice(1)
  const totalMem = os.totalmem()
  const procs: ProcessInfo[] = []

  for (const line of lines) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 11)
      continue

    const user = parts[0]
    const pid = Number.parseInt(parts[1])
    const cpu = Number.parseFloat(parts[2]) || 0
    const mem = Number.parseFloat(parts[3]) || 0
    const command = parts.slice(10).join(' ')
    const isSystem = user === 'root' || user.startsWith('_')

    procs.push({
      pid,
      name: path.basename(command.split(' ')[0]),
      fullCommand: command.slice(0, 200),
      user,
      cpuPercent: cpu,
      memoryPercent: mem,
      memoryMB: Math.round((mem * totalMem) / 100 / 1e6),
      isSystem,
    })
  }

  return procs.sort((a, b) => b.cpuPercent - a.cpuPercent)
}

/**
 * Find processes that are consuming high CPU (potential runaways)
 */
export async function findHighCpuProcesses(thresholdPercent = 80): Promise<ProcessInfo[]> {
  const procs = await getTopProcesses(100)
  return procs.filter(p => p.cpuPercent >= thresholdPercent)
}

/**
 * Get summary stats from processes
 */
export function summarizeProcesses(procs: ProcessInfo[]): {
  totalCpuPercent: number
  totalMemoryMB: number
  count: number
  topCpu: ProcessInfo | null
  topMemory: ProcessInfo | null
} {
  const totalCpuPercent = procs.reduce((sum, p) => sum + p.cpuPercent, 0)
  const totalMemoryMB = procs.reduce((sum, p) => sum + p.memoryMB, 0)

  // Find max by each metric without mutating (avoids double-sort confusion)
  let topCpu: ProcessInfo | null = null
  let topMemory: ProcessInfo | null = null
  for (const p of procs) {
    if (!topCpu || p.cpuPercent > topCpu.cpuPercent) topCpu = p
    if (!topMemory || p.memoryMB > topMemory.memoryMB) topMemory = p
  }

  return {
    totalCpuPercent,
    totalMemoryMB,
    count: procs.length,
    topCpu,
    topMemory,
  }
}
