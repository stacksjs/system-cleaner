import { describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import process from 'node:process'
import { bootMountPoint, listDisks, usageOf } from '../src/disks'

/**
 * Mounted volumes, and how full they are.
 *
 * Two bugs met here, and the tests are shaped by both.
 *
 * The first was the shell. This came from `exec('df -k')`, and `exec` runs
 * everything through `sh -c`, which Windows does not have — so the figures
 * worked for whoever had Git for Windows installed and came back empty for
 * everyone else.
 *
 * The second was the arithmetic, and it was live on macOS. The sizes were read
 * out of `df`'s columns, and on APFS `used` describes the sealed root volume
 * while `total` describes the shared container. Measured on the machine this
 * was written against: 460.4 GB total, 11.6 GB "used", 67.2 GB available, so
 * `used / total` came to 2% for a disk that is 85% full.
 *
 * And a third found on the way: plain `df -k` on macOS prints three inode
 * columns, while the parser read the mount point as the sixth field — the
 * layout `-P` produces. Every mount point came back as `455008 702793320 0% /`,
 * which matched none of the skip rules and was never equal to `/`, so
 * `getPrimaryDiskInfo` silently returned whichever volume was listed first.
 */

const POSIX = process.platform !== 'win32'

describe('listDisks', () => {
  it('finds the volume the machine booted from', async () => {
    const disks = await listDisks()
    expect(disks.length).toBeGreaterThan(0)

    // Exact equality, which is the assertion the mount-point parse broke. A
    // `/` that is really `455008 702793320 0% /` passes every substring check
    // and fails this one.
    const boot = disks.find(d => d.mountPoint === bootMountPoint())
    expect(boot, `no volume is mounted at ${bootMountPoint()}`).toBeDefined()
  })

  it('names mount points that are real paths', async () => {
    for (const disk of await listDisks()) {
      expect(path.isAbsolute(disk.mountPoint), disk.mountPoint).toBe(true)
      // The symptom of the parse bug: numeric columns carried into the name.
      expect(disk.mountPoint, 'a df column leaked into the mount point').not.toMatch(/^\d/)
    }
  })

  it('reports sizes that add up', async () => {
    for (const disk of await listDisks()) {
      expect(disk.totalBytes).toBeGreaterThan(0)
      // Free plus used is total by construction, and that is the point: the
      // three used to come from columns that described different scopes.
      expect(disk.usedBytes + disk.freeBytes).toBe(disk.totalBytes)
      expect(disk.usedPercent).toBe(Math.round((disk.usedBytes / disk.totalBytes) * 100))
      expect(disk.usedPercent).toBeGreaterThanOrEqual(0)
      expect(disk.usedPercent).toBeLessThanOrEqual(100)
    }
  })

  /**
   * The numbers have to match what the OS's own tool says, or this is just a
   * different way to be wrong.
   *
   * `total` is compared exactly — it does not move. `available` gets a
   * tolerance, because anything running on the machine writes between the two
   * calls.
   */
  it('agrees with df about the boot volume', async () => {
    if (!POSIX) return

    const out = spawnSync('df', ['-P', '-k', '/'], { encoding: 'utf8' })
    const parts = out.stdout.split('\n')[1]?.trim().split(/\s+/)
    expect(parts, 'df produced no data line').toBeDefined()

    const dfTotal = Number.parseInt(parts![1], 10) * 1024
    const dfAvail = Number.parseInt(parts![3], 10) * 1024

    const boot = (await listDisks()).find(d => d.mountPoint === '/')!
    expect(boot.totalBytes).toBe(dfTotal)
    expect(Math.abs(boot.freeBytes - dfAvail) / dfTotal).toBeLessThan(0.01)

    // And the percentage df itself prints, which is the one the old code
    // disagreed with.
    const dfPercent = Number.parseInt(parts![4], 10)
    expect(Math.abs(boot.usedPercent - (100 - dfPercent))).toBeLessThanOrEqual(1)
  })

  it('leaves out volumes too small to be storage', async () => {
    for (const disk of await listDisks())
      expect(disk.totalBytes).toBeGreaterThanOrEqual(1024 ** 3)
  })
})

describe('usageOf', () => {
  it('describes a path that exists', async () => {
    const usage = await usageOf(bootMountPoint())
    expect(usage).not.toBeNull()
    expect(usage!.totalBytes).toBeGreaterThan(0)
    expect(usage!.freeBytes).toBeGreaterThanOrEqual(0)
  })

  it('returns null rather than throwing for a path that does not', async () => {
    expect(await usageOf(path.join(bootMountPoint(), 'no-such-volume-here-at-all'))).toBeNull()
  })
})

describe('bootMountPoint', () => {
  it('is the root on POSIX and a drive root on Windows', () => {
    if (POSIX) {
      expect(bootMountPoint()).toBe('/')
      return
    }
    // Not hardcoded to `C:\`: the system drive is usually C and is not
    // guaranteed to be.
    expect(bootMountPoint()).toMatch(/^[A-Z]:\\$/i)
    expect(bootMountPoint()).toBe(`${process.env.SystemDrive || 'C:'}\\`)
  })
})

/**
 * The regression guard for the original bug, stated as the thing that caused
 * it: this module must not reach the shell.
 *
 * Cheap, and it holds where a behavioural test cannot — on macOS `sh` is
 * present, so nothing observable distinguishes "spawns df directly" from
 * "spawns sh which spawns df" until someone runs it on Windows.
 */
describe('no shell', () => {
  it('does not route through exec', async () => {
    const src = await Bun.file('packages/core/src/disks.ts').text()
    // Comments stripped first: this file explains the shell problem at
    // length, and the first version of this test failed on its own prose.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

    expect(code).not.toContain('./exec')
    // And no shell reached around it either.
    expect(code).not.toMatch(/'(?:sh|bash|zsh|cmd(?:\.exe)?|cmd\/c)'/)
  })
})
