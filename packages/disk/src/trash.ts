import * as fs from 'node:fs'
import * as path from 'node:path'
import { appleScriptEscape, exec } from '@system-cleaner/core'

export interface MoveToTrashOptions {
  /**
   * If true, fall back to a permanent `rm -rf` when AppleScript can't move
   * to Trash (e.g. headless / SSH sessions where Finder is unavailable).
   *
   * Default `false` — historically the function silently fell back to
   * permanent deletion any time osascript failed, violating the API's
   * "recoverable" contract. Now you must opt in explicitly.
   */
  permanent?: boolean
}

/**
 * Move a path to Trash via Finder AppleScript (recoverable deletion).
 * Path validation rejects empty, root, relative, null-byte, and traversal
 * paths.
 */
// eslint-disable-next-line pickier/no-unused-vars
export async function moveToTrash(
  targetPath: string,
  options: MoveToTrashOptions = {},
): Promise<{ success: boolean, error?: string, permanentlyDeleted?: boolean }> {
  if (typeof targetPath !== 'string' || targetPath.length === 0)
    return { success: false, error: 'Invalid path' }
  if (targetPath.includes('\0') || /(?:^|[\\/])\.\.(?:$|[\\/])/.test(targetPath))
    return { success: false, error: 'Path traversal detected' }

  const absPath = path.resolve(targetPath)
  if (!absPath || absPath === '/')
    return { success: false, error: 'Invalid path' }

  // AppleScript escape order matters: escape backslashes first, then
  // double quotes — otherwise an injected `\"` smuggles a quote through.
  const escapedAS = appleScriptEscape(absPath)
  const script = `tell application "Finder" to delete POSIX file "${escapedAS}"`

  const result = await exec(`osascript -e ${shellSafe(script)}`, { timeout: 30_000 })

  if (result.ok) {
    return { success: true }
  }

  if (!options.permanent) {
    return {
      success: false,
      error: `Could not move to Trash: ${result.stderr || 'osascript failed'}. `
        + 'Pass { permanent: true } to delete permanently.',
    }
  }

  try {
    fs.rmSync(absPath, { recursive: true, force: true })
    return { success: true, permanentlyDeleted: true }
  }
  catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to delete' }
  }
}

/**
 * Wrap a string in shell-safe single quotes (POSIX `'...'`). Used to pass
 * an AppleScript program as a single arg through `sh -c`. Embedded single
 * quotes are encoded as `'\''`.
 */
function shellSafe(s: string): string {
  return `'${s.replace(/'/g, '\'\\\'\'')}'`
}

/**
 * Move multiple paths to Trash, processing deeper paths first to avoid
 * parent/child conflicts.
 */
// eslint-disable-next-line pickier/no-unused-vars
export async function moveMultipleToTrash(
  paths: string[],
  options: MoveToTrashOptions = {},
): Promise<{
  succeeded: string[]
  failed: { path: string, error: string }[]
}> {
  const sorted = [...paths].sort((a, b) => b.split('/').length - a.split('/').length)

  const succeeded: string[] = []
  const failed: { path: string, error: string }[] = []

  for (const p of sorted) {
    const result = await moveToTrash(p, options)
    if (result.success) {
      succeeded.push(p)
    }
    else {
      failed.push({ path: p, error: result.error || 'Unknown error' })
    }
  }

  return { succeeded, failed }
}
