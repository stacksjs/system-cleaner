import * as fs from 'node:fs'
import * as os from 'node:os'
import { exec, formatBytes, getDirSize, isPathSafe } from '@system-cleaner/core'
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

  const uid = os.userInfo().uid

  const result = await exec(`ps -p ${pid} -o uid=`, { timeout: 3000 })
  if (!result.ok)
    return { success: false, error: 'Process not found' }

  if (Number.parseInt(result.stdout.trim()) !== uid)
    return { success: false, error: 'Can only kill your own processes' }

  try {
    process.kill(pid, 'SIGTERM')
    return { success: true }
  }
  catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
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
