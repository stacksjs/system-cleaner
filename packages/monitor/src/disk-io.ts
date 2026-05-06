import { exec, getDiskInfo } from '@system-cleaner/core'
import type { DiskIoMetrics, DiskPartitionMetrics } from '@system-cleaner/core'
import type { CollectorState } from './types'

/**
 * Collect disk I/O metrics using RAW df values plus per-direction byte
 * counters from `ioreg -rc IOBlockStorageDriver`.
 *
 * Earlier versions parsed `iostat -d` and split the total MB/s 50/50
 * into `readBytesPerSec` and `writeBytesPerSec` — those numbers were
 * fabricated. `ioreg` exposes cumulative `Bytes (Read)` and
 * `Bytes (Write)` per disk; sample twice with a short gap and diff to
 * get an honest rate (the same approach Activity Monitor uses).
 */
// eslint-disable-next-line pickier/no-unused-vars
export async function getDiskIoMetrics(state: CollectorState): Promise<DiskIoMetrics> {
  const diskInfo = await getDiskInfo()
  const ioRates = await getIoRatesPerDisk()

  const partitions: DiskPartitionMetrics[] = diskInfo.map((disk) => {
    // Match by leading disk identifier (e.g. `disk0s5` → `disk0`).
    const diskKey = disk.filesystem.match(/disk\d+/)?.[0] ?? ''
    const rate = ioRates.get(diskKey) ?? { read: 0, write: 0 }

    return {
      name: disk.filesystem,
      mountPoint: disk.mountPoint,
      totalBytes: disk.totalBytes,
      usedBytes: disk.usedBytes,
      freeBytes: disk.freeBytes,
      usedPercent: disk.usedPercent,
      readBytesPerSec: rate.read,
      writeBytesPerSec: rate.write,
    }
  })

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

  const dfResult = await exec('df -k / 2>/dev/null | tail -1', { timeout: 3000 })
  if (!dfResult.ok)
    return null

  const dfParts = dfResult.stdout.split(/\s+/)
  const rawFreeBytes = (Number.parseInt(dfParts[3]) || 0) * 1024

  const purgeableBytes = Math.max(0, finderFreeBytes - rawFreeBytes)

  return { purgeableBytes, finderFreeBytes }
}

interface IoCounters { read: number, write: number }

/**
 * Read cumulative read/write byte counters per physical disk from ioreg.
 * Returns a map keyed by `BSD Name` (e.g. "disk0").
 */
async function readIoCounters(): Promise<Map<string, IoCounters>> {
  const out = new Map<string, IoCounters>()

  const r = await exec(
    `ioreg -rc IOBlockStorageDriver -d 1 2>/dev/null`,
    { timeout: 5000 },
  )
  if (!r.ok)
    return out

  // Each device is a block; we walk lines and snapshot when we see a
  // BSD Name plus the matching read/write counters in the same block.
  const blocks = r.stdout.split(/\n\s*\+-o /)
  for (const block of blocks) {
    const name = block.match(/"BSD Name"\s*=\s*"([^"]+)"/)?.[1]
    if (!name)
      continue
    const read = Number(block.match(/"Bytes \(Read\)"\s*=\s*(\d+)/)?.[1] ?? 0)
    const write = Number(block.match(/"Bytes \(Write\)"\s*=\s*(\d+)/)?.[1] ?? 0)
    if (read > 0 || write > 0)
      out.set(name, { read, write })
  }
  return out
}

/**
 * Sample ioreg twice with a 1s gap and diff the cumulative counters to
 * get per-disk read/write bytes-per-second.
 */
async function getIoRatesPerDisk(): Promise<Map<string, IoCounters>> {
  const t0 = await readIoCounters()
  if (t0.size === 0)
    return new Map()

  const t0Time = Date.now()
  await new Promise(r => setTimeout(r, 1000))
  const t1 = await readIoCounters()
  const elapsedSec = Math.max(0.001, (Date.now() - t0Time) / 1000)

  const rates = new Map<string, IoCounters>()
  for (const [name, t1Counters] of t1) {
    const prev = t0.get(name)
    if (!prev) continue
    rates.set(name, {
      read: Math.max(0, (t1Counters.read - prev.read) / elapsedSec),
      write: Math.max(0, (t1Counters.write - prev.write) / elapsedSec),
    })
  }
  return rates
}
