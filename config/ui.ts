import type { StxOptions as UiOptions } from '@stacksjs/stx'
import { apiRouter } from '../api-router'

export default {
  stateDir: 'storage/framework/stx',
  componentsDir: 'resources/components',
  plugins: ['./storage/framework/defaults/stx-components-plugin.ts'],
  layoutsDir: 'resources/layouts',
  partialsDir: 'resources/partials',
  defaultLayout: false as unknown as string,
  cache: true,
  debug: false,
  apiRouter,
  broadcasting: {
    enabled: true,
    port: 6001,
  },
  router: {
    enabled: true,
    container: '[data-stx-content]',
    viewTransitions: true,
    scrollToTop: true,
    prefetch: true,
  },
} satisfies UiOptions & { plugins?: string[] }
