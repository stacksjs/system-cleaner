import { describe, expect, it } from 'bun:test'
import f7 from '@iconify-json/f7/icons.json'
import { RUNTIME_COLOR_CLASSES } from '../app/Support/UI/runtime-colors'
import { RUNTIME_ICON_CLASSES } from '../app/Support/UI/runtime-icons'
import { CLEAN_TARGETS } from '../packages/clean/src/categories'
import { getAllCategories } from '../packages/disk/src/categories'

const safelist = new Set(RUNTIME_ICON_CLASSES)

describe('runtime icon safelist', () => {
  it('names only glyphs that ship in the installed Framework7 collection', () => {
    const missing = RUNTIME_ICON_CLASSES.filter((cls) => {
      const name = cls.replace(/^i-f7-/, '')
      return !(f7.icons as Record<string, unknown>)[name]
    })

    expect(missing).toEqual([])
  })

  it('has no duplicate entries', () => {
    expect(safelist.size).toBe(RUNTIME_ICON_CLASSES.length)
  })

  // A clean-target glyph outside the safelist is purged from the stylesheet,
  // so the Quick Clean row renders a blank gap instead of an icon.
  it('covers every clean-target category icon', () => {
    const uncovered = [...new Set(CLEAN_TARGETS.map(target => target.icon))]
      .filter(icon => !safelist.has(icon))

    expect(uncovered).toEqual([])
  })

  it('covers every disk file-category icon', () => {
    const uncovered = getAllCategories()
      .map(category => category.icon)
      .filter(icon => icon && !safelist.has(icon))

    expect(uncovered).toEqual([])
  })
})

/**
 * Colour utilities returned from JS, which the scanner cannot see either.
 *
 * `cpuBarClass()` in `public/dashboard-xdata.js` answers `bg-apple-red`. That
 * string appears in no template, so Crosswind purged it and every CPU bar drew
 * transparent — correct width, no colour, over its own dark track. All eight
 * rows looked the same, which is the one thing a bar chart must never do.
 */
describe('runtime colour safelist', () => {
  it('covers every utility class a public script returns', async () => {
    const safe = new Set(RUNTIME_COLOR_CLASSES)
    const missing = new Set<string>()

    for await (const file of new Bun.Glob('public/*.js').scan('.')) {
      const source = await Bun.file(file).text()
      for (const [, cls] of source.matchAll(/'((?:bg|text|border)-[a-z0-9-]+)'/g)) {
        if (!safe.has(cls)) missing.add(`${cls} (${file})`)
      }
    }

    expect([...missing]).toEqual([])
  })

  it('has no duplicate entries', () => {
    expect(new Set(RUNTIME_COLOR_CLASSES).size).toBe(RUNTIME_COLOR_CLASSES.length)
  })
})
