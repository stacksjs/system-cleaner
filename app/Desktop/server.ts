/**
 * The HTTP server inside the packaged macOS app.
 *
 * `buddy serve` is the right production entrypoint for the deployed marketing
 * site, and this app uses it there. It is the wrong one *inside a .app*: it
 * needs the project tree and `node_modules` on disk (392 MB), and it resolves
 * views through STX at request time. A shipped desktop app has neither.
 *
 * So the bundle carries two things instead:
 *   - the prerendered UI from `buddy build:views` (8 MB of HTML/CSS/JS), and
 *   - this file, compiled by `bun build --compile` into one binary.
 *
 * The route table is not redeclared here. `routes/api.ts` is imported and
 * handed a collector that records what it registers, so the desktop build and
 * `buddy dev` serve byte-identical handlers and cannot drift.
 */

import type { Router } from '@stacksjs/bun-router'
import { Database } from 'bun:sqlite'
import * as fs from 'node:fs'
import * as path from 'node:path'
import process from 'node:process'
import registerApiRoutes from '../../routes/api'

type RouteHandler = (req: Request) => Response | Promise<Response>

const routes = new Map<string, RouteHandler>()

function record(method: string, routePath: string, handler: RouteHandler): void {
  const normalized = routePath.startsWith('/') ? routePath : `/${routePath}`
  routes.set(`${method} /api${normalized}`, handler)
}

/**
 * The subset of `@stacksjs/bun-router` that `routes/api.ts` actually calls.
 *
 * Registering against the real Router would drag its file-based discovery
 * (and the project tree it walks) into the compiled binary. The cast is the
 * honest shape of that trade: this object is a Router only as far as the route
 * file is concerned, and TypeScript still checks the handlers themselves.
 */
const collector = {
  get: async (p: string, h: RouteHandler) => record('GET', p, h),
  post: async (p: string, h: RouteHandler) => record('POST', p, h),
} as unknown as Router

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
}

/**
 * Resolve a request path to a file inside the web root.
 *
 * The static build writes `app/disk.html`, while the rail links to
 * `/app/disk` — so a bare path is tried as `.html` and as `index.html`
 * before giving up.
 */
function resolveStaticFile(webRoot: string, urlPath: string): string | null {
  const decoded = decodeURIComponent(urlPath)
  const cleaned = decoded.replace(/\/+$/, '') || '/index'

  const candidates = cleaned === '/index'
    ? ['index.html']
    : [
        `${cleaned}.html`,
        `${cleaned}/index.html`,
        cleaned,
      ]

  for (const candidate of candidates) {
    const full = path.resolve(webRoot, `.${candidate.startsWith('/') ? candidate : `/${candidate}`}`)

    // Containment check. Without it, `/../../etc/passwd` would resolve out of
    // the bundle — the server is bound to loopback, but a page rendered in the
    // webview is still reachable by anything running as this user.
    if (full !== webRoot && !full.startsWith(`${webRoot}${path.sep}`))
      continue

    try {
      if (fs.statSync(full).isFile())
        return full
    }
    catch {
      // Try the next candidate.
    }
  }

  return null
}

/**
 * Create the application tables if they are not there yet.
 *
 * The bundle carries `database/migrations/` verbatim rather than a snapshot of
 * the schema, so the tables the packaged app creates are the ones
 * `buddy migrate:regenerate` derived from `app/Models/` — there is no second
 * definition to keep in step. Every generated statement is
 * `CREATE ... IF NOT EXISTS`, which makes running them on every launch both
 * safe and the simplest possible first-run story.
 */
export function ensureSchema(databasePath: string, migrationsDir: string): void {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true })

  let files: string[]
  try {
    files = fs.readdirSync(migrationsDir).filter(name => name.endsWith('.sql')).sort()
  }
  catch {
    // A bundle without migrations is a packaging bug, but refusing to start
    // would strand the user with a window that never opens. The endpoints that
    // need a table will report their own error instead.
    return
  }

  const db = new Database(databasePath)
  try {
    for (const file of files)
      db.run(fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
  }
  finally {
    db.close()
  }
}

