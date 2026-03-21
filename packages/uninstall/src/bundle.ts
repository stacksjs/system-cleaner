import * as fs from 'node:fs'
import * as path from 'node:path'
import { readAppInfoPlist, pathExists, execSync, shellEscape } from '@system-cleaner/core'

export interface BundleInfo {
  name: string
  bundleId: string
  version: string
  shortVersion: string
  iconPath: string
  executable: string
  minimumSystemVersion: string
  category: string
}

/**
 * Read bundle info from an .app package
 */
export function readBundleInfo(appPath: string): BundleInfo {
  const info = readAppInfoPlist(appPath)

  const name = (info.CFBundleName as string)
    || (info.CFBundleDisplayName as string)
    || path.basename(appPath, '.app')

  const bundleId = (info.CFBundleIdentifier as string) || ''
  const version = (info.CFBundleVersion as string) || ''
  const shortVersion = (info.CFBundleShortVersionString as string) || version
  const executable = (info.CFBundleExecutable as string) || ''
  const minimumSystemVersion = (info.LSMinimumSystemVersion as string) || ''
  const category = (info.LSApplicationCategoryType as string) || ''

  // Find icon path
  let iconPath = ''
  const iconFile = (info.CFBundleIconFile as string) || ''
  if (iconFile) {
    const icnsName = iconFile.endsWith('.icns') ? iconFile : `${iconFile}.icns`
    const icnsPath = path.join(appPath, 'Contents/Resources', icnsName)
    if (pathExists(icnsPath))
      iconPath = icnsPath
  }

  return {
    name,
    bundleId,
    version,
    shortVersion,
    iconPath,
    executable,
    minimumSystemVersion,
    category,
  }
}

/**
 * Extract the bundle identifier from an app path
 */
export function getBundleId(appPath: string): string {
  return readBundleInfo(appPath).bundleId
}

/**
 * Check if an app is installed via Homebrew Cask
 */
export function isHomebrewCask(appPath: string): boolean {
  try {
    const realPath = fs.realpathSync(appPath)
    return realPath.includes('/Cellar/') || realPath.includes('/Caskroom/')
  }
  catch {
    return false
  }
}

/**
 * Get the Homebrew cask name for an app, if applicable.
 * Uses shellEscape to prevent command injection from app names.
 */
export function getHomebrewCaskName(appName: string): string | null {
  const safeName = appName.replace('.app', '').replace(/[^a-zA-Z0-9 \-_.]/g, '')
  const output = execSync(`brew list --cask 2>/dev/null | grep -i ${shellEscape(safeName)}`)
  return output || null
}
