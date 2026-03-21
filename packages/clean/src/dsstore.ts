import * as fs from 'node:fs'
import * as path from 'node:path'
import { HOME, exec, shellEscape } from '@system-cleaner/core'

/**
 * Find and count .DS_Store files in the home directory (up to 5 levels deep).
 * Matches Mole's clean_ds_store_tree with the same exclusion patterns.
 */
export async function findDsStoreFiles(): Promise<{ paths: string[], count: number }> {
  const result = await exec(
    `find ${shellEscape(HOME)} -maxdepth 5 `
    + `-path "*/Library/Application Support/MobileSync" -prune -o `
    + `-path "*/Library/Developer" -prune -o `
    + `-path "*/.Trash" -prune -o `
    + `-path "*/node_modules" -prune -o `
    + `-path "*/.git" -prune -o `
    + `-path "*/Library/Caches" -prune -o `
    + `-type f -name ".DS_Store" -print 2>/dev/null`,
    { timeout: 30_000 },
  )

  if (!result.ok)
    return { paths: [], count: 0 }

  const paths = result.stdout.split('\n').filter(Boolean)
  return { paths, count: paths.length }
}

/**
 * Remove all .DS_Store files found in the home directory.
 */
export async function cleanDsStoreFiles(): Promise<{ removed: number, errors: number }> {
  const { paths } = await findDsStoreFiles()
  let removed = 0
  let errors = 0

  for (const p of paths) {
    try {
      fs.unlinkSync(p)
      removed++
    }
    catch {
      errors++
    }
  }

  return { removed, errors }
}

/**
 * Find and remove incomplete downloads (.download, .crdownload, .part).
 * Checks lsof to skip actively downloading files (matching Mole's safety).
 */
export async function findIncompleteDownloads(): Promise<{ path: string, name: string, sizeBytes: number }[]> {
  const downloadsDir = path.join(HOME, 'Downloads')
  const result = await exec(
    `find ${shellEscape(downloadsDir)} -maxdepth 1 -type f \\( -name "*.download" -o -name "*.crdownload" -o -name "*.part" \\) 2>/dev/null`,
    { timeout: 5000 },
  )

  if (!result.ok || !result.stdout)
    return []

  const files: { path: string, name: string, sizeBytes: number }[] = []

  for (const filePath of result.stdout.split('\n').filter(Boolean)) {
    // Check if file is currently open (active download)
    const lsofResult = await exec(`lsof -F n -- ${shellEscape(filePath)} 2>/dev/null`, { timeout: 2000 })
    if (lsofResult.ok && lsofResult.stdout)
      continue // Skip active downloads

    try {
      const stat = fs.statSync(filePath)
      files.push({
        path: filePath,
        name: path.basename(filePath),
        sizeBytes: stat.size,
      })
    }
    catch { /* skip */ }
  }

  return files
}

/**
 * Remove incomplete downloads.
 */
export async function cleanIncompleteDownloads(): Promise<{ removed: number, freedBytes: number }> {
  const files = await findIncompleteDownloads()
  let removed = 0
  let freedBytes = 0

  for (const file of files) {
    try {
      fs.unlinkSync(file.path)
      removed++
      freedBytes += file.sizeBytes
    }
    catch { /* skip */ }
  }

  return { removed, freedBytes }
}
