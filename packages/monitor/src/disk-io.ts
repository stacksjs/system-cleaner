import { exec, getDiskInfo } from '@system-cleaner/core'
import type { DiskIoMetrics, DiskPartitionMetrics } from '@system-cleaner/core'
import type { CollectorState } from './types'

/**
 * Collect disk I/O metrics using RAW df values (honest reporting).
 *
 * Unlike Mole which replaces raw values with Finder osascript (which counts
 * purgeable space as "free" and misleads users with full disks), we:
 *   1. Use raw df values as truth (matches what the user experiences)
 *   2. Collect purgeable space separately as supplementary info
 *   3. Feed raw values to health score (so "disk full" warnings fire correctly)
 */
export async function getDiskIoMetrics(state: CollectorState): Promise<DiskIoMetrics> {
  const diskInfo = await getDiskInfo()
  const ioRates = await getIoRates()

  const partitions: DiskPartitionMetrics[] = diskInfo.map(disk => ({
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
 * Get APFS purgeable space for the boot volume.
 * This is space macOS CAN free (caches, snapshots) but hasn't yet.
 * Useful as supplementary info but NOT a replacement for actual free space.
 */
export async function getPurgeableSpace(): Promise<{ purgeableBytes: number, finderFreeBytes: number } | null> {
  const result = await exec(
    `osascript -e 'tell application "Finder" to return {free space of startup disk, capacity of startup disk}' 2>/dev/null`,
    { timeout: 5000 },
  )

  if (!result.ok)
    return null

  const parts = result.stdout.split(',').map(s => Number.parseInt(s.trim()))
  if (parts.length !== 2 || parts[0] <= 0 || parts[1] <= 0)
    return null

  const finderFreeBytes = parts[0]

  // Get actual free space from df
  const dfResult = await exec('df -k / 2>/dev/null | tail -1', { timeout: 3000 })
  if (!dfResult.ok)
    return null

  const dfParts = dfResult.stdout.split(/\s+/)
  const rawFreeBytes = (Number.parseInt(dfParts[3]) || 0) * 1024

  // Purgeable = Finder's "free" minus actual free
  const purgeableBytes = Math.max(0, finderFreeBytes - rawFreeBytes)

  return { purgeableBytes, finderFreeBytes }
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
