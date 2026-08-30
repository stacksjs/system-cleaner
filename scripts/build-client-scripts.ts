/* eslint-disable ts/no-top-level-await, no-console */
/**
 * Bundles `resources/scripts/*.ts` into `public/*.js`.
 *
 * These are the few scripts that talk to the native side — the application
 * menu, the native dialogs — and they are the one part of the frontend that
 * cannot be a `<script client>` block. An stx client script is shipped into the
 * HTML as written, with stx's own composables destructured off `window.stx`;
 * there is no module resolution, so it cannot import `@stacksjs/desktop`. Left
 * at that, the alternative is hand-writing the bridge calls, which is how these
 * two files came to reimplement `standardMenus`, the dialog fallbacks and the
 * clipboard gesture workaround that the package already had.
 *
 * The output is IIFE rather than ESM so `<script src="/app-menu.js">` in the
 * layout stays a plain script tag: a module would defer past the point the SPA
 * router records which scripts have run, and would need `type="module"` on
 * every tag.
 *
 * `public/` output is generated and gitignored. `bun run dev` and
 * `bun run build:app` both run this first; it takes well under a second.
 */
import { readdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT = path.resolve(import.meta.dir, '..')
const SOURCE = path.join(ROOT, 'resources/scripts')
const OUT = path.join(ROOT, 'public')

const entrypoints = readdirSync(SOURCE)
  .filter(name => name.endsWith('.ts'))
  .map(name => path.join(SOURCE, name))

if (entrypoints.length === 0) {
  console.warn(`[scripts] nothing to build in ${path.relative(ROOT, SOURCE)}`)
  process.exit(0)
}

const result = await Bun.build({
  entrypoints,
  outdir: OUT,
  target: 'browser',
  format: 'iife',
  // Readable in the Web Inspector, which is the only debugger these get. They
  // are a few kB; minifying them saves nothing worth the opacity.
  minify: false,
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  throw new Error('[scripts] bundle failed')
}

for (const output of result.outputs)
  console.log(`[scripts] ${path.relative(ROOT, output.path)} (${(output.size / 1024).toFixed(1)} kB)`)
