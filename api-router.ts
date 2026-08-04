import type { Router } from '@stacksjs/bun-router'
import { Router as BunRouter } from '@stacksjs/bun-router'

type ApiRouter = Router & { _initApiRoutes: () => Promise<void> }

const router = new BunRouter() as ApiRouter
// The router has to finish registering before it is exported: config/ui.ts
// hands this instance straight to stx, which starts serving immediately.
// eslint-disable-next-line ts/no-top-level-await
await router._initApiRoutes()

export const apiRouter = router
