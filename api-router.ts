import type { Router } from '@stacksjs/bun-router'
import { Router as BunRouter } from '@stacksjs/bun-router'

type ApiRouter = Router & { _initApiRoutes: () => Promise<void> }

const router = new BunRouter() as ApiRouter
await router._initApiRoutes()

export const apiRouter = router
