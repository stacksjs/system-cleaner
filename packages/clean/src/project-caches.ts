import * as fs from 'node:fs'
import * as path from 'node:path'
import { formatBytes, getDirSize, HOME, pathExists, safeReadDir, safeStat } from '@system-cleaner/core'

/**
 * Project-local build caches.
 *
 * Every entry in `categories.ts` is a fixed absolute path, which covers the
 * global per-tool caches well and cannot express the larger half of the
 * problem: the caches each project keeps inside itself. The gap is not
 * marginal. On the developer Mac this was written against, the Zig global
 * cache those targets clean held 114 MB while the 32 project-local
 * `.zig-cache` directories they cannot see held 13.1 GB.
 *
 * This is the scanner for the second kind: named directories, found by
 * walking a small set of roots rather than by being listed one by one.
 */

/**
 * What cleaning a pattern costs, using the same vocabulary as `CleanTarget`.
 *
 * `safe` — regenerated locally from sources already on disk. The only cost
 * is the next build being cold.
 * `caution` — usually build output, but not always. Left out of Select All.
 */
export type ProjectCacheRisk = 'safe' | 'caution'

export interface ProjectCachePattern {
  /** Exact directory name to match. */
  name: string
  label: string
  /** What the user runs to get it back, shown so the cost is explicit. */
  rebuild: string
  risk: ProjectCacheRisk
  /**
   * Whether the directory is only build output when the project ignores it.
   * `dist` and `build` are committed by some projects and shipped from by
   * others; a matching `.gitignore` entry is what separates the two.
   */
  requiresGitignore?: boolean
}

/**
 * Deliberately excludes `node_modules`. Restoring it needs the network and is
 * not reproducible without a lockfile, which is a different promise from
 * everything here — see the stale-dependency scanner.
 */
export const PROJECT_CACHE_PATTERNS: ProjectCachePattern[] = [
  { name: '.zig-cache', label: 'Zig build cache', rebuild: 'zig build', risk: 'safe' },
  { name: 'zig-out', label: 'Zig build output', rebuild: 'zig build', risk: 'safe' },
  { name: '.turbo', label: 'Turborepo cache', rebuild: 'turbo run', risk: 'safe' },
  { name: '.parcel-cache', label: 'Parcel cache', rebuild: 'parcel build', risk: 'safe' },
  { name: '.next', label: 'Next.js build cache', rebuild: 'next build', risk: 'safe' },
  { name: '.nuxt', label: 'Nuxt build cache', rebuild: 'nuxt build', risk: 'safe' },
  { name: '.svelte-kit', label: 'SvelteKit build cache', rebuild: 'vite build', risk: 'safe' },
  { name: '__pycache__', label: 'Python bytecode cache', rebuild: 'automatic on next import', risk: 'safe' },
  { name: '.pytest_cache', label: 'pytest cache', rebuild: 'pytest', risk: 'safe' },
  { name: '.gradle', label: 'Gradle project cache', rebuild: 'gradle build', risk: 'safe' },
  { name: 'DerivedData', label: 'Xcode derived data', rebuild: 'xcodebuild', risk: 'safe' },
  { name: 'target', label: 'Rust build output', rebuild: 'cargo build', risk: 'caution', requiresGitignore: true },
  { name: 'dist', label: 'Build output', rebuild: 'the project build script', risk: 'caution', requiresGitignore: true },
  { name: 'build', label: 'Build output', rebuild: 'the project build script', risk: 'caution', requiresGitignore: true },
]

/**
 * Likely homes for source code. `$HOME` itself is never scanned: it would
 * walk Library, Pictures and every mail attachment to find a handful of
 * build directories.
 */
export const DEFAULT_SCAN_ROOTS: string[] = [
  path.join(HOME, 'Documents'),
  path.join(HOME, 'Code'),
  path.join(HOME, 'Projects'),
  path.join(HOME, 'Developer'),
  path.join(HOME, 'dev'),
  path.join(HOME, 'src'),
  path.join(HOME, 'work'),
  path.join(HOME, 'repos'),
]

/** Files that mark a directory as the root of a project. `.git` wins. */
const PROJECT_MARKERS = ['.git', 'package.json', 'build.zig', 'Cargo.toml', 'go.mod', 'pyproject.toml', 'Gemfile', 'pom.xml']

