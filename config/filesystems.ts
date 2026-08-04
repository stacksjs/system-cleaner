import type { FilesystemsConfig } from '@stacksjs/types'
import { env } from '@stacksjs/env'

export default {
  driver: (env.STORAGE_DRIVER || 'bun') as FilesystemsConfig['driver'],
  root: env.STORAGE_ROOT || process.cwd(),
  publicUrl: {
    domain: env.STORAGE_PUBLIC_URL || env.APP_URL || 'http://localhost:3456',
  },
  defaultVisibility: 'private',
} satisfies FilesystemsConfig
