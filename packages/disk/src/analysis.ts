import * as fs from 'node:fs'
import * as path from 'node:path'
import { HOME, classifyByGit, formatBytes, getDirSize, pathExists, refusesDeletion } from '@system-cleaner/core'
import type { DiskEntry, DiskUsageByCategory, LargeFile, ProjectArtifact } from './types'
import { categorizeFile, getAllCategories, getProjectArtifactPatterns } from './categories'
import { flattenTree, scanDirectory } from './scanner'

/**
 * Analyze disk usage by file category
 */
export function analyzeByCategory(tree: DiskEntry): DiskUsageByCategory[] {
  const totals = new Map<string, { size: number, count: number }>()
  const allEntries = flattenTree(tree)
  let totalSize = 0

  for (const entry of allEntries) {
    if (entry.isDirectory || entry.aggregate)
      continue
    const cat = categorizeFile(entry.name)
    const existing = totals.get(cat) || { size: 0, count: 0 }
    existing.size += entry.sizeBytes
    existing.count++
    totals.set(cat, existing)
    totalSize += entry.sizeBytes
  }

  const categories = getAllCategories()
  const result: DiskUsageByCategory[] = []

  for (const cat of categories) {
    const data = totals.get(cat.category)
    if (!data || data.size === 0)
      continue
    result.push({
      category: cat.category,
      label: cat.label,
      icon: cat.icon,
      sizeBytes: data.size,
      sizeFormatted: formatBytes(data.size),
      fileCount: data.count,
      percentage: totalSize > 0 ? Math.round((data.size / totalSize) * 100) : 0,
      color: cat.color,
    })
  }

  // Add "other" for uncategorized files
  const otherData = totals.get('other')
  if (otherData && otherData.size > 0) {
    result.push({
      category: 'other',
      label: 'Other Files',
      icon: 'i-f7-folder-fill',
      sizeBytes: otherData.size,
      sizeFormatted: formatBytes(otherData.size),
      fileCount: otherData.count,
      percentage: totalSize > 0 ? Math.round((otherData.size / totalSize) * 100) : 0,
      color: '#98989d',
    })
  }

  return result.sort((a, b) => b.sizeBytes - a.sizeBytes)
}

/**
 * Find the N largest files in a directory tree
 */
export function findLargestFiles(tree: DiskEntry, count = 50): LargeFile[] {
  const files: LargeFile[] = []

  function walk(entry: DiskEntry): void {
    // `aggregate` nodes stand for "everything else in this folder". Listing one
    // as the largest file on the disk would be a lie with a real path on it.
    if (!entry.isDirectory && !entry.aggregate) {
      files.push({
        path: entry.path,
        name: entry.name,
        sizeBytes: entry.sizeBytes,
        sizeFormatted: formatBytes(entry.sizeBytes),
        modifiedAt: entry.modifiedAt || new Date(),
        category: categorizeFile(entry.name),
      })
    }
    if (entry.children) {
      for (const child of entry.children)
        walk(child)
    }
  }

  walk(tree)
  files.sort((a, b) => b.sizeBytes - a.sizeBytes)
  return files.slice(0, count)
}

/**
 * Scan for project build artifacts that can be cleaned up
 */
/**
 * Files that mean "a build happens here", so a directory beside one of them
 * was probably produced rather than written.
 *
 * Matching a bare directory name is not enough on its own, and the gap is not
 * theoretical: with `Documents` among the roots, a synthetic non-developer
 * tree produced `Insurance/2024/coverage` and `Music/Pods` as `safe`, one
 * click from deletion. `coverage`, `Pods`, `build`, `dist`, `vendor` and
 * `target` are ordinary English words before they are build output.
 */
const PROJECT_MARKERS = [
  'package.json',
  'bun.lock',
  'deps.yaml',
  'Cargo.toml',
  'go.mod',
  'build.zig',
  'pyproject.toml',
  'requirements.txt',
  'Gemfile',
  'composer.json',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'Package.swift',
  'Podfile',
  'pubspec.yaml',
  'mix.exs',
  'CMakeLists.txt',
  'Makefile',
  'tsconfig.json',
]

/** True when this directory is plausibly the root of a project. */
function looksLikeProject(dir: string): boolean {
  if (fs.existsSync(path.join(dir, '.git')))
    return true
  return PROJECT_MARKERS.some(marker => fs.existsSync(path.join(dir, marker)))
}

/**
 * True when the candidate is itself a checkout rather than build output.
 *
 * `pantry` is a vendored runtime directory in this project and the name of a
 * repository, and on the machine this was written against both existed:
 * fourteen vendored directories, and a 665 MB clone of pantry-pm/pantry whose
 * parent folder simply collects repositories. The clone matched on name, was
 * classified `safe`, and `cleanDirectory` would have removed every entry
 * including `.git`. Nothing in this app goes through the Trash, so that is a
 * repository and any unpushed work in it, gone.
 */
function isCheckout(dir: string): boolean {
  return fs.existsSync(path.join(dir, '.git'))
}

