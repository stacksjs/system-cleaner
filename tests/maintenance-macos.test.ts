import { describe, expect, it } from 'bun:test'
import process from 'node:process'
import { getMaintenanceTask, MAINTENANCE_TASKS } from '@system-cleaner/clean'

/**
 * The macOS maintenance table, for the claims that are easy to get wrong
 * and impossible to notice: a task whose command runs cleanly and repairs
 * nothing looks exactly like a task that worked.
 */
describe.skipIf(process.platform !== 'darwin')('macOS maintenance tasks', () => {
  /**
   * Since Catalina the boot disk is a volume *group*: a sealed read-only
   * system volume at `/` and a data volume at `/System/Volumes/Data` that
   * holds `/Applications`, every home folder, and everything else anyone
   * searches for. `man mdutil` says `-E` erases the store "for the volumes
   * indicated", and `mdutil -a -s` lists the two separately — so `mdutil -E /`
   * rebuilds the system volume's index and leaves the one that matters alone.
   *
   * Found on a Mac whose data volume had no index at all: all 290 bundles
   * Spotlight knew were under `/System`, and 42 of the 43 apps in
   * `/Applications` could not be found. "Rebuild Spotlight Index" could not
   * have fixed any of it.
   */
  it('rebuilds every volume\'s Spotlight index, not just the sealed one', () => {
    const task = getMaintenanceTask('spotlight')
    expect(task).toBeDefined()
    expect(task!.command).toContain('mdutil')
    expect(task!.command).toContain('-E')
    expect(task!.command, 'must cover the data volume').toContain('-a')
    // The bug this replaced: a bare `/` targets the sealed system volume.
    expect(task!.command).not.toMatch(/mdutil\s+-E\s+\/\s*$/)
  })

  it('marks every task that starts with sudo as needing elevation', () => {
    // `runMaintenanceTask` refuses a sudo task rather than attempting it —
    // the agent has no terminal, so the password prompt would go to a pipe
    // nobody reads and the task would hang until its timeout. A task that
    // shells out to sudo without the flag set is that hang.
    for (const task of MAINTENANCE_TASKS) {
      if (task.command.includes('sudo '))
        expect(task.requiresSudo, task.id).toBe(true)
    }
  })

  it('gives every task a distinct id, so running one cannot run another', () => {
    const ids = MAINTENANCE_TASKS.map(task => task.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
