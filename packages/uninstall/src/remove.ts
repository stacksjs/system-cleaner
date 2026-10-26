import * as fs from 'node:fs'
import * as os from 'node:os'
import { exec, formatBytes, getDirSize, isPathSafe, isWindows } from '@system-cleaner/core'
import { parseTasklist } from '@system-cleaner/monitor'
import type { AppInfo, AppRemnant, UninstallOptions, UninstallResult } from './types'
import { findRemnants } from './remnants'

/**
 * Fully uninstall an application and all its remnants
 */
export async function uninstallApp(app: AppInfo, options: UninstallOptions = {}): Promise<UninstallResult> {
  const result: UninstallResult = {
    app,
    removedPaths: [],
    errors: [],
    totalFreed: 0,
    totalFreedFormatted: '0 B',
    success: false,
  }

  options.onProgress?.('Scanning for remnants...')
  const remnants = options.deep !== false ? await findRemnants(app) : []

  // Build removal list: deeper paths first to avoid parent/child conflicts
  const removalPaths = [app.path, ...remnants.map(r => r.path)]
    .sort((a, b) => b.split('/').length - a.split('/').length)

  for (const targetPath of removalPaths) {
    const safety = isPathSafe(targetPath)
    if (!safety.safe) {
      result.errors.push(`Skipped ${targetPath}: ${safety.reason}`)
      continue
    }

    if (options.dryRun) {
      const size = await getSafeDirSize(targetPath)
      result.totalFreed += size
      result.removedPaths.push(targetPath)
      continue
    }

    try {
      options.onProgress?.(`Removing ${targetPath}`)
      const sizeBefore = await getSafeDirSize(targetPath)

      fs.rmSync(targetPath, { recursive: true, force: true })
      result.totalFreed += sizeBefore
      result.removedPaths.push(targetPath)
    }
    catch (err) {
      result.errors.push(`${targetPath}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  result.totalFreedFormatted = formatBytes(result.totalFreed)
  // Success only if all paths were removed without errors
  result.success = result.errors.length === 0
  return result
}

/**
 * Uninstall multiple apps in batch
 */
export async function uninstallApps(
  apps: AppInfo[],
  options: UninstallOptions = {},
): Promise<UninstallResult[]> {
  const results: UninstallResult[] = []

  for (const app of apps) {
    options.onProgress?.(`Uninstalling ${app.name}...`)
    const result = await uninstallApp(app, options)
    results.push(result)
  }

  return results
}

/**
 * Remove specific remnants only (without the app bundle)
 */
export async function removeRemnants(
  remnants: AppRemnant[],
  options: UninstallOptions = {},
): Promise<{ removed: string[], errors: string[], totalFreed: number }> {
  const removed: string[] = []
  const errors: string[] = []
  let totalFreed = 0

  const sorted = [...remnants].sort((a, b) => b.path.split('/').length - a.path.split('/').length)

  for (const remnant of sorted) {
    const safety = isPathSafe(remnant.path)
    if (!safety.safe) {
      errors.push(`Skipped ${remnant.path}: ${safety.reason}`)
      continue
    }

    if (options.dryRun) {
      removed.push(remnant.path)
      totalFreed += remnant.sizeBytes
      continue
    }

    try {
      fs.rmSync(remnant.path, { recursive: true, force: true })
      removed.push(remnant.path)
      totalFreed += remnant.sizeBytes
    }
    catch (err) {
      errors.push(`${remnant.path}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return { removed, errors, totalFreed }
}

/**
 * Kill a running process by PID (only user-owned processes).
 * PID is validated as a number — no injection possible.
 */
export async function killProcess(pid: number): Promise<{ success: boolean, error?: string }> {
  if (!Number.isInteger(pid) || pid <= 0)
    return { success: false, error: 'Invalid PID' }

  const owned = isWindows ? await ownedOnWindows(pid) : await ownedOnPosix(pid)
  if (!owned.ok)
    return { success: false, error: owned.error }

  try {
    // Node maps SIGTERM onto TerminateProcess on Windows, so the same call
    // works on both.
    process.kill(pid, 'SIGTERM')
    return { success: true }
  }
  catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Whether this pid belongs to the current user, by uid. */
async function ownedOnPosix(pid: number): Promise<{ ok: true } | { ok: false, error: string }> {
  const result = await exec(`ps -p ${pid} -o uid=`, { timeout: 3000 })
  if (!result.ok)
    return { ok: false, error: 'Process not found' }

  return Number.parseInt(result.stdout.trim()) === os.userInfo().uid
    ? { ok: true }
    : { ok: false, error: 'Can only kill your own processes' }
}

/**
 * The same ownership check, by account name.
 *
 * Windows has no uid to compare, so `tasklist` is asked for the one process
 * and its owner is matched against the current account. Without this the
 * check ran `ps`, which is not there — so every kill came back "Process not
 * found", including for a process plainly listed on the screen beside the
 * button.
 *
 * Spawned directly rather than through `exec`, which wraps everything in
 * `sh -c`.
 */
async function ownedOnWindows(pid: number): Promise<{ ok: true } | { ok: false, error: string }> {
  let stdout: string
  try {
    const proc = Bun.spawn(['tasklist.exe', '/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH', '/V'], {
      stdout: 'pipe',
      stderr: 'ignore',
    })
    const timer = setTimeout(() => proc.kill(), 5000)
    stdout = await new Response(proc.stdout).text()
    const code = await proc.exited
    clearTimeout(timer)
    if (code !== 0)
      return { ok: false, error: 'Could not read the process list' }
  }
  catch {
    return { ok: false, error: 'Could not read the process list' }
  }

  // A filter that matches nothing prints an INFO line rather than failing, so
  // an empty parse is the "no such process" signal.
  const row = parseTasklist(stdout).get(pid)
  if (!row)
    return { ok: false, error: 'Process not found' }

  // The domain prefix varies by machine and is localised, so only the account
  // name is compared.
  const owner = (row.user.split('\\').pop() || row.user).trim().toLowerCase()
  return owner === os.userInfo().username.trim().toLowerCase()
    ? { ok: true }
    : { ok: false, error: 'Can only kill your own processes' }
}

/** Get directory size with safe fallback to stat */
async function getSafeDirSize(targetPath: string): Promise<number> {
  try {
    return await getDirSize(targetPath)
  }
  catch {
    try {
      return fs.statSync(targetPath).size
    }
    catch {
      return 0
    }
  }
}