export interface AgentServerOptions {
  /** Directory holding the output of `buddy build:views`. */
  webRoot: string
  /** 0 asks the OS for a free port, which is what the launcher wants. */
  port?: number
  /** Loopback only. Exposing this on 0.0.0.0 would publish the control plane. */
  hostname?: string
}

export async function startAgentServer(options: AgentServerOptions) {
  const webRoot = path.resolve(options.webRoot)

  // Everything in `routes/api.ts` is gated on this. The desktop build *is* a
  // production build, so the APP_ENV heuristic would otherwise refuse to
  // register the very routes the app exists to serve.
  process.env.SYSTEM_CLEANER_AGENT = '1'

  await registerApiRoutes(collector)

  const notFound = new Response('Not found', { status: 404 })

  const server = Bun.serve({
    port: options.port ?? 0,
    hostname: options.hostname ?? '127.0.0.1',
    idleTimeout: 255,

    async fetch(req) {
      const url = new URL(req.url)

      if (url.pathname === '/__health')
        return new Response('ok')

      if (url.pathname.startsWith('/api/')) {
        const handler = routes.get(`${req.method} ${url.pathname}`)
        if (!handler)
          return Response.json({ success: false, error: 'Unknown endpoint' }, { status: 404 })
        try {
          return await handler(req)
        }
        catch (err) {
          return Response.json(
            { success: false, error: err instanceof Error ? err.message : 'Internal error' },
            { status: 500 },
          )
        }
      }

      const file = resolveStaticFile(webRoot, url.pathname)
      if (!file)
        return notFound

      return new Response(Bun.file(file), {
        headers: {
          'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
          // The payload ships inside the bundle and changes only when the app
          // is replaced, so revalidation buys nothing and costs a round trip.
          'Cache-Control': 'no-cache',
        },
      })
    },
  })

  return server
}

// Running the compiled binary directly starts the server and blocks. The
// launcher uses this; `bun app/Desktop/server.ts` is the way to exercise it
// against a local `dist/` during development.
if (import.meta.main) {
  const webRoot = process.env.SYSTEM_CLEANER_WEB_ROOT
    ?? path.resolve(path.dirname(process.execPath), '../Resources/web')

  const migrationsDir = process.env.SYSTEM_CLEANER_MIGRATIONS
    ?? path.resolve(path.dirname(process.execPath), '../Resources/migrations')
  if (process.env.DB_DATABASE_PATH)
    ensureSchema(process.env.DB_DATABASE_PATH, migrationsDir)

  // The scheduled clean runs through this same binary, invoked by the launch
  // agent that `app/Support/Cleanup/schedule.ts` writes. It does the work and
  // exits without ever opening a socket: launchd wakes it at 3am, when there
  // is no window to serve and nothing to serve it to.
  if (process.argv.includes('--run-schedule')) {
    const { runScheduledClean } = await import('../Support/Cleanup/schedule')
    try {
      const outcome = await runScheduledClean()
      // stdout is the launch agent's log file, which is the only place anyone
      // will look to find out whether last night's clean ran.
      Bun.write(Bun.stdout, `${outcome.ranAt} cleaned ${outcome.targets} item(s), freed ${outcome.freedFormatted}${outcome.errors.length > 0 ? `, ${outcome.errors.length} error(s): ${outcome.errors.slice(0, 3).join('; ')}` : ''}\n`)
      process.exit(0)
    }
    catch (err) {
      Bun.write(Bun.stdout, `${new Date().toISOString()} scheduled clean failed: ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(1)
    }
  }

  // Deliberately not `PORT`: that name is already the frontend port in
  // `config/ports.ts`, and setting it to 0 makes the config validator complain
  // about a value it was never meant to see.
  const server = await startAgentServer({
    webRoot,
    port: Number(process.env.SYSTEM_CLEANER_PORT ?? 0),
  })

  // The launcher reads this line to learn which port the OS handed out.
  // Written to stdout explicitly rather than through `console.warn`, which
  // goes to stderr — the launcher pipes stdout and inherits stderr, so a
  // `console.warn` here left it waiting for a port that never arrived.
  Bun.write(Bun.stdout, `system-cleaner-agent listening on ${server.url.origin}\n`)
}
