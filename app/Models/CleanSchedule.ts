import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/**
 * The automatic clean, as the user configured it.
 *
 * One row, rewritten in place — a Mac has one cleaning schedule, and modelling
 * it as a table of many would put a "which schedule?" question in front of a
 * screen whose whole value is that it asks nothing.
 *
 * The row is the truth about *intent*; the launchd agent in
 * `packages/clean/src/schedule.ts` is the truth about what will actually fire.
 * They are written together, and `/api/schedule` reports both so a plist the
 * user deleted by hand cannot leave the app claiming a clean is scheduled.
 *
 * No `useApi`, for the same reason as [CleanupRun]: see that model's note.
 */
export default defineModel({
  name: 'CleanSchedule',
  table: 'clean_schedules',
  primaryKey: 'id',
  autoIncrement: true,

  traits: {
    useTimestamps: true,
  },

  attributes: {
    enabled: {
      order: 1,
      fillable: true,
      default: false,
      validation: {
        rule: schema.boolean(),
      },
      factory: () => false,
    },

    frequency: {
      order: 2,
      fillable: true,
      default: 'weekly',
      validation: {
        rule: schema.string().required().max(16),
      },
      factory: faker => faker.helpers.arrayElement(['daily', 'weekly', 'monthly']),
    },

    hour: {
      order: 3,
      fillable: true,
      default: 3,
      validation: {
        rule: schema.number().required().min(0).max(23),
      },
      factory: faker => faker.number.int({ min: 0, max: 23 }),
    },

    minute: {
      order: 4,
      fillable: true,
      default: 0,
      validation: {
        rule: schema.number().required().min(0).max(59),
      },
      factory: () => 0,
    },

    weekday: {
      order: 5,
      fillable: true,
      default: 0,
      validation: {
        rule: schema.number().required().min(0).max(6),
      },
      factory: faker => faker.number.int({ min: 0, max: 6 }),
    },

    day: {
      order: 6,
      fillable: true,
      default: 1,
      validation: {
        rule: schema.number().required().min(1).max(28),
      },
      factory: faker => faker.number.int({ min: 1, max: 28 }),
    },

    // A JSON array of clean-target ids. Stored as text rather than as its own
    // table: the app only ever reads the whole list at once, and a join table
    // would need migrating every time a target id is renamed.
    targetIds: {
      order: 7,
      fillable: true,
      default: '[]',
      validation: {
        rule: schema.string().max(8192),
      },
      factory: () => '[]',
    },

    /** Clear browser caches and history on the same schedule. */
    includePrivacy: {
      order: 8,
      fillable: true,
      default: false,
      validation: {
        rule: schema.boolean(),
      },
      factory: () => false,
    },

    /** Empty the Trash at the end of the run. Off by default: unrecoverable. */
    emptyTrash: {
      order: 9,
      fillable: true,
      default: false,
      validation: {
        rule: schema.boolean(),
      },
      factory: () => false,
    },

    lastRunAt: {
      order: 10,
      fillable: true,
      validation: {
        rule: schema.string().max(32),
      },
      factory: () => undefined,
    },

    lastFreedBytes: {
      order: 11,
      fillable: true,
      default: 0,
      validation: {
        rule: schema.number().min(0),
      },
      factory: () => 0,
    },

    lastStatus: {
      order: 12,
      fillable: true,
      validation: {
        rule: schema.string().max(255),
      },
      factory: () => undefined,
    },
  },
} as const)
