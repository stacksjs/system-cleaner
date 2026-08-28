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
  const check = validateTrashPath(targetPath)
  if (!check.ok)
    return { success: false, error: check.error }

  const { absPath } = check

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
 * Largest number of paths handed to a single AppleScript call.
 *
 * The whole list is interpolated into one program string, so the cap keeps
 * that program well short of the length at which `osascript` starts to
 * struggle, while still turning a 500-file selection into three round trips
 * instead of five hundred.
 */
const TRASH_BATCH_SIZE = 100

/**
 * Validate a single path for deletion. Shared by the one-at-a-time and
 * batched paths so both reject exactly the same inputs.
 */
function validateTrashPath(targetPath: string): { ok: true, absPath: string } | { ok: false, error: string } {
  if (typeof targetPath !== 'string' || targetPath.length === 0)
    return { ok: false, error: 'Invalid path' }
  if (targetPath.includes('\0') || /(?:^|[\\/])\.\.(?:$|[\\/])/.test(targetPath))
    return { ok: false, error: 'Path traversal detected' }

  const absPath = path.resolve(targetPath)
  if (!absPath || absPath === '/')
    return { ok: false, error: 'Invalid path' }

  return { ok: true, absPath }
}

/**
 * Move many paths to Trash in as few Finder round trips as possible.
 *
 * `moveMultipleToTrash` issues one `osascript` per path, which is fine for a
 * handful and painful for the several hundred a bulk selection produces —
 * each spawn costs more than the deletion itself. This batches them into one
 * AppleScript per {@link TRASH_BATCH_SIZE} paths.
 *
 * A batch that fails is retried one path at a time, so a single undeletable
 * file (locked, permission-denied, already gone) costs its own error rather
 * than taking the other ninety-nine down with it.
 */
// eslint-disable-next-line pickier/no-unused-vars
export async function moveManyToTrash(
  paths: string[],
  options: MoveToTrashOptions = {},
): Promise<{
  succeeded: string[]
  failed: { path: string, error: string }[]
}> {
  const succeeded: string[] = []
  const failed: { path: string, error: string }[] = []

  // Deeper paths first, so a child is gone before its parent is considered.
  const sorted = [...paths].sort((a, b) => b.split('/').length - a.split('/').length)

  const valid: string[] = []
  for (const p of sorted) {
    const check = validateTrashPath(p)
    if (check.ok)
      valid.push(p)
    else
      failed.push({ path: p, error: check.error })
  }

  for (let i = 0; i < valid.length; i += TRASH_BATCH_SIZE) {
    const batch = valid.slice(i, i + TRASH_BATCH_SIZE)
    const list = batch
      .map(p => `POSIX file "${appleScriptEscape(path.resolve(p))}"`)
      .join(', ')
    const script = `tell application "Finder" to delete {${list}}`

    const result = await exec(`osascript -e ${shellSafe(script)}`, { timeout: 120_000 })

    if (result.ok) {
      succeeded.push(...batch)
      continue
    }

    // A batch can fail *after* Finder has already moved some of the items —
    // an Automation consent prompt, for instance, errors the script while the
    // deletions before it stand. Retrying those would ask Finder to trash a
    // path that no longer exists, so the failure is reported against a file
    // that is in fact gone, and its bytes go uncounted. Check the disk first:
    // whatever is no longer there succeeded.
    const remaining: string[] = []
    for (const p of batch) {
      if (fs.existsSync(path.resolve(p)))
        remaining.push(p)
      else
        succeeded.push(p)
    }

    // Fall back to individual deletes so one bad path does not fail the batch.
    for (const p of remaining) {
      const single = await moveToTrash(p, options)
      if (single.success)
        succeeded.push(p)
      else
        failed.push({ path: p, error: single.error || 'Unknown error' })
    }
  }

  return { succeeded, failed }
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
