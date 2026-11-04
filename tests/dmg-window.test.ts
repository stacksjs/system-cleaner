import { describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import {
  DMG_WINDOW,
  DMG_WINDOW_FIXTURE,
  readBinaryPlist,
  readDmgWindowLayout,
  readRecords,
  requireDmgWindowLayout,
} from '../scripts/dmg-window'

/**
 * The layout a mounted SystemCleaner.dmg opens with.
 *
 * Worth a test because every way of getting it wrong is silent. A dropped
 * `.DS_Store`, a fixture authored against a renamed app, icons arranged by
 * name instead of placed — none of them fail a build, and the symptom shows up
 * only on the machine of someone who downloaded the release. The fixture is
 * committed, so this runs on Linux and Windows as well, which is the point:
 * platform-skipping this would be how a broken layout travels.
 */
describe('the DMG window layout', () => {
  const bytes = new Uint8Array(fs.readFileSync(DMG_WINDOW_FIXTURE))

  it('is the window the build claims to ship', () => {
    // Throws with the specific discrepancy if anything moved.
    const { layout } = requireDmgWindowLayout()
    expect(layout.width).toBe(DMG_WINDOW.width)
    expect(layout.height).toBe(DMG_WINDOW.height)
    expect(layout.iconSize).toBe(DMG_WINDOW.iconSize)
  })

  it('places both icons rather than letting Finder arrange them', () => {
    const { layout } = requireDmgWindowLayout()
    // `arrangeBy` anything but none makes Finder snap icons to its own grid
    // and ignore every position in the file.
    expect(layout.arrangeBy).toBe('none')
    expect(layout.items['SystemCleaner.app']).toEqual(DMG_WINDOW.items['SystemCleaner.app'])
    expect(layout.items.Applications).toEqual(DMG_WINDOW.items.Applications)
  })

  it('carries no background image, so the fixture is portable', () => {
    const layout = readDmgWindowLayout(bytes)
    // A background needs a `BKGD` record holding an alias to a file on the
    // volume that authored it — meaningless anywhere else, and the reason this
    // one layout can be reused by every build.
    expect(layout.records).not.toContain('BKGD')
    expect(layout.records).not.toContain('pict')
    expect(layout.backgroundType).toBe(0)
    expect(layout.records).toContain('Iloc')
    expect(layout.records).toContain('bwsp')
    expect(layout.records).toContain('icvp')
  })

  it('puts the app left of the Applications folder, both inside the window', () => {
    const layout = readDmgWindowLayout(bytes)
    const app = layout.items['SystemCleaner.app']
    const applications = layout.items.Applications

    // The drag the window exists to suggest only reads left-to-right.
    expect(app.x).toBeLessThan(applications.x)
    // Far enough apart not to touch at 128pt, which is what makes it two
    // targets rather than one smear.
    expect(applications.x - app.x).toBeGreaterThanOrEqual(layout.iconSize + 32)
    // On the same line, so neither looks like an afterthought.
    expect(app.y).toBe(applications.y)

    const margin = layout.iconSize / 2
    for (const at of [app, applications]) {
      expect(at.x).toBeGreaterThan(margin)
      expect(at.x).toBeLessThan(layout.width - margin)
      expect(at.y).toBeGreaterThan(margin)
      // Room for the label under the icon.
      expect(at.y).toBeLessThan(layout.height - margin)
    }
  })

  it('labels icons underneath, where a two-item window reads best', () => {
    const layout = readDmgWindowLayout(bytes)
    expect(layout.labelOnBottom).toBe(true)
    // Item info would print "2 items" under the Applications alias.
    expect(layout.showItemInfo).toBe(false)
  })

  it('refuses a file that is not a .DS_Store', () => {
    expect(() => readRecords(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])))
      .toThrow(/not a \.DS_Store/)

    // The magic is the only thing separating this from a buffer of noise, so
    // a single wrong byte has to be enough.
    const corrupted = new Uint8Array(bytes)
    corrupted[7] = 0x32
    expect(() => readRecords(corrupted)).toThrow(/not a \.DS_Store/)
  })

  it('says which file is missing rather than throwing ENOENT', () => {
    expect(() => requireDmgWindowLayout('/nonexistent/dmg-window.DS_Store'))
      .toThrow(/missing.*author-dmg-window/s)
  })

  it('reads a binary property list without plutil', () => {
    // Round-trip the records the fixture actually holds: `bwsp` is a dict with
    // a string, `icvp` a dict mixing reals, integers and booleans, which is
    // every type the hand-written reader claims to support.
    const records = readRecords(bytes)
    const window = readBinaryPlist(records.find(record => record.id === 'bwsp')!.payload) as Record<string, unknown>
    expect(typeof window.WindowBounds).toBe('string')
    expect(window.WindowBounds).toMatch(/^\{\{-?\d+, -?\d+\}, \{\d+, \d+\}\}$/)

    const view = readBinaryPlist(records.find(record => record.id === 'icvp')!.payload) as Record<string, unknown>
    expect(typeof view.iconSize).toBe('number')
    expect(typeof view.arrangeBy).toBe('string')
    expect(view.showItemInfo).toBe(false)
    expect(view.viewOptionsVersion).toBe(1)

    expect(() => readBinaryPlist(new Uint8Array(40))).toThrow(/not a binary property list/)
  })

  it('names every item the image actually contains', () => {
    // The positions are keyed by filename. Rename the app or drop the
    // /Applications symlink and the layout still loads, still validates its
    // geometry, and quietly places nothing.
    const layout = readDmgWindowLayout(bytes)
    expect(Object.keys(layout.items).sort()).toEqual(['Applications', 'SystemCleaner.app'])
  })
})