/**
 * Never descended into.
 *
 * Two reasons. `node_modules` is the expensive one — a single tree can hold
 * hundreds of thousands of entries, and nothing inside it is a project cache
 * worth reporting separately from the tree itself.
 *
 * The rest are vendored dependency directories, and they are a correctness
 * problem rather than a performance one. A `dist` inside `pantry/pako` is
 * that package's shipped artifact: no build script in the host project
 * regenerates it, and deleting it breaks the app. The `.gitignore` test
 * cannot catch this on its own, because it reads the project root's ignore
 * file — where `dist` is listed, so every vendored `dist` below inherits the
 * pass. Scanning a real project surfaced 291 of them in one repository.
 */
const NEVER_DESCEND = new Set([
  'node_modules', 'pantry', 'vendor', 'bower_components', 'Pods',
  '.venv', 'venv', '.pnpm', '.yarn', '.git', '.svn', '.hg', 'Library', '.Trash',
])

const DEFAULT_MAX_DEPTH = 6
const DEFAULT_MIN_AGE_DAYS = 7

export interface ProjectCacheEntry {
  path: string
  /** `~`-relative, for display. */
  displayPath: string
  /** The pattern name that matched, e.g. `.zig-cache`. */
  pattern: string
  label: string
  rebuild: string
  risk: ProjectCacheRisk
  sizeBytes: number
  sizeFormatted: string
  daysSinceModified: number
}

export interface ProjectCacheGroup {
  /** Directory name of the owning project, e.g. `home`. */
  project: string
  projectPath: string
  displayPath: string
  entries: ProjectCacheEntry[]
  sizeBytes: number
  sizeFormatted: string
  /** Newest cache in the group, as a proxy for how recently it was built. */
  daysSinceModified: number
}

export interface ScanProjectCachesOptions {
  /** Defaults to the subset of {@link DEFAULT_SCAN_ROOTS} that exists. */
  roots?: string[]
  /** Directory levels below each root. Defaults to 6. */
  maxDepth?: number
  /** Skip anything modified more recently than this. Defaults to 7 days. */
  minAgeDays?: number
  /** Pattern names to include. Defaults to all of {@link PROJECT_CACHE_PATTERNS}. */
  patterns?: string[]
  /** Stop walking at this `Date.now()` value. Partial results are still real. */
  deadline?: number
}

export interface ProjectCacheScanResult {
  groups: ProjectCacheGroup[]
  totalBytes: number
  totalFormatted: string
  entryCount: number
  rootsScanned: string[]
  /** True when `deadline` cut the walk short. */
  timedOut: boolean
}

function display(target: string): string {
  return target.startsWith(`${HOME}/`) ? `~${target.slice(HOME.length)}` : target
}

/**
 * The outermost project a cache belongs to, not the innermost.
 *
 * A monorepo puts a `.zig-cache` in every package. Grouping those under each
 * package produces thirty rows that mean one decision; grouping them under
 * the repository produces the row the user can actually act on.
 */
function findProjectRoot(cachePath: string, scanRoot: string): string {
  let best: string | null = null
  let current = path.dirname(cachePath)

  while (current.startsWith(scanRoot) && current !== scanRoot) {
    if (PROJECT_MARKERS.some(marker => pathExists(path.join(current, marker))))
      best = current
    const parent = path.dirname(current)
    if (parent === current)
      break
    current = parent
  }

  // No marker anywhere above it — fall back to the cache's own parent, which
  // at least keeps the row attributable to something on disk.
  return best ?? path.dirname(cachePath)
}

/**
 * Whether a project ignores a directory.
 *
 * Only consulted for patterns where being ignored is what makes the
 * directory build output. A `dist` the project tracks in git may be the
 * artifact it ships.
 */
function isIgnoredByGit(projectRoot: string, name: string): boolean {
  const gitignore = path.join(projectRoot, '.gitignore')
  if (!pathExists(gitignore))
    return false

  try {
    const lines = fs.readFileSync(gitignore, 'utf8').split('\n')
    return lines.some((line) => {
      const entry = line.trim().replace(/^\/+|\/+$/g, '')
      return entry === name || entry === `**/${name}`
    })
  }
  catch {
    return false
  }
}

