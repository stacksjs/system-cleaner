import { exec, getDiskInfo } from '@system-cleaner/core'
import type { DiskIoMetrics, DiskPartitionMetrics } from '@system-cleaner/core'
import type { CollectorState } from './types'

/**
 * Collect disk I/O metrics with APFS-corrected disk sizes.
 * Uses a 3-tier correction strategy matching Mole:
 *   1. Finder via osascript (startup disk "/" only — most accurate)
 *   2. diskutil APFS container free space (corrects APFS snapshots)
 *   3. Raw df values (fallback)
 */
export async function getDiskIoMetrics(state: CollectorState): Promise<DiskIoMetrics> {
  const diskInfo = await getDiskInfo()
  const ioRates = await getIoRates()

  // Apply APFS correction to the boot volume
  const corrected = await apfsCorrectBootVolume(diskInfo)

  const partitions: DiskPartitionMetrics[] = corrected.map(disk => ({
    name: disk.filesystem,
    mountPoint: disk.mountPoint,
    totalBytes: disk.totalBytes,
    usedBytes: disk.usedBytes,
    freeBytes: disk.freeBytes,
    usedPercent: disk.usedPercent,
    readBytesPerSec: ioRates.readBytesPerSec,
    writeBytesPerSec: ioRates.writeBytesPerSec,
  }))

  return { partitions }
}

/**
 * Correct APFS-reported disk usage using Finder (most accurate for "/").
 * APFS purgeable space inflates raw `df` usage numbers.
 */
async function apfsCorrectBootVolume(
  disks: { mountPoint: string, filesystem: string, totalBytes: number, usedBytes: number, freeBytes: number, usedPercent: number }[],
) {
  const result = [...disks]

  for (let i = 0; i < result.length; i++) {
    if (result[i].mountPoint !== '/')
      continue

    // Tier 1: Finder (most accurate — includes purgeable space)
    const finderResult = await exec(
      `osascript -e 'tell application "Finder" to return {free space of startup disk, capacity of startup disk}' 2>/dev/null`,
      { timeout: 5000 },
    )

    if (finderResult.ok) {
      const parts = finderResult.stdout.split(',').map(s => Number.parseInt(s.trim()))
      if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) {
        const [freeBytes, totalBytes] = parts
        const usedBytes = totalBytes - freeBytes
        result[i] = {
          ...result[i],
          totalBytes,
          usedBytes,
          freeBytes,
          usedPercent: Math.round((usedBytes / totalBytes) * 100),
        }
        break
      }
    }

    // Tier 2: diskutil APFS container free space
    const diskutilResult = await exec(
      `diskutil info -plist / 2>/dev/null | grep -A1 APFSContainerFree | grep integer | sed 's/[^0-9]//g'`,
      { timeout: 5000 },
    )

    if (diskutilResult.ok && diskutilResult.stdout) {
      const containerFree = Number.parseInt(diskutilResult.stdout)
      if (containerFree > 0 && containerFree > result[i].freeBytes) {
        const usedBytes = result[i].totalBytes - containerFree
        result[i] = {
          ...result[i],
          freeBytes: containerFree,
          usedBytes,
          usedPercent: Math.round((usedBytes / result[i].totalBytes) * 100),
        }
      }
    }

    break
  }

  return result
}

async function getIoRates(): Promise<{ readBytesPerSec: number, writeBytesPerSec: number }> {
  const result = await exec('iostat -d -c 2 -w 1 2>/dev/null | tail -1', { timeout: 5000 })
  if (!result.ok)
    return { readBytesPerSec: 0, writeBytesPerSec: 0 }

  const parts = result.stdout.trim().split(/\s+/)
  if (parts.length >= 3) {
    const mbPerSec = Number.parseFloat(parts[2]) || 0
    return {
      readBytesPerSec: Math.max(0, mbPerSec * 1e6 * 0.5),
      writeBytesPerSec: Math.max(0, mbPerSec * 1e6 * 0.5),
    }
  }

  return { readBytesPerSec: 0, writeBytesPerSec: 0 }
}
