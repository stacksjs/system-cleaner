import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { formatBytes, isPathSafe } from '@system-cleaner/core'

/**
 * Secure erase — CCleaner's File Shredder, minus the part that is a lie.
 *
 * What this does: overwrites the file's contents with random bytes, flushes
 * that to the device, truncates it, renames it so the old name does not
 * survive in the directory, and unlinks it.
 *
 * What it cannot promise, and the UI says so: on APFS — every Mac since 2017 —
 * a write does not necessarily land on the blocks it replaces. The filesystem
 * is copy-on-write and the SSD's controller remaps and wear-levels underneath
 * that, so the original blocks may still exist in flash with no file pointing
 * at them and no way to address them from here. Apple removed "Secure Empty
 * Trash" in 10.11 for exactly this reason.
 *
 * It is still worth having: it defeats every undelete tool that works through
 * the filesystem, which is what people actually mean by shredding. For the
 * stronger guarantee the answer is FileVault, where the blocks are unreadable
 * whether or not they are overwritten.
 */
export interface ShredOptions {
  /**
   * Overwrite passes. One pass of random data is what modern guidance calls
   * for; more is cargo cult from 1990s magnetic media, and on an SSD every
   * extra pass is wear for nothing.
   */
  passes?: number
  /**
   * Refuse files larger than this rather than grind through them. Defaults to
   * 8 GB — overwriting more takes minutes, and a UI that appears hung is a
   * worse outcome than an honest refusal.
   */
  maxFileBytes?: number
}

export interface ShredOutcome {
  shredded: string[]
  skipped: Array<{ path: string, reason: string }>
  failed: Array<{ path: string, error: string }>
  bytesOverwritten: number
  bytesFormatted: string
}

const DEFAULT_PASSES = 1
const DEFAULT_MAX_FILE_BYTES = 8 * 1024 * 1024 * 1024
const BLOCK_SIZE = 1024 * 1024

/** Overwrite one file's contents in place, then remove it. */
function shredFile(target: string, size: number, passes: number): number {
  let overwritten = 0

  if (size > 0) {
    const fd = fs.openSync(target, 'r+')
    try {
      const block = Buffer.allocUnsafe(Math.min(BLOCK_SIZE, size))
      for (let pass = 0; pass < passes; pass++) {
        let offset = 0
        while (offset < size) {
          const length = Math.min(block.length, size - offset)
          crypto.randomFillSync(block, 0, length)
          fs.writeSync(fd, block, 0, length, offset)
          offset += length
          overwritten += length
        }
        // Without the flush the writes can sit in the page cache and never
        // reach the device before the unlink makes them pointless.
        fs.fsyncSync(fd)
      }
      fs.ftruncateSync(fd, 0)
    }
    finally {
      fs.closeSync(fd)
    }
  }

  // The name is data too: `tax-return-2019.pdf` in a directory entry survives
  // the contents by itself. Rename before unlinking so the recoverable entry
  // carries nothing.
  const renamed = path.join(path.dirname(target), `.${crypto.randomBytes(12).toString('hex')}`)
  try {
    fs.renameSync(target, renamed)
    fs.unlinkSync(renamed)
  }
  catch {
    fs.unlinkSync(target)
  }

  return overwritten
}

/** Every regular file under a path, deepest first. */
function filesUnder(root: string): string[] {
  const found: string[] = []
  const stack = [root]

  while (stack.length > 0) {
    const current = stack.pop()!
    let stat: fs.Stats
    try {
      stat = fs.lstatSync(current)
    }
    catch {
      continue
    }

    if (stat.isSymbolicLink())
      continue

    if (stat.isDirectory()) {
      let entries: string[]
      try {
        entries = fs.readdirSync(current)
      }
      catch {
        continue
      }
      for (const entry of entries)
        stack.push(path.join(current, entry))
      continue
    }

    if (stat.isFile())
      found.push(current)
  }

  return found
}

/**
 * Shred every path given, then remove the directories that held them.
 *
 * Goes through the same {@link isPathSafe} gate as every other delete in this
 * app: this is the least recoverable action the product has, so it gets no
 * looser a check than the recoverable ones.
 */
export function shredPaths(targets: string[], options: ShredOptions = {}): ShredOutcome {
  const passes = Math.min(Math.max(options.passes ?? DEFAULT_PASSES, 1), 3)
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES

  const outcome: ShredOutcome = {
    shredded: [],
    skipped: [],
    failed: [],
    bytesOverwritten: 0,
    bytesFormatted: '0 B',
  }

  for (const raw of targets) {
    const target = path.resolve(raw)

    const safety = isPathSafe(target)
    if (!safety.safe) {
      outcome.skipped.push({ path: target, reason: safety.reason || 'Unsafe path' })
      continue
    }

    let stat: fs.Stats
    try {
      stat = fs.lstatSync(target)
    }
    catch {
      outcome.skipped.push({ path: target, reason: 'Path does not exist' })
      continue
    }

    const members = stat.isDirectory() ? filesUnder(target) : [target]
    const oversized = members.filter((file) => {
      try {
        return fs.lstatSync(file).size > maxFileBytes
      }
      catch {
        return false
      }
    })

    if (oversized.length > 0) {
      outcome.skipped.push({
        path: target,
        reason: `Contains a file over ${formatBytes(maxFileBytes)} — delete it permanently instead`,
      })
      continue
    }

    let failedHere = false
    for (const file of members) {
      try {
        const size = fs.lstatSync(file).size
        outcome.bytesOverwritten += shredFile(file, size, passes)
      }
      catch (err) {
        outcome.failed.push({ path: file, error: err instanceof Error ? err.message : String(err) })
        failedHere = true
      }
    }

    if (failedHere)
      continue

    if (stat.isDirectory()) {
      try {
        fs.rmSync(target, { recursive: true, force: true })
      }
      catch (err) {
        outcome.failed.push({ path: target, error: err instanceof Error ? err.message : String(err) })
        continue
      }
    }

    outcome.shredded.push(target)
  }

  outcome.bytesFormatted = formatBytes(outcome.bytesOverwritten)
  return outcome
}
