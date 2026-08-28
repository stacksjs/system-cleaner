import { exec } from './exec'
import { formatBytes } from './format'

export type SoftwareUpdateKind = 'macos' | 'cltools' | 'safari' | 'firmware' | 'other'

export interface SoftwareUpdate {
  label: string
  title: string
  version: string
  sizeBytes: number
  sizeLabel: string
  recommended: boolean
  restartRequired: boolean
  kind: SoftwareUpdateKind
  /**
   * Build this update installs, e.g. `26A5421a`.
   *
   * On a beta the marketing version does not move — 27.0 upgrades to 27.0 —
   * so the build is the only thing that distinguishes "Beta 7 is available"
   * from the beta already running.
   */
  buildVersion: string | null
}

/** The macOS release currently running. */
export interface MacosRelease {
  /** Marketing version, e.g. `27.0`. */
  version: string
  /** Build, e.g. `26A5416b`. */
  build: string | null
  /** True when the build number marks this as a pre-release. */
  beta: boolean
  /**
   * What to show a person: `27.0 (26A5416b, beta)`.
   *
   * On a beta, the marketing version alone is actively misleading — every
   * beta of 27.0 reports `27.0`, so "macOS 27.0 · 1 update available" gives
   * no way to tell which beta is installed or which one is on offer.
   */
  label: string
}

export interface ClToolsInfo {
  installed: boolean
  version: string | null
  installPath: string | null
}

export interface SoftwareUpdateResult {
  updates: SoftwareUpdate[]
  clToolsInfo: ClToolsInfo
  macosVersion: string | null
  macosRelease: MacosRelease | null
  scannedAt: string
  cached: boolean
}

/**
 * Whether an Apple build number is a pre-release.
 *
 * Apple's builds read `<major><letter><number><suffix>` — `26A335` shipped,
 * `26A5416b` did not. Pre-release builds take numbers from 5000 up, which is
 * the only signal available locally: `sw_vers` has no "am I on a beta" flag,
 * and the seeding preferences that used to answer it are gone.
 */
export function isBetaBuild(build: string | null | undefined): boolean {
  if (!build) return false
  const match = build.match(/^\d+[A-Z](\d+)/)
  if (!match) return false
  return Number.parseInt(match[1], 10) >= 5000
}

/** Build the human-facing label for a macOS release. */
export function describeMacosRelease(version: string, build: string | null): MacosRelease {
  const beta = isBetaBuild(build)
  const parts = [build, beta ? 'beta' : null].filter(Boolean)
  return {
    version,
    build,
    beta,
    label: parts.length > 0 ? `${version} (${parts.join(', ')})` : version,
  }
}

/**
 * Pull the build number out of a `softwareupdate` label.
 *
 * Labels look like `macOS 27 Beta 7-26A5421a`: the target build follows the
 * final hyphen. Without it the updates screen can only say "macOS 27.0 →
 * macOS 27.0", which is true and useless.
 */
export function parseUpdateBuild(label: string): string | null {
  const match = label.match(/-(\d+[A-Z]\d+[a-z]?)$/)
  return match ? match[1] : null
}

/** Compare dotted version strings; returns true when `latest` is newer than `current`. */
export function isNewerVersion(latest: string, current: string): boolean {
  if (!latest || !current || latest === current) return false
  if (current === '?') return !!latest
  const norm = (v: string) => v.replace(/[,+].*/g, '').replace(/-.*$/, '').split('.').map(n => parseInt(n, 10) || 0)
  const a = norm(latest)
  const b = norm(current)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) > (b[i] || 0)) return true
    if ((a[i] || 0) < (b[i] || 0)) return false
  }
  return false
}

function classifyUpdate(title: string): SoftwareUpdateKind {
  const t = title.toLowerCase()
  if (t.includes('command line tools')) return 'cltools'
  if (t.includes('macos') || t.startsWith('mac os')) return 'macos'
  if (t.includes('safari')) return 'safari'
  if (t.includes('firmware') || t.includes('bridgeos')) return 'firmware'
  return 'other'
}

function parseSizeBytes(raw: string): number {
  const match = raw.match(/Size:\s*(\d+)\s*(KiB|MiB|GiB|KB|MB|GB)?/i)
  if (!match) return 0
  const num = Number.parseInt(match[1], 10)
  const unit = (match[2] || 'KiB').toLowerCase()
  if (unit.startsWith('g')) return num * 1024 ** 3
  if (unit.startsWith('m')) return num * 1024 ** 2
  return num * 1024
}

