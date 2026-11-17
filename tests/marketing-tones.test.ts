import { describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { FEATURES, MARKETING_SECTIONS } from '../app/Support/Marketing/catalog'
import { USE_CASES } from '../app/Support/Marketing/use-cases'

/**
 * The website wears the app's section colours, and the two stylesheets each
 * declare them, because the app's window reads them from its toolbar and the
 * site from plain `data-tone` attributes. This keeps the two declarations
 * from drifting apart: a colour changed in one is a colour changed in both.
 */
const root = path.resolve(import.meta.dir, '..')
const read = (file: string): string => fs.readFileSync(path.join(root, file), 'utf8')

function tones(css: string): Record<string, string> {
  const found: Record<string, string> = {}
  const block = /\[data-tone='(\w+)'\][^{]*\{([^}]*--tone-a[^}]*)\}/g
  for (const match of css.matchAll(block))
    found[match[1]] = match[2].replace(/\s+/g, ' ').trim()
  return found
}

describe('marketing site tones', () => {
  it('uses exactly the colours the app uses for every section', () => {
    const app = tones(read('resources/layouts/app.stx'))
    const site = tones(read('resources/layouts/marketing.stx'))
    expect(Object.keys(app).sort()).toEqual(['apps', 'cleanup', 'overview', 'performance', 'protection', 'storage'])
    expect(site).toEqual(app)
  })

  it('places every feature in a section and every section has a photo', () => {
    const placed = MARKETING_SECTIONS.flatMap(section => section.features.map(feature => feature.slug)).sort()
    expect(placed).toEqual(FEATURES.map(feature => feature.slug).sort())
    for (const section of MARKETING_SECTIONS)
      expect(fs.existsSync(path.join(root, 'public', section.image))).toBe(true)
    expect(fs.existsSync(path.join(root, 'public/images/showcase/overview.jpg'))).toBe(true)
  })

  it('gives every use case a section colour', () => {
    const ids = new Set(['overview', ...MARKETING_SECTIONS.map(section => section.id)])
    for (const useCase of USE_CASES)
      expect(ids.has(useCase.tone)).toBe(true)
  })
})
