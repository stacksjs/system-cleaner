import { describe, expect, it } from 'bun:test'

/**
 * A view that calls a global must load the file that defines it.
 *
 * The Disk Usage screen shipped without `<script src="/disk-panel.js">`. Every
 * control on it — Scan Disk, drill-down, Reveal in Finder, Delete — is an
 * `onclick` calling a global that file defines, so the entire screen was inert:
 * clicking Scan Disk did nothing, silently, with no console error, because the
 * handler attribute referenced a function that had never been defined.
 *
 * Nothing else catches this. It typechecks (the handlers are strings in HTML),
 * it lints, and it renders — it only fails when a person clicks the button.
 */

const views = new Bun.Glob('resources/views/**/*.stx')
const components = new Bun.Glob('resources/components/**/*.stx')

/** Globals defined in `public/*.js`, by the file that defines them. */
async function publicGlobals(): Promise<Map<string, string>> {
  const defined = new Map<string, string>()

  for await (const file of new Bun.Glob('public/**/*.js').scan('.')) {
    const source = await Bun.file(file).text()
    for (const match of source.matchAll(/\bwindow\.([A-Za-z_$][\w$]*)\s*=/g))
      defined.set(match[1], `/${file.slice('public/'.length)}`)
  }

  return defined
}

/** `<script src="...">` paths a template pulls in. */
function scriptSources(source: string): string[] {
  return [...source.matchAll(/<script[^>]*\ssrc=['"]([^'"]+)['"]/g)].map(m => m[1])
}

/**
 * Globals a template hands to the browser: inline handler attributes
 * (`onclick='startDiskScan()'`) and bare calls inside Alpine expressions.
 */
function referencedGlobals(source: string, known: Set<string>): string[] {
  const found = new Set<string>()

  for (const match of source.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
    if (known.has(match[1]))
      found.add(match[1])
  }

  return [...found]
}

describe('view scripts', () => {
  it('load every public/*.js file whose globals they call', async () => {
    const defined = await publicGlobals()
    const known = new Set(defined.keys())
    expect(known.size).toBeGreaterThan(0)

    const problems: string[] = []

    // A component's globals are the responsibility of the view that renders
    // it, so both are read and the view's script tags cover both.
    const componentSources = new Map<string, string>()
    for await (const file of components.scan('.'))
      componentSources.set(file, await Bun.file(file).text())

    // Scripts the shared layout pulls in are on every page, so a view does not
    // have to load them again. `native-dialog.js` is the case: every screen has
    // a destructive action, so it belongs in the layout rather than repeated
    // across seven views.
    const layoutSource = await Bun.file('resources/layouts/app.stx').text()
    const layoutScripts = new Set(scriptSources(layoutSource))

    for await (const file of views.scan('.')) {
      const source = await Bun.file(file).text()
      const loaded = new Set([...scriptSources(source), ...layoutScripts])

      // Whatever this view renders, by component tag name.
      let combined = source
      for (const [componentFile, componentSource] of componentSources) {
        const tag = componentFile.split('/').pop()!.replace(/\.stx$/, '')
        if (new RegExp(`<${tag}\\b`).test(source))
          combined += `\n${componentSource}`
      }

      for (const global of referencedGlobals(combined, known)) {
        const provider = defined.get(global)!
        if (!loaded.has(provider))
          problems.push(`${file} calls ${global}() but never loads ${provider}`)
      }
    }

    expect(problems).toEqual([])
  })
})
