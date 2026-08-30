import { describe, expect, it } from 'bun:test'

/**
 * The bundled client scripts, and the tags that load them.
 *
 * `resources/scripts/*.ts` is bundled into `public/*.js` by
 * `scripts/build-client-scripts.ts`. The output is generated and gitignored, so
 * the two ends are joined by filename and nothing else checks that the join
 * holds: rename a source and the layout keeps a `<script src>` pointing at a
 * file nobody writes any more. That is a 404 in a window with no address bar
 * and no visible console — the menubar simply stays AppKit's default, which is
 * exactly what it looked like when it was broken for other reasons.
 */

const SOURCES = new Bun.Glob('resources/scripts/*.ts')
const MARKUP = new Bun.Glob('resources/**/*.stx')

async function sourceNames(): Promise<string[]> {
  const names: string[] = []
  for await (const file of SOURCES.scan('.'))
    names.push(file.split('/').pop()!.replace(/\.ts$/, ''))
  return names.sort()
}

/** Every `/foo.js` a template asks the browser to load. */
async function referencedScripts(): Promise<Map<string, string>> {
  const refs = new Map<string, string>()
  for await (const file of MARKUP.scan('.')) {
    const source = await Bun.file(file).text()
    for (const match of source.matchAll(/<script[^>]*\bsrc=['"]\/([\w-]+)\.js['"]/g))
      refs.set(match[1], file)
  }
  return refs
}

describe('bundled client scripts', () => {
  it('builds one public/*.js per source, and the build ran', async () => {
    for (const name of await sourceNames())
      expect(await Bun.file(`public/${name}.js`).exists()).toBe(true)
  })

  it('is what the templates actually load', async () => {
    const refs = await referencedScripts()
    for (const name of await sourceNames()) {
      // A source nothing loads is dead weight that still passes every other
      // check in this repo.
      expect(refs.has(name)).toBe(true)
    }
  })

  it('every referenced script exists in public/', async () => {
    for (const [name, template] of await referencedScripts()) {
      const exists = await Bun.file(`public/${name}.js`).exists()
      expect(exists, `${template} loads /${name}.js, which nothing produces`).toBe(true)
    }
  })

  it('bundles the desktop package rather than reaching for window.craft by hand', async () => {
    // The point of the bundling step. Hand-rolled bridge calls are how these
    // files came to reimplement standardMenus, the dialog fallbacks and the
    // clipboard gesture workaround the package already had — each with its own
    // bugs, none shared with the other apps that hit the same problems.
    for (const name of await sourceNames()) {
      const source = await Bun.file(`resources/scripts/${name}.ts`).text()
      expect(source).toContain('@stacksjs/desktop/browser')
      expect(source).not.toMatch(/window\.craft\b/)
    }
  })

  it('emits plain scripts, since the layout loads them without type=module', async () => {
    // An ESM output would need `type="module"` on every tag and would defer
    // past the point the SPA router records which scripts have run.
    for (const name of await sourceNames()) {
      const built = await Bun.file(`public/${name}.js`).text()
      expect(built).not.toMatch(/^\s*(export|import)\s/m)
    }
  })
})
