import { describe, expect, it } from 'bun:test'
import f7 from '@iconify-json/f7/icons.json'

// `packages/` is included because clean targets, browser profiles, and startup
// vendors all supply icon classes that the views render straight into a
// `class` attribute.
const sourceFiles = new Bun.Glob('{resources,app,packages}/**/*.{stx,ts,js}')

/**
 * Generated output, which this suite has no opinion about.
 *
 * `app/Desktop/Resources/` is staged by `bun run build:app` and gitignored —
 * it holds the bundled client scripts, and bundling inlines third-party code
 * this project did not write. `@stacksjs/desktop` passes a "✓" as a
 * notification icon in there, so both checks below failed on any machine that
 * had run a bundle build, and passed everywhere else including CI, which never
 * builds the app. A rule about what this project's own source may contain has
 * to be asked of this project's own source.
 */
function isGenerated(file: string): boolean {
  return file.startsWith('app/Desktop/Resources/')
}

// Emoji presentation ranges. Excludes the arrows and dingbats blocks that
// legitimately appear in box-drawing comment separators.
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE0F}]/u

describe('Framework7 icons', () => {
  it('only references glyphs that ship in the installed Framework7 collection', async () => {
    const missing = new Set<string>()

    for await (const file of sourceFiles.scan('.')) {
      if (isGenerated(file))
        continue
      const source = await Bun.file(file).text()
      for (const match of source.matchAll(/i-f7-([a-z0-9-]+)/g)) {
        const name = match[1]
        if (!(f7.icons as Record<string, unknown>)[name])
          missing.add(`${name} (${file})`)
      }
    }

    expect([...missing]).toEqual([])
  })

  // The project rule is Iconify classes only. Emoji used to reach the UI
  // through clean-target icons, browser profile icons, and startup vendor
  // icons, which all render into a `class` attribute.
  //
  // `packages/cli` is exempt: it writes to a terminal, where an Iconify class
  // name would print as literal text and a glyph is the correct output.
  it('ships no emoji in icon or label values', async () => {
    const offenders: string[] = []

    for await (const file of sourceFiles.scan('.')) {
      if (file.startsWith('packages/cli/') || isGenerated(file))
        continue
      const source = await Bun.file(file).text()
      for (const [index, line] of source.split('\n').entries()) {
        if (!EMOJI.test(line))
          continue
        // Comments are prose, not rendered output.
        const trimmed = line.trim()
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*'))
          continue
        offenders.push(`${file}:${index + 1}`)
      }
    }

    expect(offenders).toEqual([])
  })
})
