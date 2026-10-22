import * as path from 'node:path'
import { formatBytes, getDirSize, HOME, pathExists, safeReadDir, safeStat } from '@system-cleaner/core'
import { DEFAULT_SCAN_ROOTS } from './project-caches'

/**
 * Installed dependency trees for projects nobody has touched in months.
 *
 * Kept apart from the project-cache scanner on purpose. Everything that
 * scanner offers is regenerated locally and deterministically — `zig build`
 * rebuilds `.zig-cache` from sources already on disk. `node_modules` is not
 * that:
 *
 *   - reinstalling needs the network, so deleting it offline strands the
 *     project until connectivity returns
 *   - it is only reproducible with a lockfile; without one the restored tree
 *     can differ from what was removed, and the project may build differently
 *   - a registry can change underneath you — unpublished, yanked or
 *     version-shifted packages make a reinstall fail or resolve differently
 *   - restoring costs minutes, scaling with the dependency count
 *
 * So this is framed as reclaiming stale dependencies rather than clearing a
 * cache: gated on the project being idle, gated on a lockfile existing, and
 * never part of a one-click sweep.
 */

/** Lockfiles, and the command that restores a tree from each. */
const LOCKFILES: { file: string, restore: string, manager: string }[] = [
  { file: 'bun.lock', restore: 'bun install', manager: 'bun' },
  { file: 'bun.lockb', restore: 'bun install', manager: 'bun' },
  { file: 'pnpm-lock.yaml', restore: 'pnpm install', manager: 'pnpm' },
  { file: 'yarn.lock', restore: 'yarn install', manager: 'yarn' },
  { file: 'package-lock.json', restore: 'npm ci', manager: 'npm' },
]

/**
 * Directories that say nothing about when a human last worked on a project.
 * An install writes into `node_modules` and a build writes into `dist`; both
 * would report a long-abandoned project as active.
 */
const NOT_ACTIVITY = new Set([
  'node_modules', '.git', 'dist', 'build', 'target', 'out', 'coverage',
  '.next', '.nuxt', '.turbo', '.cache', '.zig-cache', 'zig-out',
  '__pycache__', '.venv', 'venv', 'vendor', 'pantry', 'Pods',
])

/** Entries to stat before accepting the newest mtime found so far. */
const ACTIVITY_SCAN_BUDGET = 2000

const DEFAULT_IDLE_DAYS = 90
const DEFAULT_MAX_DEPTH = 5

export interface StaleDependencyTree {
  /** Absolute path of the `node_modules` directory. */
  path: string
  displayPath: string
  /** Directory name of the owning project. */
  project: string
  projectPath: string
  sizeBytes: number
  sizeFormatted: string
  /** Days since a human last touched a source file in this project. */
  idleDays: number
  /** `bun install`, `npm ci`, … — empty when no lockfile was found. */
  restoreCommand: string
  packageManager: string
  /**
   * False when no lockfile is present. Reinstalling is then not reproducible:
   * the restored tree may not match what was deleted. Surfaced rather than
   * hidden so the user decides.
   */
  reproducible: boolean
}

export interface ScanStaleDependenciesOptions {
  roots?: string[]
  maxDepth?: number
  /** Minimum days of project inactivity. Defaults to 90. */
  minIdleDays?: number
  /** Include trees with no lockfile, flagged as not reproducible. Defaults to true. */
  includeWithoutLockfile?: boolean
  deadline?: number
}

export interface StaleDependencyScanResult {
  trees: StaleDependencyTree[]
  totalBytes: number
  totalFormatted: string
  /** Of `trees`, how many lack a lockfile. */
  withoutLockfile: number
  rootsScanned: string[]
  timedOut: boolean
}

function display(target: string): string {
  return target.startsWith(`${HOME}/`) ? `~${target.slice(HOME.length)}` : target
}

