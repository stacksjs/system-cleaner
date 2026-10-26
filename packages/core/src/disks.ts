import type { DiskInfo } from './types'
import * as fs from 'node:fs'
import process from 'node:process'
import { isWindows } from './platform'

/**
 * Mounted volumes and how full they are, without a shell.
 *
 * Two problems, one fix.
 *
 * **The shell.** This came from `exec('df -k')`, and `exec` runs everything
 * through `sh -c`. Windows has no `sh`. It is on the PATH of a developer
 * machine with Git for Windows installed and absent from everyone else's, so
 * the dashboard's disk figures worked for the person who built it and silently
 * came back empty for everyone else — which is the shape of a bug that passes
 * CI and ships.
 *
 * **The arithmetic.** The numbers were read out of `df`'s columns, and on APFS
 * two of those columns describe different things. Measured on the machine this
 * was written against:
 *
 *     df   total 460.4 GB   used 11.6 GB   avail 67.2 GB   (df itself: 15%)
 *     code usedPercent = used / total                       ->  2%
 *     real 460.4 - 67.2 = 393.3 GB used                     -> 85%
 *
 * `/` is a sealed system volume inside a volume group, so `df`'s *used* is
 * that one volume's 11.6 GB while *total* is the whole container's 460 GB.
 * Dividing one by the other is not a percentage of anything. A disk-cleaning
 * app whose dashboard reports 2% full on an 85% full disk is arguing against
 * its own reason to exist.
 *
 * So the sizes come from `statfs`, which answers about one filesystem and
 * cannot mix scopes, and `df` — where it is used at all — is reduced to
 * enumerating mount points and naming devices, which is the part `statfs`
 * cannot do.
 */

/** Below this a volume is a recovery or boot partition, not storage. */
const MIN_INTERESTING_BYTES = 1024 * 1024 * 1024

/** Mount points that exist but are not storage anyone cleans. */
function isUninteresting(mountPoint: string): boolean {
  return mountPoint.startsWith('/System/Volumes/')
    || mountPoint === '/dev'
    || mountPoint.startsWith('/private/var/vm')
}

/**
 * How long to wait for one volume to describe itself.
 *
 * A disconnected network mapping answers `statfs` only when it times out at
 * the SMB layer, which can take tens of seconds. The async form plus this
 * deadline keeps one dead drive letter from holding the dashboard — and
 * `statfsSync` would have held the whole agent.
 */
const PROBE_TIMEOUT_MS = 2000

export interface VolumeUsage {
  totalBytes: number
  usedBytes: number
  freeBytes: number
}

/**
 * One filesystem's sizes, or null when it will not answer.
 *
 * `bavail` rather than `bfree` for free space: the difference is the reserve
 * only root may write into, and offering it as reclaimable space would be a
 * lie to every caller that is not root. `used` is then derived as total minus
 * free, which is the only definition consistent with the other two — and the
 * one `df`'s own percentage column uses.
 */
export async function usageOf(mountPoint: string): Promise<VolumeUsage | null> {
  let stat: fs.StatsFs
  try {
    stat = await withTimeout(fs.promises.statfs(mountPoint), PROBE_TIMEOUT_MS)
  }
  catch {
    return null
  }

  const blockSize = Number(stat.bsize)
  const totalBytes = Number(stat.blocks) * blockSize
  const freeBytes = Number(stat.bavail) * blockSize
  if (!Number.isFinite(totalBytes) || totalBytes <= 0)
    return null

  return {
    totalBytes,
    freeBytes,
    usedBytes: Math.max(0, totalBytes - freeBytes),
  }
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), ms)
    work.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (err) => { clearTimeout(timer); reject(err) },
    )
  })
}

/** A mount point to describe, and the device name to show beside it. */
interface Mount {
  mountPoint: string
  filesystem: string
}

/**
 * The POSIX mount table, from `df` spawned directly.
 *
 * Directly, not through `exec`: the shell was the portability problem, not
 * `df`. And only the device and mount-point columns are read — the size
 * columns are the ones that disagree with themselves on APFS.
 *
 * `-P` is the whole reason this parses at all. The previous version ran plain
 * `df -k` while reading the mount point as the sixth column, which is the
 * POSIX layout `-P` produces. Without it macOS prints three inode columns
 * first, so every mount point came back as the string
 * `455008 702793320 0% /` — which matched none of the skip rules, was never
 * equal to `/`, and left `getPrimaryDiskInfo` silently falling back to
 * whichever volume happened to be listed first.
 */
async function posixMounts(): Promise<Mount[]> {
  let stdout: string
  try {
    const proc = Bun.spawn(['df', '-P', '-k'], { stdout: 'pipe', stderr: 'ignore' })
    stdout = await new Response(proc.stdout).text()
    await proc.exited
  }
  catch {
    return []
  }

  const mounts: Mount[] = []
  const seen = new Set<string>()

  for (const line of stdout.split('\n').slice(1)) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 6)
      continue

    // The mount point is the last column and may contain spaces, so it is
    // whatever follows the fixed six.
    const mountPoint = parts.slice(5).join(' ')
    if (!mountPoint.startsWith('/') || isUninteresting(mountPoint) || seen.has(parts[0]))
      continue

    seen.add(parts[0])
    mounts.push({ mountPoint, filesystem: parts[0] })
  }

  return mounts
}

/**
 * The drive letters that answer, probed concurrently.
 *
 * There is no portable way to ask Windows for its volume list — `GetLogicalDrives`
 * needs FFI and `Get-PSDrive` needs a PowerShell launch on every dashboard
 * refresh — so all twenty-six are asked at once and the ones that answer are
 * the ones that exist. A letter that is a dead network mapping simply misses
 * its deadline instead of holding up the others.
 */
async function windowsVolumes(): Promise<Mount[]> {
  const letters = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i))

  const probes = await Promise.all(letters.map(async (letter) => {
    const mountPoint = `${letter}:\\`
    const usage = await usageOf(mountPoint)
    return usage ? { mountPoint, filesystem: `${letter}:` } : null
  }))

  return probes.filter((m): m is Mount => m !== null)
}

/**
 * Every mounted volume worth showing, with sizes that agree with each other.
 */
export async function listDisks(): Promise<DiskInfo[]> {
  const mounts = isWindows ? await windowsVolumes() : await posixMounts()

  const described = await Promise.all(mounts.map(async (mount) => {
    const usage = await usageOf(mount.mountPoint)
    if (!usage || usage.totalBytes < MIN_INTERESTING_BYTES)
      return null

    return {
      mountPoint: mount.mountPoint,
      filesystem: mount.filesystem,
      totalBytes: usage.totalBytes,
      usedBytes: usage.usedBytes,
      freeBytes: usage.freeBytes,
      usedPercent: Math.round((usage.usedBytes / usage.totalBytes) * 100),
    } satisfies DiskInfo
  }))

  return described.filter((d): d is DiskInfo => d !== null)
}

/**
 * The volume the OS booted from.
 *
 * `/` on POSIX, `%SystemDrive%\` on Windows — which is usually `C:\` and is
 * not guaranteed to be.
 */
export function bootMountPoint(): string {
  if (!isWindows)
    return '/'
  const drive = process.env.SystemDrive || 'C:'
  return drive.endsWith('\\') ? drive : `${drive}\\`
}
