import * as fs from 'node:fs'
import * as path from 'node:path'
import { exec } from '@system-cleaner/core'
import type { DiskEntry, ScanOptions, ScanResult } from './types'

const DEFAULT_MAX_DEPTH = 6
const DEFAULT_TIMEOUT_MS = 15_000
const CHECK_INTERVAL = 200
const MAX_HEAP_SIZE = 50

/** Directories that should never be recursed into — use `du` for size instead */
const FOLDED_DIRS = new Set([
  'node_modules', '.git', '__pycache__', '.cache', 'vendor', 'DerivedData',
  '.Spotlight-V100', '.fseventsd', 'CachedData', 'GPUCache', 'ShaderCache',
  '.npm', '.bun', '.Trash', '.next', '.nuxt', '.turbo',
  '.parcel-cache', 'target', '.gradle', 'Pods', '.dart_tool', '.venv',
  'venv', '.tox', '.mypy_cache', '.pytest_cache', 'dist', 'build',
  '.angular', '.svelte-kit', 'coverage', '.nyc_output', '.stx',
])

const SYSTEM_SKIP = new Set([
  '.Spotlight-V100', '.fseventsd', '.vol', '.file',
  '.DocumentRevisions-V100', '.PKInstallSandboxManager', '.Trashes',
])

/**
 * Scan a directory tree using concurrent workers, building a size-annotated tree.
 * Folded directories (node_modules, .git, etc.) are sized via `du` instead of recursing.
 */
export function scanDirectory(rootPath: string, options: ScanOptions = {}): ScanResult {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const skipPatterns = options.skipPatterns ?? FOLDED_DIRS
  const includeHidden = options.includeHidden ?? false

  const scanStart = Date.now()
  let aborted = false
  let totalFiles = 0
  let totalFolders = 0
  let checks = 0

  // Min-heap tracking the top N largest entries for fast top-N retrieval
  const topEntries: DiskEntry[] = []

  function pushToHeap(entry: DiskEntry): void {
    if (topEntries.length < MAX_HEAP_SIZE) {
      topEntries.push(entry)
      // Bubble up
      let i = topEntries.length - 1
      while (i > 0) {
        const parent = (i - 1) >> 1
        if (topEntries[parent].sizeBytes <= topEntries[i].sizeBytes)
          break
        const temp = topEntries[parent]
        topEntries[parent] = topEntries[i]
        topEntries[i] = temp
        i = parent
      }
    }
    else if (entry.sizeBytes > topEntries[0].sizeBytes) {
      // Replace min
      topEntries[0] = entry
      // Sift down
      let i = 0
      while (true) {
        const left = 2 * i + 1
        const right = 2 * i + 2
        let smallest = i
        if (left < topEntries.length && topEntries[left].sizeBytes < topEntries[smallest].sizeBytes)
          smallest = left
        if (right < topEntries.length && topEntries[right].sizeBytes < topEntries[smallest].sizeBytes)
          smallest = right
        if (smallest === i)
          break
        const swp = topEntries[smallest]
        topEntries[smallest] = topEntries[i]
        topEntries[i] = swp
        i = smallest
      }
    }
  }

  function scan(dirPath: string, depth: number): DiskEntry {
    const baseName = path.basename(dirPath) || '/'

    if (depth > maxDepth || aborted) {
      return { name: baseName, path: dirPath, sizeBytes: 0, isDirectory: true, children: [] }
    }

    checks++
    if (checks % CHECK_INTERVAL === 0) {
      if (Date.now() - scanStart > timeoutMs) {
        aborted = true
        return { name: baseName, path: dirPath, sizeBytes: 0, isDirectory: true, children: [] }
      }
      options.onProgress?.(totalFiles + totalFolders, dirPath)
    }

    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true })
    }
    catch {
      return { name: baseName, path: dirPath, sizeBytes: 0, isDirectory: true, children: [] }
    }

    const children: DiskEntry[] = []
    let totalSize = 0

    for (const entry of entries) {
      if (aborted)
        break

      if (!includeHidden && entry.name.startsWith('.') && depth > 0)
        continue
      if (SYSTEM_SKIP.has(entry.name))
        continue

      const fullPath = path.join(dirPath, entry.name)

      try {
        const stats = fs.lstatSync(fullPath)
        if (stats.isSymbolicLink())
          continue

        if (stats.isDirectory()) {
          totalFolders++

          // Folded directories: use `du` for fast size, don't recurse
          if (skipPatterns.has(entry.name) || depth >= maxDepth - 1) {
            const size = getDirSizeSync(fullPath)
            const child: DiskEntry = {
              name: entry.name,
              path: fullPath,
              sizeBytes: size,
              isDirectory: true,
              children: [],
            }
            children.push(child)
            pushToHeap(child)
            totalSize += size
          }
          else {
            const child = scan(fullPath, depth + 1)
            children.push(child)
            pushToHeap(child)
            totalSize += child.sizeBytes
          }
        }
        else {
          totalFiles++
          totalSize += stats.size
          const child: DiskEntry = {
            name: entry.name,
            path: fullPath,
            sizeBytes: stats.size,
            isDirectory: false,
            modifiedAt: stats.mtime,
          }
          children.push(child)
          if (stats.size > 10_000_000) // Only track files > 10MB in heap
            pushToHeap(child)
        }
      }
      catch {
        // Skip inaccessible
      }
    }

    // Sort children by size descending
    children.sort((a, b) => b.sizeBytes - a.sizeBytes)

    // Count files in this directory's direct children only
    const directFileCount = children.filter(c => !c.isDirectory).length

    return {
      name: baseName,
      path: dirPath,
      sizeBytes: totalSize,
      isDirectory: true,
      children,
      fileCount: directFileCount,
    }
  }

  const tree = scan(rootPath, 0)
  const scanTimeMs = Date.now() - scanStart

  return {
    tree,
    totalFiles,
    totalFolders,
    scanTimeMs,
    aborted,
  }
}

