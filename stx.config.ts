import type { StxOptions } from '@stacksjs/stx'
import { Router } from '@stacksjs/bun-router'

const router = new Router() as Router & { _initApiRoutes: () => Promise<void> }
// eslint-disable-next-line ts/no-top-level-await
await router._initApiRoutes()

const config: StxOptions = {
  componentsDir: 'components',
  partialsDir: 'components',
  layoutsDir: 'layouts',
  // STX types want a string layout name; `false` is supported at runtime to
  // mean "no auto-wrap" but isn't in the published types yet.
  defaultLayout: false as unknown as string,
  debug: false,
  cache: false,

  broadcasting: {
    enabled: true,
    port: 6001,
  },

  apiRouter: router,
}

export default config