function finalizeUpdate(partial: Partial<SoftwareUpdate> & { label: string }): SoftwareUpdate {
  const title = partial.title || partial.label
  const sizeBytes = partial.sizeBytes || 0
  return {
    label: partial.label,
    title,
    version: partial.version || '',
    sizeBytes,
    sizeLabel: sizeBytes > 0 ? formatBytes(sizeBytes) : '—',
    recommended: partial.recommended ?? false,
    restartRequired: partial.restartRequired ?? false,
    kind: partial.kind || classifyUpdate(title),
    buildVersion: parseUpdateBuild(partial.label),
  }
}

/** Parse `softwareupdate -l` output into structured update entries. */
export function parseSoftwareUpdateList(output: string): SoftwareUpdate[] {
  if (!output || /No new software available/i.test(output)) return []

  const updates: SoftwareUpdate[] = []
  let current: Partial<SoftwareUpdate> & { label?: string } | null = null

  for (const line of output.split('\n')) {
    const labelMatch = line.match(/^\*\s*Label:\s*(.+)$/)
    if (labelMatch) {
      if (current?.label) updates.push(finalizeUpdate(current as Partial<SoftwareUpdate> & { label: string }))
      current = { label: labelMatch[1].trim() }
      continue
    }

    const detailMatch = line.match(/^\s+Title:\s*(.+)$/)
    if (detailMatch && current?.label) {
      const detail = detailMatch[1]
      const titleMatch = detail.match(/^([^,]+)/)
      const versionMatch = detail.match(/Version:\s*([^,]+)/)

      current.title = titleMatch?.[1]?.trim() || current.label
      current.version = versionMatch?.[1]?.trim() || ''
      current.sizeBytes = parseSizeBytes(detail)
      current.recommended = /Recommended:\s*YES/i.test(detail)
      current.kind = classifyUpdate(current.title)
      current.restartRequired = /Action:\s*restart/i.test(detail)
        || /restart/i.test(current.label || '')
        || current.kind === 'macos'
    }
  }

  if (current?.label) updates.push(finalizeUpdate(current as Partial<SoftwareUpdate> & { label: string }))
  return updates
}

/** Normalize pkgutil version strings like `26.4.1.0.1775747724` → `26.4.1`. */
export function normalizePkgVersion(raw: string): string {
  const parts = raw.trim().split('.')
  const semver: string[] = []
  for (const part of parts) {
    if (!/^\d+$/.test(part)) break
    semver.push(part)
    if (semver.length >= 3) break
  }
  return semver.join('.') || raw.trim()
}

/** Read installed Command Line Tools version and path. */
export async function getClToolsInfo(): Promise<ClToolsInfo> {
  const [pathResult, pkgResult] = await Promise.all([
    exec('xcode-select -p 2>/dev/null', { timeout: 3000 }),
    exec('pkgutil --pkg-info=com.apple.pkg.CLTools_Executables 2>/dev/null', { timeout: 3000 }),
  ])

  const installPath = pathResult.ok && pathResult.stdout.trim() ? pathResult.stdout.trim() : null
  let version: string | null = null
  if (pkgResult.ok) {
    const verMatch = pkgResult.stdout.match(/^version:\s*(.+)$/m)
    if (verMatch) version = normalizePkgVersion(verMatch[1])
  }

  return { installed: !!installPath, version, installPath }
}

export interface CheckSoftwareUpdatesOptions {
  /** When true, runs a full catalog scan (slower but freshest). */
  fullScan?: boolean
}

/** Query Apple Software Update for available macOS, CLT, and other system updates. */
export async function checkSoftwareUpdates(options: CheckSoftwareUpdatesOptions = {}): Promise<SoftwareUpdateResult> {
  const fullScan = options.fullScan ?? false
  const cmd = fullScan ? 'softwareupdate -l 2>&1' : 'softwareupdate -l --no-scan 2>&1'

  const [updateResult, clToolsInfo, macosResult, buildResult] = await Promise.all([
    exec(cmd, { timeout: fullScan ? 120_000 : 15_000 }),
    getClToolsInfo(),
    exec('sw_vers -productVersion 2>/dev/null', { timeout: 2000 }),
    // The marketing version is the same for every beta of a release, so the
    // build is what identifies which one is actually installed.
    exec('sw_vers -buildVersion 2>/dev/null', { timeout: 2000 }),
  ])

  const output = `${updateResult.stdout}\n${updateResult.stderr || ''}`
  const updates = parseSoftwareUpdateList(output)
  const macosVersion = macosResult.ok ? macosResult.stdout.trim() : null
  const macosBuild = buildResult.ok && buildResult.stdout.trim() ? buildResult.stdout.trim() : null

  return {
    updates,
    clToolsInfo,
    macosVersion,
    macosRelease: macosVersion ? describeMacosRelease(macosVersion, macosBuild) : null,
    scannedAt: new Date().toISOString(),
    cached: !fullScan,
  }
}
