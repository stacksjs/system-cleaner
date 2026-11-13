import { describe, expect, it } from 'bun:test'
import { arcPath, interpolateArc } from '../resources/lib/sunburst-transition'

describe('sunburst geometry transitions', () => {
  const small = { start: .2, end: .5, inner: 170, outer: 225 }
  const zoomed = { start: 0, end: Math.PI * 2, inner: 60, outer: 115 }

  it('keeps interrupted geometry as the next starting point', () => {
    const visible = interpolateArc(small, zoomed, .4)
    const redirected = { start: 4, end: 5, inner: 115, outer: 170 }
    expect(interpolateArc(visible, redirected, 0)).toEqual(visible)
    expect(interpolateArc(visible, redirected, 1)).toEqual(redirected)
    expect(interpolateArc(visible, redirected, -1)).toEqual(visible)
    expect(interpolateArc(visible, redirected, 2)).toEqual(redirected)
  })

  it('keeps annular sectors valid through the half-circle arc flag change', () => {
    const flags = new Set<string>()
    for (let frame = 0; frame <= 100; frame++) {
      const geometry = interpolateArc(small, zoomed, frame / 100)
      expect(geometry.end).toBeGreaterThan(geometry.start)
      expect(geometry.outer).toBeGreaterThan(geometry.inner)
      const path = arcPath(geometry)
      expect(path).not.toMatch(/NaN|Infinity|undefined/)
      expect(path).toMatch(/^M .+ A .+ Z$/)
      flags.add(path.match(/A [\d.]+ [\d.]+ 0 ([01]) 1/)![1])
    }
    expect([...flags]).toEqual(['0', '1'])
  })

  it('does not draw degenerate entry and exit shapes', () => {
    expect(arcPath({ ...small, end: small.start })).toBe('')
    expect(arcPath({ ...small, outer: small.inner })).toBe('')
  })
})
