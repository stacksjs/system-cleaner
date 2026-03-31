import type { StxOptions } from '@stacksjs/stx'
import { Router } from '@stacksjs/bun-router'

const router = new Router()
// eslint-disable-next-line ts/no-top-level-await
await router._initApiRoutes()

const config: StxOptions = {
  componentsDir: 'components',
  partialsDir: 'components',
  layoutsDir: 'layouts',
  defaultLayout: false,
  debug: false,
  cache: false,

  broadcasting: {
    enabled: true,
    port: 6001,
  },

  apiRouter: router,
}

export default config
