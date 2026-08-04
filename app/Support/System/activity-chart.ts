import { format } from '@ts-charts/format'
import { scaleLinear } from '@ts-charts/scale'
import { line } from '@ts-charts/shape'

interface SystemSample {
  cpu: number
  memory: number
}

export interface SystemHistory {
  cpuPath: string
  memoryPath: string
  cpuLabel: string
  memoryLabel: string
  sampleCount: number
}

const samples: SystemSample[] = []
const WIDTH = 720
const HEIGHT = 168
const percent = format('.0f')

function chartPath(key: keyof SystemSample): string {
  if (samples.length < 2)
    return ''

  const x = scaleLinear().domain([0, samples.length - 1]).range([0, WIDTH])
  const y = scaleLinear().domain([0, 100]).range([HEIGHT, 0]).clamp(true)
  return line()
    .x((_: SystemSample, index: number) => x(index))
    .y((sample: SystemSample) => y(sample[key]))(samples) || ''
}

export function recordSystemActivity(cpu: number, memory: number): SystemHistory {
  const sample = {
    cpu: Math.max(0, Math.min(100, cpu)),
    memory: Math.max(0, Math.min(100, memory)),
  }
  samples.push(sample)
  if (samples.length > 24)
    samples.shift()

  return {
    cpuPath: chartPath('cpu'),
    memoryPath: chartPath('memory'),
    cpuLabel: `${percent(sample.cpu)}%`,
    memoryLabel: `${percent(sample.memory)}%`,
    sampleCount: samples.length,
  }
}