/**
 * When a human last touched this project.
 *
 * Deliberately ignores `node_modules` and build output: an install or a CI
 * build bumps those, and using them would report an abandoned project as
 * active — which is exactly the project whose dependencies are safe to drop.
 *
 * Bounded by {@link ACTIVITY_SCAN_BUDGET}. A partial answer skews newer, so
 * the error is on the side of leaving a tree alone.
 */
function newestSourceMtime(projectRoot: string): number {
  let newest = 0
  let budget = ACTIVITY_SCAN_BUDGET
  const queue: string[] = [projectRoot]

  while (queue.length > 0 && budget > 0) {
    const dir = queue.shift()!
    for (const name of safeReadDir(dir)) {
      if (budget-- <= 0)
        break
      if (NOT_ACTIVITY.has(name))
        continue

      const full = path.join(dir, name)
      const stat = safeStat(full)
      if (!stat)
        continue

      if (stat.isDirectory())
        queue.push(full)
      else if (stat.mtimeMs > newest)
        newest = stat.mtimeMs
    }
  }

  return newest
}

function findLockfile(projectRoot: string): { restore: string, manager: string } | null {
  for (const entry of LOCKFILES) {
    if (pathExists(path.join(projectRoot, entry.file)))
      return { restore: entry.restore, manager: entry.manager }
  }
  return null
}

/**
 * Find `node_modules` trees whose project has been idle long enough that
 * reinstalling is an acceptable cost.
 */
export async function scanStaleDependencies(
  options: ScanStaleDependenciesOptions = {},
): Promise<StaleDependencyScanResult> {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH
  const minIdleDays = options.minIdleDays ?? DEFAULT_IDLE_DAYS
  const includeWithoutLockfile = options.includeWithoutLockfile ?? true
  const deadline = options.deadline

  const roots = (options.roots ?? DEFAULT_SCAN_ROOTS).filter(root => pathExists(root))
  const now = Date.now()
  const trees: StaleDependencyTree[] = []
  const seen = new Set<string>()
  let timedOut = false

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
        if (name === '.git')
          continue

        const full = path.join(dir, name)
        const stat = safeStat(full)
        if (!stat?.isDirectory())
          continue

        if (name !== 'node_modules') {
          queue.push({ dir: full, depth: depth + 1 })
          continue
        }

        // Never walk inside a dependency tree. A nested `node_modules` is
        // that tree's business, and a workspace package's own tree is found
        // via its own directory, which is not below this one.
        const projectRoot = path.dirname(full)
        if (seen.has(projectRoot))
          continue
        seen.add(projectRoot)

        // A project without a manifest is not a project this can reason about.
        if (!pathExists(path.join(projectRoot, 'package.json')))
          continue

        const newest = newestSourceMtime(projectRoot)
        if (newest === 0)
          continue

        const idleDays = Math.floor((now - newest) / 86_400_000)
        if (idleDays < minIdleDays)
          continue

        const lock = findLockfile(projectRoot)
        if (!lock && !includeWithoutLockfile)
          continue

        const sizeBytes = await getDirSize(full)
        if (sizeBytes === 0)
          continue

        trees.push({
          path: full,
          displayPath: display(full),
          project: path.basename(projectRoot),
          projectPath: projectRoot,
          sizeBytes,
          sizeFormatted: formatBytes(sizeBytes),
          idleDays,
          restoreCommand: lock?.restore ?? '',
          packageManager: lock?.manager ?? '',
          reproducible: lock !== null,
        })
      }
    }

    if (timedOut)
      break
  }

  trees.sort((a, b) => b.sizeBytes - a.sizeBytes)
  const totalBytes = trees.reduce((sum, tree) => sum + tree.sizeBytes, 0)

  return {
    trees,
    totalBytes,
    totalFormatted: formatBytes(totalBytes),
    withoutLockfile: trees.filter(tree => !tree.reproducible).length,
    rootsScanned: roots,
    timedOut,
  }
}
