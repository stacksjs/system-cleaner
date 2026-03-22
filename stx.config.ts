import type { StxOptions } from '@stacksjs/stx'
import { Router } from '@stacksjs/bun-router'

// Create router — auto-discovers routes from routes/ directory
// routes/api.ts → /api/* prefix (inferred from filename)
const router = new Router()
await router._initApiRoutes()

const config: StxOptions = {
  componentsDir: 'components',
  partialsDir: 'components',
  layoutsDir: 'layouts',
  debug: false,
  cache: false,

  apiRouter: router,
}

export default config
