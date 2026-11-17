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
    // The router's loading class also sets `cursor: wait` and drops pointer
    // events on links while a page swaps; resources/layouts/app.stx overrides
    // both, since WebKit would leave the wait cursor up until the mouse moved.
    // A 2px cyan line at the top of every page change, in a window whose
    // colours are the section's. The view transition already shows the swap.
    progress: false,
  },
} satisfies UiOptions & { plugins?: string[] }
