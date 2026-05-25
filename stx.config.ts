import type { StxOptions } from '@stacksjs/stx'
import path from 'node:path'
import { apiRouter } from './api-router.ts'

const appRoot = import.meta.dir

const config: StxOptions = {
  componentsDir: path.join(appRoot, 'components'),
  partialsDir: path.join(appRoot, 'components'),
  layoutsDir: path.join(appRoot, 'layouts'),
  // STX types want a string layout name; `false` is supported at runtime to
  // mean "no auto-wrap" but isn't in the published types yet.
  defaultLayout: false as unknown as string,
  debug: false,
  cache: true,

  broadcasting: {
    enabled: true,
    port: 6001,
  },

  apiRouter,

  router: {
    enabled: true,
    container: '[data-stx-content]',
    viewTransitions: true,
    scrollToTop: true,
    prefetch: true,
  },
}

export default config
