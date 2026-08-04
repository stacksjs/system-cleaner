import { describe, expect, it } from 'bun:test'
import f7 from '@iconify-json/f7/icons.json'

const sourceFiles = new Bun.Glob('resources/**/*.{stx,ts,js}')

describe('Framework7 icons', () => {
  it('only references glyphs that ship in the installed Framework7 collection', async () => {
    const missing = new Set<string>()

    for await (const file of sourceFiles.scan('.')) {
      const source = await Bun.file(file).text()
      for (const match of source.matchAll(/i-f7-([a-z0-9-]+)/g)) {
        const name = match[1]
        if (!f7.icons[name]) missing.add(name)
      }
    }

    expect([...missing]).toEqual([])
  })
})
