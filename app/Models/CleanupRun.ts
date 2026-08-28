import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/**
 * One row per cleanup the user actually ran, so the app can answer "how much
 * have I reclaimed?" across launches instead of forgetting the moment the
 * window closes.
 *
 * Deliberately no `useApi` trait: generated REST routes are registered from
 * the merged model registry, which the public marketing deployment also boots.
 * The endpoints that read and write this table live in `routes/api.ts`, behind
 * the local-agent gate in `app/Support/Runtime/local-agent.ts`.
 */
export default defineModel({
  name: 'CleanupRun',
  table: 'cleanup_runs',
  primaryKey: 'id',
  autoIncrement: true,

  traits: {
    useTimestamps: true,
  },

  attributes: {
    source: {
      order: 1,
      fillable: true,
      validation: {
        rule: schema.string().required().max(32),
      },
      factory: faker => faker.helpers.arrayElement(['large-files', 'quick-clean', 'disk-tree', 'trash']),
    },

    // 'trash' is recoverable via Finder; 'permanent' is an `rm -rf`. Worth
    // recording separately — the answer to "can I get that back?" differs.
    mode: {
      order: 2,
      fillable: true,
      default: 'trash',
      validation: {
        rule: schema.string().required().max(16),
      },
      factory: faker => faker.helpers.arrayElement(['trash', 'permanent']),
    },

    itemCount: {
      order: 3,
      fillable: true,
      default: 0,
      validation: {
        rule: schema.number().required().min(0),
      },
      factory: faker => faker.number.int({ min: 1, max: 120 }),
    },

    failedCount: {
      order: 4,
      fillable: true,
      default: 0,
      validation: {
        rule: schema.number().required().min(0),
      },
      factory: () => 0,
    },

    freedBytes: {
      order: 5,
      fillable: true,
      default: 0,
      validation: {
        rule: schema.number().required().min(0),
      },
      factory: faker => faker.number.int({ min: 1_000_000, max: 40_000_000_000 }),
    },
  },
} as const)
