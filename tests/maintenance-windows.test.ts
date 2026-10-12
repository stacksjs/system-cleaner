import { describe, expect, it } from 'bun:test'
import { capabilities, PLATFORM } from '@system-cleaner/core'
import { MAINTENANCE_TASKS } from '../packages/clean/src/maintenance'
import { WINDOWS_MAINTENANCE_TASKS } from '../packages/clean/src/maintenance-windows'

/**
 * Windows upkeep.
 *
 * Most of what people mean by maintenance on Windows needs administrator
 * rights, and this agent has none and no way to ask for any. That was the
 * argument for leaving the capability off — but the macOS tasks already solve
 * it: the ones that need `sudo` are listed with their command and a copy
 * button, because "here is what to run, and why" beats both an empty screen
 * and a button that can only fail.
 *
 * These tests pin that arrangement, since the failure mode is a task claiming
 * it can run when it cannot.
 *
 * See stacksjs/system-cleaner#23.
 */

describe('the windows task list', () => {
  it('offers both halves', () => {
    const runnable = WINDOWS_MAINTENANCE_TASKS.filter(t => !t.requiresSudo)
    const elevated = WINDOWS_MAINTENANCE_TASKS.filter(t => t.requiresSudo)

    // A list that was all one or all the other would mean the split had not
    // been thought about.
    expect(runnable.length, 'nothing runs without elevation').toBeGreaterThan(0)
    expect(elevated.length, 'nothing is marked as needing elevation').toBeGreaterThan(0)
  })

  it('gives every task an id, a command, and a reason to run it', () => {
    const ids = new Set<string>()
    for (const task of WINDOWS_MAINTENANCE_TASKS) {
      expect(task.id).toMatch(/^win-/)
      expect(ids.has(task.id), `${task.id} is listed twice`).toBe(false)
      ids.add(task.id)

      expect(task.command.length, `${task.id} has no command`).toBeGreaterThan(0)
      // `effect` is what the person reads to decide. A task without one is a
      // button nobody can judge.
      expect(task.effect.length, `${task.id} says nothing about what it does`).toBeGreaterThan(20)
    }
  })

  /**
   * The split is the whole point, so it is asserted against the commands
   * rather than taken on trust. Everything here refuses without an elevated
   * prompt.
   */
  it('marks the commands that cannot work unelevated', () => {
    const needsAdmin = /^(?:sfc|DISM|chkdsk|defrag|netsh|ipconfig)\b/
    for (const task of WINDOWS_MAINTENANCE_TASKS) {
      if (needsAdmin.test(task.command))
        expect(task.requiresSudo, `${task.id} runs ${task.command.split(' ')[0]} and is not marked elevated`).toBe(true)
    }
  })

  it('names where an elevated task has to be run', () => {
    for (const task of WINDOWS_MAINTENANCE_TASKS.filter(t => t.requiresSudo)) {
      // The page is prerendered and cannot be told its platform, so the label
      // travels with the task. It used to read "needs Terminal" in the markup.
      expect(task.elevationLabel).toContain('Administrator')
    }
  })

  it('keeps every task in a category the UI groups by', () => {
    for (const task of WINDOWS_MAINTENANCE_TASKS)
      expect(['caches', 'services', 'network', 'storage']).toContain(task.category)
  })
})

describe('the platform selector', () => {
  it('serves the list for the platform it is running on', () => {
    const ids = MAINTENANCE_TASKS.map(t => t.id)
    if (PLATFORM === 'windows') {
      expect(ids).toContain('win-sfc')
      expect(ids, 'macOS tasks must not be offered on Windows').not.toContain('launch-services')
    }
    else {
      expect(ids).toContain('launch-services')
      expect(ids).not.toContain('win-sfc')
    }
  })

  it('labels elevation on every platform, not just the new one', () => {
    // The macOS tasks predate this field and are filled in at selection.
    for (const task of MAINTENANCE_TASKS)
      expect(task.elevationLabel.length, `${task.id} has no elevation label`).toBeGreaterThan(0)
  })
})

describe('the capability', () => {
  it('is on for Windows now that both halves are honest', () => {
    if (PLATFORM === 'windows')
      expect(capabilities.maintenance).toBe(true)
  })
})
