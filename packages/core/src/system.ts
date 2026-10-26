import * as fs from 'node:fs'
import * as os from 'node:os'
import type { DiskInfo, SystemInfo } from './types'
import { bootMountPoint, listDisks } from './disks'
import { NEEDS_PORTABLE_SIZER, sizeOfTree, sizeOfTreeAsync } from './dirsize'
import { exec, execSync, shellEscape } from './exec'

/**
 * Get comprehensive system information
 */
export async function getSystemInfo(): Promise<SystemInfo> {
  const cpus = os.cpus()

  // Single system_profiler call for both serial and model (was two separate calls)
  const [macosVersion, hwInfo, physicalCores] = await Promise.all([
    exec('sw_vers -productVersion').then(r => r.ok ? r.stdout : 'Unknown'),
    exec('system_profiler SPHardwareDataType 2>/dev/null').then(r => r.ok ? r.stdout : ''),
    exec('sysctl -n hw.physicalcpu').then(r => r.ok ? Number.parseInt(r.stdout) || cpus.length : cpus.length),
  ])

  const serialNumber = hwInfo.match(/Serial Number.*?:\s*(.+)/)?.[1]?.trim() || ''
  const modelName = hwInfo.match(/Model Name:\s*(.+)/)?.[1]?.trim() || ''

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
 * Get disk usage information for all mounted volumes.
 *
 * The implementation moved to ./disks, which reads the sizes from `statfs`
 * rather than out of `df`'s columns. Two reasons, both load-bearing: `exec`
 * runs every command through `sh -c` and Windows has no `sh`, and on APFS the
 * `used` and `total` columns describe different scopes, so dividing one by the
 * other reported this 85%-full disk as 2% full.
 */
export async function getDiskInfo(): Promise<DiskInfo[]> {
  return await listDisks()
}

/**
 * Get the primary disk info (boot volume)
 */
export async function getPrimaryDiskInfo(): Promise<DiskInfo | null> {
  const disks = await getDiskInfo()
  const boot = bootMountPoint()
  // Matched against the platform's own boot mount rather than a literal '/',
  // which no Windows volume is ever called.
  return disks.find(d => d.mountPoint === boot) || disks[0] || null
}

/**
 * Get the size of a directory using `du`, or a portable walk where there is no
 * `du` to run.
 *
 * Windows has no `du`. The spawn failed ENOENT, `exec` reported not-ok, and
 * this returned 0 — which the screens above it render as an empty chart and a
 * clean machine. A size of zero and "I could not measure" have to be
 * different answers, so on Windows the walk in `dirsize.ts` does the job
 * instead. `du` stays the default wherever it exists, because it is several
 * times faster.
 */
export async function getDirSize(dirPath: string): Promise<number> {
  // The async form on purpose. `du` ran in another process, so a 15-second
  // measure cost this one nothing; an in-process walk awaited from a request
  // handler would freeze the agent that serves the UI for the whole duration.
  if (NEEDS_PORTABLE_SIZER)
    return await sizeOfTreeAsync(dirPath, { deadline: Date.now() + 15_000 })

  const result = await exec(`du -sk ${shellEscape(dirPath)} 2>/dev/null | cut -f1`, { timeout: 15_000 })
  if (!result.ok)
    return 0
  return (Number.parseInt(result.stdout) || 0) * 1024
}

/**
 * Get the size of a directory synchronously
 */
export function getDirSizeSync(dirPath: string): number {
  if (NEEDS_PORTABLE_SIZER)
    return sizeOfTree(dirPath, { deadline: Date.now() + 15_000 })

  const out = execSync(`du -sk ${shellEscape(dirPath)} 2>/dev/null | cut -f1`, { timeout: 15_000 })
  return (Number.parseInt(out) || 0) * 1024
}

/**
 * Get multiple directory sizes concurrently
 */
export async function getDirSizes(paths: string[]): Promise<Record<string, number>> {
  const results: Record<string, number> = {}
  const BATCH = 8

  for (let i = 0; i < paths.length; i += BATCH) {
    const batch = paths.slice(i, i + BATCH)
    await Promise.all(
      batch.map(async (p) => {
        results[p] = await getDirSize(p)
      }),
    )
  }

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

/**
 * Free bytes on the filesystem that holds this path, or null if it cannot be
 * read.
 *
 * `statfs` rather than a directory walk, because the two disagree in exactly
 * the case that matters. Unlinking a file a process still holds open removes
 * its directory entry immediately but frees none of its blocks until the
 * holder closes it. `du` stops counting the file; the disk does not give the
 * space back. Measured on a 200 MB file held open by a live process:
 *
 *   du  delta: 200.0 MB freed
 *   df  delta:  -0.1 MB freed
 *   after the holder exited: the 200 MB came back
 *
 * So a clean that reports its `du` delta can claim hundreds of megabytes while
 * Disk Free does not move - which is the complaint this app has already had
 * once, for a different reason, in the words "its either misreading the size
 * or cleaning here does nothing, just fake stuff".
 *
 * One syscall, ~0.4ms, and it agrees with `df` to the byte.
 */
export function freeSpaceOf(target: string): number | null {
  try {
    const st = fs.statfsSync(target)
    return Number(st.bavail) * Number(st.bsize)
  }
  catch {
    return null
  }
}
