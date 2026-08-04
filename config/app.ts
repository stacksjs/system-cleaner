import type { AppConfig } from '@stacksjs/types'
import { env } from '@stacksjs/env'

export default {
  name: env.APP_NAME ?? 'SystemCleaner',
  description: 'A fast, private macOS utility for understanding, cleaning, and maintaining your Mac.',
  env: env.APP_ENV ?? 'local',
  url: env.APP_URL ?? 'localhost',
  appPath: '/app',
  devLaunch: 'native',
  redirectUrls: ['www.system-cleaner.app'],
  debug: env.DEBUG ?? false,
  key: env.APP_KEY,
  maintenanceMode: env.APP_MAINTENANCE ?? false,
  comingSoonMode: env.APP_COMING_SOON ?? false,
  comingSoonSecret: env.APP_COMING_SOON_SECRET ?? '',
  docMode: false,
  timezone: 'America/Los_Angeles',
  locale: 'en',
  fallbackLocale: 'en',
  cipher: 'aes-256-cbc',
} satisfies AppConfig
