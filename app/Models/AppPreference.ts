import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/**
 * The Settings switches the agent has to act on itself.
 *
 * Most of Settings lives in the window's localStorage, which the main window,
 * the menu bar popover and Settings share. The agent cannot read it, and
 * neither can the scheduled clean launchd starts at 3am with no window at all.
 * A switch whose effect happens inside the agent is stored here instead, and
 * Settings reads and writes it over `/api/app-preferences`.
 *
 * One row, rewritten in place, for the same reason as [CleanSchedule]. No
 * `useApi`, for the same reason as [CleanupRun].
 */
export default defineModel({
  name: 'AppPreference',
  table: 'app_preferences',
  primaryKey: 'id',
  autoIncrement: true,

  traits: {
    useTimestamps: true,
  },

  attributes: {
    /** Write each clean to `cleanup_runs`. Off, cleans happen and leave no row. */
    recordHistory: {
      order: 1,
      fillable: true,
      default: true,
      validation: {
        rule: schema.boolean(),
      },
      factory: () => true,
    },
  },
} as const)
