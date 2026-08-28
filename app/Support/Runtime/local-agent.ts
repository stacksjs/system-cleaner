import process from 'node:process'

/**
 * Whether this process is the local agent — the copy of SystemCleaner running
 * on the Mac it is meant to inspect and clean.
 *
 * The same STX application serves two very different things. Locally (the
 * desktop app, `buddy dev`) it is a control plane for *this* machine: it
 * deletes paths, kills processes, and shells out to `brew`. Deployed to
 * system-cleaner.app it is a marketing site, and every one of those endpoints
 * would instead operate on a shared web server for whoever asked.
 *
 * The two share `config/ui.ts` -> `api-router.ts`, so the split has to be made
 * here rather than by hoping the public deployment never routes `/api/*`.
 *
 * The desktop bundle sets `SYSTEM_CLEANER_AGENT=1` explicitly, because it runs
 * with `APP_ENV=production` (it *is* a production build) while still being the
 * local agent. Everything else is an agent only outside production.
 */
export function isLocalAgent(): boolean {
  if (process.env.SYSTEM_CLEANER_AGENT === '1')
    return true
  if (process.env.SYSTEM_CLEANER_AGENT === '0')
    return false

  return (process.env.APP_ENV ?? 'local') !== 'production'
}
