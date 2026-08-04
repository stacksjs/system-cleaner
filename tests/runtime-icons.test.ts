import { describe, expect, it } from 'bun:test'
import f7 from '@iconify-json/f7/icons.json'
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
