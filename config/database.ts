import type { DatabaseConfig } from '@stacksjs/types'
import type { SupportedDialect } from 'bun-query-builder'
import { env } from '@stacksjs/env'

/**
 * Keep the database target application-owned. Production supplies the durable
 * SQLite file through DB_DATABASE_PATH; local development keeps using the
 * repository database.
 */
export default {
  default: (env.DB_CONNECTION as SupportedDialect) || 'sqlite',

  connections: {
    sqlite: {
      database: env.DB_DATABASE_PATH || 'database/stacks.sqlite',
      prefix: '',
    },
  },

  migrations: 'migrations',
  migrationLocks: 'migration_locks',

  safety: {
    confirmMigrate: env.DB_MIGRATE_CONFIRM ?? true,
    migrateFresh: 'disabled',
  },
} satisfies DatabaseConfig
