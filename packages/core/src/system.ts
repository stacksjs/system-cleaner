import * as os from 'node:os'
import type { DiskInfo, SystemInfo } from './types'
import { exec, execSync } from './exec'
import { HOME } from './paths'

/**
 * Get comprehensive system information
 */
export async function getSystemInfo(): Promise<SystemInfo> {
  const cpus = os.cpus()

  const [macosVersion, serialNumber, modelName, physicalCores] = await Promise.all([
    exec('sw_vers -productVersion').then(r => r.ok ? r.stdout : 'Unknown'),
    exec('system_profiler SPHardwareDataType 2>/dev/null | grep "Serial Number" | awk -F": " \'{print $2}\'').then(r => r.ok ? r.stdout : ''),
    exec('system_profiler SPHardwareDataType 2>/dev/null | grep "Model Name" | awk -F": " \'{print $2}\'').then(r => r.ok ? r.stdout : ''),
    exec('sysctl -n hw.physicalcpu').then(r => r.ok ? Number.parseInt(r.stdout) || cpus.length : cpus.length),
  ])

  return {
    hostname: os.hostname(),
    username: os.userInfo().username,
    macosVersion,
    cpuModel: cpus[0]?.model || 'Unknown',
    cpuCores: cpus.length,
    cpuPhysicalCores: physicalCores,
    totalMemoryBytes: os.totalmem(),
    totalMemoryGB: Math.round(os.totalmem() / 1e9),
    uptimeSeconds: os.uptime(),
    serialNumber,
    modelName,
  }
}

/**
 * Get synchronous basic system info (for SSR contexts)
 */
export function getSystemInfoSync(): SystemInfo {
  const cpus = os.cpus()
  return {
    hostname: os.hostname(),
    username: os.userInfo().username,
    macosVersion: execSync('sw_vers -productVersion') || 'Unknown',
    cpuModel: cpus[0]?.model || 'Unknown',
    cpuCores: cpus.length,
    cpuPhysicalCores: Number.parseInt(execSync('sysctl -n hw.physicalcpu') || '0') || cpus.length,
    totalMemoryBytes: os.totalmem(),
    totalMemoryGB: Math.round(os.totalmem() / 1e9),
    uptimeSeconds: os.uptime(),
    serialNumber: '',
    modelName: '',
  }
}

/**
 * Get disk usage information for all mounted volumes
 */
export async function getDiskInfo(): Promise<DiskInfo[]> {
  const result = await exec('df -k 2>/dev/null')
  if (!result.ok)
    return []

  const lines = result.stdout.split('\n').slice(1)
  const disks: DiskInfo[] = []
  const seen = new Set<string>()

  for (const line of lines) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 6)
      continue

    const mountPoint = parts.slice(5).join(' ')

    // Skip virtual/system volumes
    if (
      mountPoint.startsWith('/System/Volumes/')
      || mountPoint === '/dev'
      || mountPoint.startsWith('/private/var/vm')
      || seen.has(parts[0])
    )
      continue

    const totalKB = Number.parseInt(parts[1]) || 0
    const usedKB = Number.parseInt(parts[2]) || 0
    const freeKB = Number.parseInt(parts[3]) || 0

    if (totalKB < 1_048_576)
      continue // Skip volumes < 1GB

    seen.add(parts[0])
    disks.push({
      mountPoint,
      filesystem: parts[0],
      totalBytes: totalKB * 1024,
      usedBytes: usedKB * 1024,
      freeBytes: freeKB * 1024,
      usedPercent: totalKB > 0 ? Math.round((usedKB / totalKB) * 100) : 0,
    })
  }

  return disks
}

/**
 * Get the primary disk info (boot volume)
 */
export async function getPrimaryDiskInfo(): Promise<DiskInfo | null> {
  const disks = await getDiskInfo()
  return disks.find(d => d.mountPoint === '/') || disks[0] || null
}

/**
 * Get the size of a directory using `du`
 */
export async function getDirSize(dirPath: string): Promise<number> {
  const result = await exec(`du -sk "${dirPath}" 2>/dev/null | cut -f1`, { timeout: 15_000 })
  if (!result.ok)
    return 0
  return (Number.parseInt(result.stdout) || 0) * 1024
}

/**
 * Get the size of a directory synchronously
 */
export function getDirSizeSync(dirPath: string): number {
  const out = execSync(`du -sk "${dirPath}" 2>/dev/null | cut -f1`, { timeout: 15_000 })
  return (Number.parseInt(out) || 0) * 1024
}

/**
 * Get multiple directory sizes concurrently
 */
export async function getDirSizes(paths: string[]): Promise<Record<string, number>> {
  const results: Record<string, number> = {}

  await Promise.all(
    paths.map(async (p) => {
      results[p] = await getDirSize(p)
    }),
  )

  return results
}

/**
 * Check if running on Apple Silicon
 */
export function isAppleSilicon(): boolean {
  return os.arch() === 'arm64'
}

/**
 * Get the macOS major version number
 */
export function getMacOSMajorVersion(): number {
  const version = execSync('sw_vers -productVersion')
  return Number.parseInt(version.split('.')[0]) || 0
}
