import * as fs from 'node:fs'
import * as path from 'node:path'
import { exec } from '@system-cleaner/core'

/**
 * Move a path to Trash via Finder AppleScript (recoverable deletion).
 * Matches Mole's delete.go approach — safer than rm -rf.
 * Path validation: rejects empty, root, relative, null-byte, and traversal paths.
 */
// eslint-disable-next-line pickier/no-unused-vars
export async function moveToTrash(targetPath: string): Promise<{ success: boolean, error?: string }> {
  const absPath = path.resolve(targetPath)

  // Defense-in-depth validation (matching Mole's delete.go checks)
  if (!absPath || absPath === '/' || absPath.includes('\0')) {
    return { success: false, error: 'Invalid path' }
  }
  // Check for traversal AFTER resolving (path.resolve normalizes .. away,
  // so if it's still present the input was adversarial)
  if (targetPath.includes('\0') || /(?:^|[\\/])\.\.(?:$|[\\/])/.test(targetPath)) {
    return { success: false, error: 'Path traversal detected' }
  }

  // Escape for AppleScript: backslashes then double-quotes
  const escaped = absPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const script = `tell application "Finder" to delete POSIX file "${escaped}"`

  const result = await exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 30_000 })

  if (result.ok) {
    return { success: true }
  }

  // Fallback: direct rm for headless/SSH environments where Finder is unavailable
  try {
    fs.rmSync(absPath, { recursive: true, force: true })
    return { success: true }
  }
  catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to delete' }
  }
}

/**
 * Move multiple paths to Trash, processing deeper paths first
 * to avoid parent/child conflicts.
 */
export async function moveMultipleToTrash(paths: string[]): Promise<{
  succeeded: string[]
  failed: { path: string, error: string }[]
}> {
  // Sort deeper paths first
  const sorted = [...paths].sort((a, b) => b.split('/').length - a.split('/').length)

  const succeeded: string[] = []
  const failed: { path: string, error: string }[] = []

  for (const p of sorted) {
    const result = await moveToTrash(p)
    if (result.success) {
      succeeded.push(p)
    }
    else {
      failed.push({ path: p, error: result.error || 'Unknown error' })
    }
  }

  return { succeeded, failed }
}
