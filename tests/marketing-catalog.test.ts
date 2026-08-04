import { describe, expect, it } from 'bun:test'
import f7 from '@iconify-json/f7/icons.json'
import { FEATURES, featureBySlug } from '../app/Support/Marketing/catalog'
import { DOWNLOAD_URL, MAC_APP_STORE_URL, SOURCE_URL, SYSTEM_REQUIREMENT } from '../app/Support/Marketing/distribution'
import { USE_CASES, useCaseBySlug } from '../app/Support/Marketing/use-cases'

const iconExists = (name: string) => Boolean((f7.icons as Record<string, unknown>)[name])

describe('feature catalog', () => {
  it('has unique slugs', () => {
    const slugs = FEATURES.map(feature => feature.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('resolves every slug through featureBySlug', () => {
    for (const feature of FEATURES)
      expect(featureBySlug(feature.slug)?.name).toBe(feature.name)
  })

  it('names only Framework7 glyphs that ship in the installed collection', () => {
    const missing = FEATURES.filter(feature => !iconExists(feature.icon)).map(f => f.icon)
    expect(missing).toEqual([])
  })

  // A slug with no view is a 404 the moment the mega menu links to it.
  it('has a rendered page for every slug', async () => {
    for (const feature of FEATURES) {
      const view = Bun.file(`resources/views/features/${feature.slug}.stx`)
      expect(await view.exists()).toBe(true)
    }
  })

  it('keeps summaries short enough for the mega menu', () => {
    for (const feature of FEATURES)
      expect(feature.summary.length).toBeLessThanOrEqual(120)
  })
})

describe('use case catalog', () => {
  it('has unique slugs', () => {
    const slugs = USE_CASES.map(useCase => useCase.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('resolves every slug through useCaseBySlug', () => {
    for (const useCase of USE_CASES)
      expect(useCaseBySlug(useCase.slug)?.name).toBe(useCase.name)
  })

  it('names only Framework7 glyphs that ship in the installed collection', () => {
    const missing = USE_CASES.filter(useCase => !iconExists(useCase.icon)).map(u => u.icon)
    expect(missing).toEqual([])
  })

  it('has a rendered page for every slug', async () => {
    for (const useCase of USE_CASES) {
      const view = Bun.file(`resources/views/use-cases/${useCase.slug}.stx`)
      expect(await view.exists()).toBe(true)
    }
  })

  // The detail page drops unresolvable feature slugs silently, so a typo would
  // quietly shrink the cross-link list instead of failing.
  it('cross-links only real features', () => {
    for (const useCase of USE_CASES) {
      const unresolved = useCase.features.filter(slug => !featureBySlug(slug))
      expect(unresolved).toEqual([])
    }
  })

  it('gives every use case at least one reclaim group with items', () => {
    for (const useCase of USE_CASES) {
      expect(useCase.reclaims.length).toBeGreaterThan(0)
      for (const group of useCase.reclaims)
        expect(group.items.length).toBeGreaterThan(0)
    }
  })

  it('gives every use case a numbered workflow', () => {
    for (const useCase of USE_CASES)
      expect(useCase.workflow.length).toBeGreaterThan(0)
  })
})

describe('distribution links', () => {
  it('points every action at an absolute https URL', () => {
    for (const url of [DOWNLOAD_URL, MAC_APP_STORE_URL, SOURCE_URL])
      expect(url.startsWith('https://')).toBe(true)
  })

  it('states the requirement the release actually ships', () => {
    // scripts/build-binaries.ts can only produce an Apple silicon build, so
    // the site must not promise Intel.
    expect(SYSTEM_REQUIREMENT).toContain('Apple silicon')
    expect(SYSTEM_REQUIREMENT.toLowerCase()).not.toContain('intel')
  })
})