/**
 * Find project-local build caches under a small set of code roots.
 *
 * Matching directories are not descended into: a `.zig-cache` holds nothing
 * this scanner needs to report separately, and walking it would cost more
 * than the entire rest of the scan.
 */
export async function scanProjectCaches(options: ScanProjectCachesOptions = {}): Promise<ProjectCacheScanResult> {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH
  const minAgeDays = options.minAgeDays ?? DEFAULT_MIN_AGE_DAYS
  const deadline = options.deadline

  const selected = options.patterns
    ? PROJECT_CACHE_PATTERNS.filter(p => options.patterns!.includes(p.name))
    : PROJECT_CACHE_PATTERNS
  const byName = new Map(selected.map(p => [p.name, p]))

  const roots = (options.roots ?? DEFAULT_SCAN_ROOTS).filter(root => pathExists(root))
  const now = Date.now()
  const found: { entry: ProjectCacheEntry, projectRoot: string }[] = []
  let timedOut = false

  /**
   * Resolved paths already recorded.
   *
   * Two roots routinely reach one directory — a checkout under `~/Documents`
   * symlinked into `~/Code` is the common shape, and it was present on the
   * machine this was developed against. Counting it twice does not just
   * duplicate a row, it promises the user 463 MB that deleting the first copy
   * already freed.
   */
  const seen = new Set<string>()

  for (const root of roots) {
    const queue: { dir: string, depth: number }[] = [{ dir: root, depth: 0 }]

    while (queue.length > 0) {
      if (deadline && Date.now() > deadline) {
        timedOut = true
        break
      }

      const { dir, depth } = queue.shift()!
      if (depth > maxDepth)
        continue

      for (const name of safeReadDir(dir)) {
        if (NEVER_DESCEND.has(name))
          continue

        const full = path.join(dir, name)
        const stat = safeStat(full)
        if (!stat?.isDirectory())
          continue

        const pattern = byName.get(name)
        if (!pattern) {
          queue.push({ dir: full, depth: depth + 1 })
          continue
        }

        // A match is a leaf: record it, never walk inside it.
        const daysSinceModified = Math.floor((now - stat.mtimeMs) / 86_400_000)
        if (daysSinceModified < minAgeDays)
          continue

        let resolved = full
        try {
          resolved = fs.realpathSync(full)
        }
        catch { /* unreadable link — fall back to the literal path */ }
        if (seen.has(resolved))
          continue
        seen.add(resolved)

        const projectRoot = findProjectRoot(full, root)
        if (pattern.requiresGitignore && !isIgnoredByGit(projectRoot, name))
          continue

        const sizeBytes = await getDirSize(full)
        if (sizeBytes === 0)
          continue

        found.push({
          projectRoot,
          entry: {
            path: full,
            displayPath: display(full),
            pattern: pattern.name,
            label: pattern.label,
            rebuild: pattern.rebuild,
            risk: pattern.risk,
            sizeBytes,
            sizeFormatted: formatBytes(sizeBytes),
            daysSinceModified,
          },
        })
      }
    }

    if (timedOut)
      break
  }

  const grouped = new Map<string, ProjectCacheGroup>()
  for (const { entry, projectRoot } of found) {
    let group = grouped.get(projectRoot)
    if (!group) {
      group = {
        project: path.basename(projectRoot),
        projectPath: projectRoot,
        displayPath: display(projectRoot),
        entries: [],
        sizeBytes: 0,
        sizeFormatted: '0 B',
        daysSinceModified: Number.MAX_SAFE_INTEGER,
      }
      grouped.set(projectRoot, group)
    }
    group.entries.push(entry)
    group.sizeBytes += entry.sizeBytes
    group.daysSinceModified = Math.min(group.daysSinceModified, entry.daysSinceModified)
  }

  const groups = [...grouped.values()]
    .map(group => ({
      ...group,
      sizeFormatted: formatBytes(group.sizeBytes),
      entries: group.entries.sort((a, b) => b.sizeBytes - a.sizeBytes),
    }))
    .sort((a, b) => b.sizeBytes - a.sizeBytes)

  const totalBytes = groups.reduce((sum, group) => sum + group.sizeBytes, 0)

  return {
    groups,
    totalBytes,
    totalFormatted: formatBytes(totalBytes),
    entryCount: found.length,
    rootsScanned: roots,
    timedOut,
  }
}
