import type { Ports } from '@stacksjs/types'
import { env } from '@stacksjs/env'

export default {
  frontend: env.PORT ?? 3000,
  backend: env.PORT_BACKEND ?? 3001,
  admin: env.PORT_ADMIN ?? 3002,
  library: env.PORT_LIBRARY ?? 3003,
  desktop: env.PORT_DESKTOP ?? 3004,
  email: env.PORT_EMAIL ?? 3005,
  docs: env.PORT_DOCS ?? 3006,
  inspect: env.PORT_INSPECT ?? 3007,
  api: env.PORT_API ?? 3008,
  systemTray: env.PORT_SYSTEM_TRAY ?? 3009,
  database: 3010,
} satisfies Ports
