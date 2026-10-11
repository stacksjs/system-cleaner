import { describe, expect, it } from 'bun:test'
import { capabilities, PLATFORM, supports } from '@system-cleaner/core'
import { COMMAND_CAPABILITY } from '../src/index'

/**
 * Which feature each CLI command needs before it is allowed to run.
 *
 * The binary has no UI to explain itself, so a command that runs anyway on a
 * platform with no implementation prints a confident, empty answer: 0 B
 * reclaimable, 0 startup items, a health score computed from zeros. "Nothing"
 * and "I cannot see" have to be different outputs.
 *
 * The case that makes this worth its own file: `scan` was mapped to
 * `diskScan`. That became true on Windows while `processes` stayed false — and
 * every figure `scan` leads with comes from the processes collector, so it
 * would have reported a healthy machine it never measured.
 *
 * See stacksjs/system-cleaner#23.
 */

describe('command capability map', () => {
  it('names a real capability for every command', () => {
    for (const [command, needs] of Object.entries(COMMAND_CAPABILITY))
      expect(Object.keys(capabilities), `${command} needs an unknown capability`).toContain(needs)
  })

  /**
   * A command is gated on the strictest feature it actually uses, not the most
   * convenient one. These are the pairings where the two differ.
   */
  it('gates each command on what it actually depends on', () => {
    expect(COMMAND_CAPABILITY.scan, 'scan leads with CPU, memory, health and startup items').toBe('processes')
    expect(COMMAND_CAPABILITY.disk, 'disk is a pure filesystem walk').toBe('diskScan')
    expect(COMMAND_CAPABILITY.clean).toBe('cleanTargets')
    expect(COMMAND_CAPABILITY.purge).toBe('developerJunk')
    expect(COMMAND_CAPABILITY.optimize).toBe('maintenance')
    expect(COMMAND_CAPABILITY.uninstall).toBe('appUninstall')
    expect(COMMAND_CAPABILITY.monitor).toBe('processes')
  })

  it('leaves the commands that carry their own platform handling ungated', () => {
    // `check` and `touchid` either handle the platform themselves or have
    // nothing to scan. Gating them would hide something that works.
    expect(COMMAND_CAPABILITY.check).toBeUndefined()
    expect(COMMAND_CAPABILITY.touchid).toBeUndefined()
  })

  it('agrees with the platform about what runs here', () => {
    for (const [command, needs] of Object.entries(COMMAND_CAPABILITY))
      expect(supports(needs), `${command} on ${PLATFORM}`).toBe(capabilities[needs])
  })

  /**
   * The CI smoke test runs one command expecting a refusal and one expecting
   * success. Both have to stay true as capabilities land, and neither may be
   * destructive — the refusal probe used to be `clean`, chosen when every
   * Windows capability was false. Cleaning is implemented there now, so that
   * step had CI deleting files on the runner and then hanging on a
   * confirmation prompt with no TTY to answer it.
   */
  it('keeps the commands the Windows smoke test relies on', () => {
    if (PLATFORM !== 'windows') return
    expect(supports(COMMAND_CAPABILITY.optimize), 'the refusal probe must still refuse').toBe(false)
    expect(supports(COMMAND_CAPABILITY.disk), 'the success probe must still run').toBe(true)
  })
})
