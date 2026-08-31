import { describe, expect, it } from 'bun:test'
import { DEFAULT_SCHEDULE, describeSchedule, normalizeSchedule } from '../packages/clean/src/schedule'
import { MAINTENANCE_TASKS, getMaintenanceTask, runMaintenanceTask } from '../packages/clean/src/maintenance'

/**
 * The schedule spec arrives over HTTP, and launchd is unforgiving about what
 * it will accept. Everything here is about the values that reach the plist.
 */
describe('normalizeSchedule', () => {
  it('falls back to the default for a missing input', () => {
    expect(normalizeSchedule(null)).toEqual(DEFAULT_SCHEDULE)
  })

  it('clamps the clock into range', () => {
    const spec = normalizeSchedule({ hour: 99, minute: -4 })
    expect(spec.hour).toBe(23)
    expect(spec.minute).toBe(0)
  })

  // launchd never fires a job set to the 31st in February, so a "monthly"
  // clean pinned there would silently skip most of the year.
  it('caps the day of month at 28', () => {
    expect(normalizeSchedule({ frequency: 'monthly', day: 31 }).day).toBe(28)
    expect(normalizeSchedule({ frequency: 'monthly', day: 0 }).day).toBe(1)
  })

  it('rejects a frequency it does not know', () => {
    expect(normalizeSchedule({ frequency: 'hourly' as never }).frequency).toBe('weekly')
  })

  it('coerces enabled to a boolean', () => {
    expect(normalizeSchedule({ enabled: 'yes' as never }).enabled).toBe(true)
    expect(normalizeSchedule({}).enabled).toBe(false)
  })

  it('survives a spec full of nonsense', () => {
    const spec = normalizeSchedule({ hour: Number.NaN, minute: 'x' as never, weekday: 12 })
    expect(spec.hour).toBe(DEFAULT_SCHEDULE.hour)
    expect(spec.minute).toBe(DEFAULT_SCHEDULE.minute)
    expect(spec.weekday).toBe(6)
  })
})

describe('describeSchedule', () => {
  it('reads as a sentence for each frequency', () => {
    expect(describeSchedule(normalizeSchedule({ frequency: 'daily', hour: 3, minute: 5 })))
      .toBe('Every day at 03:05')
    expect(describeSchedule(normalizeSchedule({ frequency: 'weekly', weekday: 3, hour: 22, minute: 0 })))
      .toBe('Every Wednesday at 22:00')
    expect(describeSchedule(normalizeSchedule({ frequency: 'monthly', day: 2, hour: 0, minute: 30 })))
      .toBe('The 2nd of each month at 00:30')
  })
})

describe('maintenance tasks', () => {
  it('have unique ids', () => {
    const ids = MAINTENANCE_TASKS.map(task => task.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  // The id is validated against this pattern before it reaches the runner.
  it('use ids the API route will accept', () => {
    for (const task of MAINTENANCE_TASKS)
      expect(task.id).toMatch(/^[a-z-]{1,32}$/)
  })

  it('say what the user will notice, not just what they do', () => {
    for (const task of MAINTENANCE_TASKS) {
      expect(task.effect.length).toBeGreaterThan(20)
      expect(task.description.length).toBeGreaterThan(20)
    }
  })

  // The agent has no terminal, so a sudo prompt would be written to a pipe
  // nobody reads and the task would hang until it timed out.
  it('refuse to run a sudo task and hand back its command instead', async () => {
    const sudoTask = MAINTENANCE_TASKS.find(task => task.requiresSudo)!
    const result = await runMaintenanceTask(sudoTask.id)

    expect(result.success).toBe(false)
    expect(result.needsSudo).toBe(true)
    expect(result.command).toBe(sudoTask.command)
    expect(result.durationMs).toBe(0)
  })

  it('report an unknown id rather than throwing', async () => {
    const result = await runMaintenanceTask('not-a-task')
    expect(result.success).toBe(false)
    expect(result.needsSudo).toBe(false)
    expect(getMaintenanceTask('not-a-task')).toBeUndefined()
  })
})
