import { SunburstTransition } from '../lib/sunburst-transition'
import type { ChartSegment } from '../lib/sunburst-transition'

let chart: SunburstTransition | undefined
const host = window as typeof window & { renderDiskChart?: (group: SVGGElement, segments: ChartSegment[]) => void }
host.renderDiskChart = (group, segments) => {
  if (chart?.group !== group) {
    chart?.dispose()
    chart = new SunburstTransition(group)
  }
  chart.update(segments)
}
window.addEventListener('stx:navigate', () => {
  chart?.dispose()
  chart = undefined
})
