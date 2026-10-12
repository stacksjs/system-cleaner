import { describe, expect, it } from 'bun:test'
import * as os from 'node:os'
import { sampleCpuUsage } from '../packages/monitor/src/cpu'

/**
 * Processor utilisation, measured from the kernel's own counters.
 *
 * The dashboard used to derive CPU by summing `ps -Aceo pcpu` across the top
 * eight processes and dividing by core count. Two things were wrong with that:
 *
 *  - `ps` does not exist on Windows, so the figure was 0% forever. A busy
 *    machine reported as idle, and the health score saw no CPU pressure and
 *    inflated itself to match — the "nothing" versus "I cannot see" failure
 *    that the capability map exists to prevent, on a screen that is not gated.
 *  - It was wrong on macOS too. `ps` reports a process's *lifetime average*
 *    CPU rather than what it is using now, so the sum ran to 501% on a
 *    ten-core machine: 50% against a true 27.5%, nearly double.
 *
 * `os.cpus()` reports cumulative per-core times on every platform, so two
 * samples an interval apart give real utilisation with no shell at all.
 */

describe('sampleCpuUsage', () => {
  it('reports a percentage, and one reading per core', async () => {
    const sample = await sampleCpuUsage(60)

    expect(sample.usagePercent).toBeGreaterThanOrEqual(0)
    expect(sample.usagePercent).toBeLessThanOrEqual(100)
    expect(sample.perCoreUsage).toHaveLength(os.cpus().length)
    for (const core of sample.perCoreUsage) {
      expect(core).toBeGreaterThanOrEqual(0)
      expect(core).toBeLessThanOrEqual(100)
    }
  })

  /**
   * The assertion that separates a CPU meter from a number: it has to move
   * when the machine is actually working. The old implementation would have
   * passed every check above on Windows while reading 0% forever.
   */
  it('rises when the cores are actually busy', async () => {
    const before = await sampleCpuUsage(150)
    // Nothing to prove if the machine is already saturated — a CI runner under
    // load cannot show a rise, and failing for that would be noise.
    if (before.usagePercent > 60) return

    const spinners = Array.from({ length: os.cpus().length }, () =>
      Bun.spawn([process.execPath, '-e', 'const end = Date.now() + 1500; while (Date.now() < end) {}'], {
        stdout: 'ignore',
        stderr: 'ignore',
      }))

    try {
      // Let them get going before measuring.
      await new Promise(resolve => setTimeout(resolve, 150))
      const during = await sampleCpuUsage(600)
      expect(during.usagePercent, 'the reading did not respond to real load').toBeGreaterThan(before.usagePercent)
    }
    finally {
      for (const spinner of spinners) spinner.kill()
    }
  }, 20_000)

  /**
   * The portability requirement, stated as the thing that broke it. A
   * behavioural test cannot catch this on macOS, where `ps` and `sysctl` are
   * both present and everything looks fine.
   */
  it('reaches no shell to do it', async () => {
    const src = await Bun.file('packages/monitor/src/cpu.ts').text()
    const sampler = src.slice(src.indexOf('export async function sampleCpuUsage'), src.indexOf('function clampPercent'))

    expect(sampler).not.toContain('exec')
    expect(sampler).not.toContain('spawn')
    expect(sampler).toContain('os.cpus()')
  })
})