export const DEFAULT_PROJECT_ROOTS: string[] = [
  // Checked in order and skipped when absent, so listing several conventions
  // costs nothing. The original four were `Code`, `Projects`, `Developer` and
  // `Work` under HOME, which found 11 artifacts on a machine that had 2012:
  // the repositories were in `~/Documents/Projects`, and a scanner that finds
  // nothing reads exactly like a machine that is already clean.
  'Code',
  'Projects',
  'Developer',
  'Work',
  'src',
  'dev',
  'repos',
  'git',
  'Sites',
  'Documents',
].map(dir => path.join(HOME, dir))

export async function findProjectArtifacts(
  searchPaths: string[] = DEFAULT_PROJECT_ROOTS,
  maxDepth = 4,
  /**
   * Below this, an artifact is noise rather than a finding. On a real machine
   * 1803 `dist` directories came to 2.9 GB and 82% of them were under a
   * megabyte — a list nobody can read, hiding the dozen entries that matter.
   */
  minSizeBytes = 1_000_000,
): Promise<ProjectArtifact[]> {
  const artifacts: ProjectArtifact[] = []
  const patterns = getProjectArtifactPatterns()
  const patternNames = new Set(patterns.map(p => p.dirName))

  for (const searchPath of searchPaths) {
    if (!pathExists(searchPath))
      continue
    await scanForArtifacts(searchPath, 0, maxDepth, patternNames, patterns, artifacts)
  }

  // Get sizes concurrently
  await Promise.all(
    artifacts.map(async (artifact) => {
      artifact.sizeBytes = await getDirSize(artifact.path)
      artifact.sizeFormatted = formatBytes(artifact.sizeBytes)
    }),
  )

  // Ask git last, in one batch, after the size filter has already thinned the
  // list. Two subprocesses per repository instead of two per candidate: a
  // machine with 2,606 matches would otherwise pay five thousand spawns to
  // answer a question that batches into a few dozen.
  //
  // The name said `build output`; git gets to say otherwise. On the machine
  // this was written against it overruled the pattern 48 times, including a
  // source directory called `build`, a committed GitHub Action bundle, and
  // the test fixtures every language runtime ships inside `node_modules`.
  const sized = artifacts.filter(a => a.sizeBytes >= minSizeBytes)
  const disposition = await classifyByGit(sized.map(a => a.path))
  for (const artifact of sized) {
    artifact.git = disposition.get(artifact.path) ?? 'unknown'
    // `unknown` blocks as firmly as `tracked`. git not answering is not
    // evidence that nothing is tracked, and treating it as such is how the
    // gate silently stopped existing on a repository with a corrupt index.
    if (refusesDeletion(artifact.git))
      artifact.risk = 'blocked'
    // `unversioned` stays on its pattern risk. Outside a repository there is
    // nothing to appeal to, and refusing everything there would exclude the
    // scratch checkouts and downloaded source trees that hold the most junk.
  }

  return sized.sort((a, b) => b.sizeBytes - a.sizeBytes)
}

async function scanForArtifacts(
  dirPath: string,
  depth: number,
  maxDepth: number,
  patternNames: Set<string>,
  patterns: { dirName: string, type: string, label: string, risk: 'safe' | 'caution' }[],
  artifacts: ProjectArtifact[],
): Promise<void> {
  if (depth > maxDepth)
    return

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true })
  }
  catch {
    return
  }

  for (const entry of entries) {
    if (!entry.isDirectory())
      continue
    if (entry.name.startsWith('.') && !patternNames.has(entry.name))
      continue

    const fullPath = path.join(dirPath, entry.name)

    if (patternNames.has(entry.name)) {
      // Two gates before this counts as build output. Without them the
      // scanner offered a 665 MB git clone and a folder of insurance PDFs,
      // both marked safe, both one click from an unrecoverable delete.
      if (!looksLikeProject(dirPath) || isCheckout(fullPath)) {
        await scanForArtifacts(fullPath, depth + 1, maxDepth, patternNames, patterns, artifacts)
        continue
      }

      const pattern = patterns.find(p => p.dirName === entry.name)!
      let mtime = new Date()
      try {
        mtime = fs.statSync(fullPath).mtime
      }
      catch { /* skip */ }

      // Determine project name from parent directory
      const projectName = path.basename(dirPath)

      artifacts.push({
        path: fullPath,
        type: pattern.type,
        sizeBytes: 0,
        sizeFormatted: '...',
        projectName,
        lastModified: mtime,
        label: pattern.label,
        risk: pattern.risk,
        // Settled in one batch once the list is final; see findProjectArtifacts.
        git: 'unversioned',
      })
      // Don't recurse into artifact directories
      continue
    }

    // Recurse into subdirectories
    await scanForArtifacts(fullPath, depth + 1, maxDepth, patternNames, patterns, artifacts)
  }
}

/**
 * Get a summary of disk usage for the home directory
 */
export async function getHomeDirSummary(): Promise<{ tree: DiskEntry, scanTimeMs: number }> {
  const result = await scanDirectory(HOME, {
    maxDepth: 2,
    timeoutMs: 5000,
  })
  return { tree: result.tree, scanTimeMs: result.scanTimeMs }
}
