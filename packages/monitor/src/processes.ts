import * as os from 'node:os'
import * as path from 'node:path'
import { exec, isWindows } from '@system-cleaner/core'
import type { ProcessInfo } from './types'
import { parseTasklist, toProcessInfo } from './processes-windows'

/**
 * Get top processes by CPU and memory usage
 */
export async function getTopProcesses(count = 20): Promise<ProcessInfo[]> {
  return parseProcessList(true, count)
}

/**
 * Get all running processes (no filter)
 */
export async function getAllProcesses(): Promise<ProcessInfo[]> {
  return parseProcessList(false)
}

/** How long to wait between the two Windows readings. */
const WINDOWS_CPU_WINDOW_MS = 400

/**
 * Two `tasklist` readings, far enough apart to measure CPU between them.
 *
 * Spawned directly rather than through `exec`, which wraps everything in
 * `sh -c` — the shell Windows does not have, and the reason this returned an
 * empty list there.
 */
async function windowsProcesses(): Promise<ProcessInfo[]> {
  const read = async (): Promise<string | null> => {
    try {
      const proc = Bun.spawn(['tasklist.exe', '/FO', 'CSV', '/NH', '/V'], { stdout: 'pipe', stderr: 'ignore' })
      const timer = setTimeout(() => proc.kill(), 8000)
      const stdout = await new Response(proc.stdout).text()
      const code = await proc.exited
      clearTimeout(timer)
      return code === 0 && stdout.trim() ? stdout : null
    }
    catch {
      return null
    }
  }

  const first = await read()
  if (first === null)
    return []

  const startedAt = Date.now()
  await new Promise(resolve => setTimeout(resolve, WINDOWS_CPU_WINDOW_MS))
  const second = await read()
  if (second === null)
    return []

  // The real elapsed time, not the nominal one: the second `tasklist` takes
  // long enough on a busy machine that assuming 400ms would overstate every
  // percentage.
  return toProcessInfo(parseTasklist(first), parseTasklist(second), Date.now() - startedAt, os.totalmem())
}

async function parseProcessList(filterLowUsage: boolean, limit?: number): Promise<ProcessInfo[]> {
  if (isWindows) {
    const all = await windowsProcesses()
    const kept = filterLowUsage
      // The macOS filter below is written around `root`, `/usr/libexec` and
      // `/System`, none of which mean anything here. The equivalent is a
      // process using neither measurable CPU nor a noticeable slice of memory.
      ? all.filter(p => p.cpuPercent >= 0.1 || p.memoryPercent >= 0.3)
      : all
    kept.sort((a, b) => b.cpuPercent - a.cpuPercent)
    return limit ? kept.slice(0, limit) : kept
  }

  const result = await exec('ps -Arc -o user=,pid=,pcpu=,pmem=,command= 2>/dev/null', { timeout: 3000 })
  if (!result.ok)
    return []

  const lines = result.stdout.split('\n').filter(Boolean)
  const totalMem = os.totalmem()
  const procs: ProcessInfo[] = []

  for (const line of lines) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 5)
      continue

    const user = parts[0]
    const pid = Number.parseInt(parts[1])
    const cpu = Number.parseFloat(parts[2]) || 0
    const mem = Number.parseFloat(parts[3]) || 0
    const command = parts.slice(4).join(' ')

    if (filterLowUsage) {
      if (user === 'root' && cpu < 0.1 && mem < 0.1)
        continue
      if (command.startsWith('/usr/libexec/') && cpu < 0.1)
        continue
      if (command.startsWith('/System/') && cpu < 0.1 && mem < 0.1)
        continue
      if (cpu < 0.1 && mem < 0.3)
        continue
    }

    const cmdPath = command.split(' ')[0]
    procs.push({
      pid,
      name: cmdPath ? path.basename(cmdPath) : `pid-${pid}`,
      fullCommand: command.slice(0, 200),
      user,
      cpuPercent: cpu,
      memoryPercent: mem,
      memoryMB: Math.round((mem * totalMem) / 100 / 1e6),
      isSystem: user === 'root' || user.startsWith('_'),
    })
  }

  procs.sort((a, b) => b.cpuPercent - a.cpuPercent)
  return limit ? procs.slice(0, limit) : procs
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