/**
 * Deep scan a specific directory with higher limits
 */
export function deepScanDirectory(dirPath: string, options: ScanOptions = {}): ScanResult {
  return scanDirectory(dirPath, {
    ...options,
    maxDepth: options.maxDepth ?? 8,
    timeoutMs: options.timeoutMs ?? 30_000,
  })
}

/**
 * Get top N largest items from a scan result
 */
export function getTopItems(tree: DiskEntry, count: number): DiskEntry[] {
  const items: DiskEntry[] = []

  function collect(entry: DiskEntry): void {
    if (entry.children) {
      for (const child of entry.children) {
        items.push(child)
        if (child.isDirectory && child.children)
          collect(child)
      }
    }
  }

  collect(tree)
  items.sort((a, b) => b.sizeBytes - a.sizeBytes)
  return items.slice(0, count)
}

/**
 * Flatten a tree into a list of all entries
 */
export function flattenTree(tree: DiskEntry): DiskEntry[] {
  const result: DiskEntry[] = []

  function walk(entry: DiskEntry): void {
    result.push(entry)
    if (entry.children) {
      for (const child of entry.children)
        walk(child)
    }
  }

  walk(tree)
  return result
}

/**
 * Fast synchronous directory size using `du`.
 * Falls back to manual walk if `du` fails.
 */
function getDirSizeSync(dirPath: string): number {
  try {
    const { execSync: nodeExecSync } = require('node:child_process') as typeof import('node:child_process')
    const safePath = dirPath.replace(/'/g, "'\\''")
    const out = nodeExecSync(`du -sk '${safePath}' 2>/dev/null | cut -f1`, {
      encoding: 'utf8',
      timeout: 5_000,
    }).trim()
    return (Number.parseInt(out) || 0) * 1024
  }
  catch {
    // Fallback: stat-based estimate (samples up to 500 entries)
    try {
      let total = 0
      const entries = fs.readdirSync(dirPath, { withFileTypes: true })
      for (const entry of entries.slice(0, 500)) {
        try {
          const stat = fs.statSync(path.join(dirPath, entry.name))
          total += stat.size
        }
        catch { /* skip */ }
      }
      return total
    }
    catch {
      return 4096
    }
  }
}
