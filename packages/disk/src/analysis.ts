import * as fs from 'node:fs'
import * as path from 'node:path'
import { HOME, formatBytes, getDirSize, pathExists, safeReadDir } from '@system-cleaner/core'
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
    if (entry.isDirectory)
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
      icon: '📁',
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
    if (!entry.isDirectory) {
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
export async function findProjectArtifacts(
  searchPaths: string[] = [path.join(HOME, 'Code'), path.join(HOME, 'Projects'), path.join(HOME, 'Developer'), path.join(HOME, 'Work')],
  maxDepth = 4,
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

  return artifacts.sort((a, b) => b.sizeBytes - a.sizeBytes)
}

async function scanForArtifacts(
  dirPath: string,
  depth: number,
  maxDepth: number,
  patternNames: Set<string>,
  patterns: { dirName: string, type: string, label: string }[],
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
      const pattern = patterns.find(p => p.dirName === entry.name)!
      let mtime = new Date()
      try { mtime = fs.statSync(fullPath).mtime } catch { /* skip */ }

      // Determine project name from parent directory
      const projectName = path.basename(dirPath)

      artifacts.push({
        path: fullPath,
        type: pattern.type,
        sizeBytes: 0,
        sizeFormatted: '...',
        projectName,
        lastModified: mtime,
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
export function getHomeDirSummary(): { tree: DiskEntry, scanTimeMs: number } {
  const result = scanDirectory(HOME, {
    maxDepth: 2,
    timeoutMs: 5000,
    includeHidden: true,
  })
  return { tree: result.tree, scanTimeMs: result.scanTimeMs }
}
