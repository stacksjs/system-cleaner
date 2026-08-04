import { describe, expect, it } from 'bun:test'
import { recordSystemActivity } from '../app/Support/System/activity-chart'

// The module keeps a single rolling buffer, so these run in sequence against
// one shared history rather than isolated fixtures.
describe('system activity chart', () => {
  it('returns no path until there are two samples to join', () => {
    const first = recordSystemActivity(10, 20)
    expect(first.sampleCount).toBe(1)
    expect(first.cpuPath).toBe('')
    expect(first.cpuArea).toBe('')
    expect(first.xTicks).toEqual([])
  })

  it('draws a line and a filled area once a second sample lands', () => {
    const second = recordSystemActivity(30, 40)
    expect(second.sampleCount).toBe(2)
    expect(second.cpuPath.startsWith('M')).toBe(true)
    // An area path has to close back to the baseline or the fill leaks.
    expect(second.cpuArea.endsWith('Z')).toBe(true)
    expect(second.memoryPath.startsWith('M')).toBe(true)
  })

  it('labels the full 0-100% range on the y axis', () => {
    const history = recordSystemActivity(50, 60)
    expect(history.yTicks.map(tick => tick.label)).toEqual(['0%', '25%', '50%', '75%', '100%'])
    // Higher percentages sit higher on screen, so offsets descend.
    const offsets = history.yTicks.map(tick => tick.offset)
    expect(offsets[0]).toBeGreaterThan(offsets[offsets.length - 1])
  })

  it('anchors the x axis at both ends and ends at now', () => {
    const history = recordSystemActivity(55, 65)
    expect(history.xTicks.length).toBeGreaterThanOrEqual(2)
    expect(history.xTicks[0].offset).toBe(history.plot.left)
    expect(history.xTicks[history.xTicks.length - 1].offset).toBe(history.plot.right)
    expect(history.xTicks[history.xTicks.length - 1].label).toBe('now')
  })

  it('clamps out-of-range readings into the plot', () => {
    const over = recordSystemActivity(320, -40)
    expect(over.cpuLabel).toBe('100%')
    expect(over.memoryLabel).toBe('0%')
  })

  it('keeps the rolling window bounded', () => {
    for (let index = 0; index < 60; index++)
      recordSystemActivity(index % 100, (index * 3) % 100)

    const history = recordSystemActivity(42, 42)
    expect(history.sampleCount).toBeLessThanOrEqual(24)
    // Every point still has to land inside the reserved plot rectangle.
    expect(history.plot.left).toBeLessThan(history.plot.right)
    expect(history.plot.top).toBeLessThan(history.plot.bottom)
  })
})
