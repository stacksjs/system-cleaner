export interface ArcGeometry {
  start: number
  end: number
  inner: number
  outer: number
}

export interface ChartSegment extends ArcGeometry {
  key: string
  idx: number
  color: string
  label: string
}

interface Frame extends ArcGeometry {
  alpha: number
  color: number[]
}

interface Entry {
  path: SVGPathElement
  current: Frame
  from: Frame
  to: Frame
  exiting: boolean
}

export function arcPath({ start, end, inner, outer }: ArcGeometry): string {
  const a = start + .002
  const b = end - .002
  if (b - a < .001 || outer <= inner) return ''
  const large = b - a > Math.PI ? 1 : 0
  const point = (angle: number, radius: number) => `${(Math.sin(angle) * radius).toFixed(2)} ${(-Math.cos(angle) * radius).toFixed(2)}`
  return `M ${point(a, outer)} A ${outer} ${outer} 0 ${large} 1 ${point(b, outer)} L ${point(b, inner)} A ${inner} ${inner} 0 ${large} 0 ${point(a, inner)} Z`
}

export function interpolateArc(from: ArcGeometry, to: ArcGeometry, progress: number): ArcGeometry {
  const t = Math.max(0, Math.min(1, progress))
  return {
    start: from.start + (to.start - from.start) * t,
    end: from.end + (to.end - from.end) * t,
    inner: from.inner + (to.inner - from.inner) * t,
    outer: from.outer + (to.outer - from.outer) * t,
  }
}

function collapsed(frame: Frame): Frame {
  const middle = (frame.start + frame.end) / 2
  return { ...frame, start: middle, end: middle, alpha: 0 }
}

function same(a: Frame, b: Frame): boolean {
  return a.start === b.start && a.end === b.end && a.inner === b.inner && a.outer === b.outer
    && a.alpha === b.alpha && a.color.every((channel, index) => channel === b.color[index])
}

/** One retained SVG scene, interpolated in polar coordinates rather than path strings. */
export class SunburstTransition {
  private entries = new Map<string, Entry>()
  private frame = 0
  private started = 0
  private duration = 320
  private motion = matchMedia('(prefers-reduced-motion: reduce)')
  private settle = () => this.finish()
  private visibility = () => { if (document.hidden) this.finish() }

  constructor(readonly group: SVGGElement) {
    this.motion.addEventListener('change', this.settle)
    document.addEventListener('visibilitychange', this.visibility)
  }

  update(segments: ChartSegment[]): void {
    const live = new Set(segments.map(segment => segment.key))
    let changed = false
    for (const segment of segments) {
      const to: Frame = { ...segment, alpha: 1, color: [1, 3, 5].map(offset => Number.parseInt(segment.color.slice(offset, offset + 2), 16)) }
      let entry = this.entries.get(segment.key)
      if (!entry) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        path.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'title'))
        const from = collapsed(to)
        entry = { path, current: from, from, to, exiting: false }
        this.entries.set(segment.key, entry)
        this.group.appendChild(path)
        changed = true
      }
      if (entry.exiting || !same(entry.to, to)) changed = true
      entry.exiting = false
      entry.to = to
      entry.path.setAttribute('class', 'segment')
      entry.path.setAttribute('data-key', segment.key)
      entry.path.setAttribute('data-idx', String(segment.idx))
      entry.path.firstChild!.textContent = segment.label
    }
    for (const [key, entry] of this.entries) {
      if (live.has(key) || entry.exiting) continue
      entry.exiting = true
      entry.to = collapsed(entry.current)
      entry.path.setAttribute('class', 'segment is-exiting')
      entry.path.removeAttribute('data-idx')
      changed = true
    }
    if (!changed) return
    cancelAnimationFrame(this.frame)
    for (const entry of this.entries.values()) entry.from = entry.current
    if (this.motion.matches || document.hidden) {
      this.finish()
      return
    }
    this.started = performance.now()
    this.group.setAttribute('data-transitioning', 'true')
    this.frame = requestAnimationFrame(this.tick)
  }

  private tick = (now: number): void => {
    if (!this.group.isConnected) {
      this.dispose()
      return
    }
    const progress = Math.min(1, Math.max(0, (now - this.started) / this.duration))
    const eased = 1 - (1 - progress) ** 3
    for (const entry of this.entries.values()) {
      entry.current = {
        ...interpolateArc(entry.from, entry.to, eased),
        alpha: entry.from.alpha + (entry.to.alpha - entry.from.alpha) * eased,
        color: entry.from.color.map((value, index) => value + (entry.to.color[index] - value) * eased),
      }
      this.paint(entry)
    }
    if (progress < 1) this.frame = requestAnimationFrame(this.tick)
    else this.finish()
  }

  private paint(entry: Entry): void {
    entry.path.setAttribute('d', arcPath(entry.current))
    entry.path.setAttribute('fill', `rgb(${entry.current.color.map(Math.round).join(',')})`)
    entry.path.setAttribute('fill-opacity', String(entry.current.alpha))
    entry.path.setAttribute('stroke-opacity', String(entry.current.alpha))
  }

  private finish(): void {
    cancelAnimationFrame(this.frame)
    this.frame = 0
    for (const [key, entry] of this.entries) {
      if (entry.exiting) {
        entry.path.remove()
        this.entries.delete(key)
      }
      else {
        entry.current = entry.to
        this.paint(entry)
      }
    }
    this.group.removeAttribute('data-transitioning')
  }

  dispose(): void {
    this.finish()
    this.motion.removeEventListener('change', this.settle)
    document.removeEventListener('visibilitychange', this.visibility)
  }
}
