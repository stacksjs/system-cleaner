import * as path from 'node:path'
import { describe, expect, it } from 'bun:test'
import { CLEAN_TARGETS, getCategories, getCleanTarget } from '../packages/clean/src/categories'
import { isPathSafe } from '../packages/core/src/paths'

describe('clean targets', () => {
  it('has unique ids', () => {
    const ids = CLEAN_TARGETS.map(target => target.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('resolves every id through getCleanTarget', () => {
    for (const target of CLEAN_TARGETS)
      expect(getCleanTarget(target.id)?.name).toBe(target.name)
  })

  it('only names absolute paths', () => {
    const relative = CLEAN_TARGETS.filter(target => !path.isAbsolute(target.path)).map(t => t.id)
    expect(relative).toEqual([])
  })

  it('gives every target a name, category, and description', () => {
    for (const target of CLEAN_TARGETS) {
      expect(target.name.length).toBeGreaterThan(0)
      expect(target.category.length).toBeGreaterThan(0)
      expect(target.description.length).toBeGreaterThan(0)
    }
  })

  it('reports categories that all map back to targets', () => {
    const categories = new Set(getCategories())
    const used = new Set(CLEAN_TARGETS.map(target => target.category))
    for (const category of used)
      expect(categories.has(category)).toBe(true)
  })

  // The whole safety story is that a target is either inside the user's home
  // or an explicitly allowed system location, never a bare system root.
  it('never targets a filesystem root or a bare top-level system directory', () => {
    const forbidden = new Set(['/', '/System', '/Library', '/Applications', '/usr', '/bin', '/etc', '/var'])
    const offenders = CLEAN_TARGETS
      .filter(target => forbidden.has(path.resolve(target.path)))
      .map(target => target.id)

    expect(offenders).toEqual([])
  })

  it('marks sudo-only targets explicitly rather than failing at runtime', () => {
    for (const target of CLEAN_TARGETS.filter(t => t.path.startsWith('/private/var') || t.path.startsWith('/Library'))) {
      // Either it needs sudo, or the guard has to consider it safe unattended.
      const guarded = target.requiresSudo === true || isPathSafe(target.path).safe
      expect(guarded).toBe(true)
    }
  })
})
