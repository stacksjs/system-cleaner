import { format } from '@ts-charts/format'
import { scaleLinear } from '@ts-charts/scale'
import { area, curveMonotoneX, line } from '@ts-charts/shape'

interface SystemSample {
  cpu: number
  memory: number
  at: number
}

export interface ChartTick {
  label: string
  /** Position along the axis, in viewBox units. */
  offset: number
}

export interface SystemHistory {
  cpuPath: string
  cpuArea: string
  memoryPath: string
  memoryArea: string
  cpuLabel: string
  memoryLabel: string
  /** Horizontal rules + their `0%`…`100%` labels. */
  yTicks: ChartTick[]
  /** Elapsed-time labels along the bottom axis. */
  xTicks: ChartTick[]
  /** Plot rectangle so the client can draw the axis lines without re-deriving it. */
  plot: { left: number, right: number, top: number, bottom: number }
  sampleCount: number
}

const samples: SystemSample[] = []
const MAX_SAMPLES = 24

// The chart is drawn in a fixed 960x200 viewBox and scaled by CSS. The wide
// aspect keeps the rendered plot around 220px tall at dashboard widths, and
// the padding reserves room for the axis labels themselves — without it the
// `0%` tick and the time labels get clipped by the SVG edge.
const WIDTH = 960
const HEIGHT = 200
const PAD = { top: 12, right: 12, bottom: 26, left: 40 }
const PLOT_LEFT = PAD.left
const PLOT_RIGHT = WIDTH - PAD.right
const PLOT_TOP = PAD.top
const PLOT_BOTTOM = HEIGHT - PAD.bottom

const percent = format('.0f')
const Y_TICK_VALUES = [0, 25, 50, 75, 100]
const MAX_X_TICKS = 5

const y = scaleLinear().domain([0, 100]).range([PLOT_BOTTOM, PLOT_TOP]).clamp(true)

function xScale(count: number) {
  // A single sample would collapse the domain to a point, which makes the
  // scale return NaN. Widen it so the lone reading sits on the left edge.
  return scaleLinear().domain([0, Math.max(1, count - 1)]).range([PLOT_LEFT, PLOT_RIGHT])
}

function linePath(key: 'cpu' | 'memory'): string {
  if (samples.length < 2)
    return ''

  const x = xScale(samples.length)
  return line()
    .curve(curveMonotoneX)
    .x((_: SystemSample, index: number) => x(index))
    .y((sample: SystemSample) => y(sample[key]))(samples) || ''
}

function areaPath(key: 'cpu' | 'memory'): string {
  if (samples.length < 2)
    return ''

  const x = xScale(samples.length)
  return area()
    .curve(curveMonotoneX)
    .x((_: SystemSample, index: number) => x(index))
    .y0(PLOT_BOTTOM)
    .y1((sample: SystemSample) => y(sample[key]))(samples) || ''
}

/** `95` -> `95s`, `130` -> `2m 10s`, `120` -> `2m`. */
function elapsedLabel(seconds: number): string {
  const whole = Math.round(seconds)
  if (whole <= 0)
    return 'now'
  if (whole < 60)
    return `${whole}s`

  const minutes = Math.floor(whole / 60)
  const rest = whole % 60
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`
}

function buildXTicks(): ChartTick[] {
  if (samples.length < 2)
    return []

  const x = xScale(samples.length)
  const last = samples.length - 1
  const newest = samples[last].at
  // Evenly spaced ticks that always include both ends, so the axis never
  // starts partway into the plot.
  const count = Math.min(MAX_X_TICKS, samples.length)

  const ticks: ChartTick[] = []
  for (let step = 0; step < count; step++) {
    const index = Math.round((step / (count - 1)) * last)
    ticks.push({ label: elapsedLabel((newest - samples[index].at) / 1000), offset: x(index) })
  }

  return ticks
}

export function recordSystemActivity(cpu: number, memory: number): SystemHistory {
  const sample: SystemSample = {
    cpu: Math.max(0, Math.min(100, cpu)),
    memory: Math.max(0, Math.min(100, memory)),
    at: Date.now(),
  }
  samples.push(sample)
  if (samples.length > MAX_SAMPLES)
    samples.shift()

  return {
    cpuPath: linePath('cpu'),
    cpuArea: areaPath('cpu'),
    memoryPath: linePath('memory'),
    memoryArea: areaPath('memory'),
    cpuLabel: `${percent(sample.cpu)}%`,
    memoryLabel: `${percent(sample.memory)}%`,
    yTicks: Y_TICK_VALUES.map(value => ({ label: `${value}%`, offset: y(value) })),
    xTicks: buildXTicks(),
    plot: { left: PLOT_LEFT, right: PLOT_RIGHT, top: PLOT_TOP, bottom: PLOT_BOTTOM },
    sampleCount: samples.length,
  }
}
