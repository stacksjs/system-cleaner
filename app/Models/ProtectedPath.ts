import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/**
 * Paths the user has told SystemCleaner to leave alone.
 *
 * The large-files view surfaces whatever is biggest, which on most Macs means
 * the same handful of legitimate files (a VM image, a video project, a Time
 * Machine sparsebundle) resurfacing at the top of every scan. Marking one
 * protected keeps it out of bulk selection permanently rather than relying on
 * the user to re-recognise it each time.
 *
 * No `useApi`, for the same reason as [CleanupRun]: see that model's note.
 */
export default defineModel({
  name: 'ProtectedPath',
  table: 'protected_paths',
  primaryKey: 'id',
  autoIncrement: true,

  traits: {
    useTimestamps: true,
  },

  attributes: {
    path: {
      order: 1,
      fillable: true,
      unique: true,
      validation: {
        rule: schema.string().required().max(4096),
      },
      factory: faker => faker.system.filePath(),
    },

    reason: {
      order: 2,
      fillable: true,
      validation: {
        rule: schema.string().max(255),
      },
      factory: () => undefined,
    },
  },
} as const)
