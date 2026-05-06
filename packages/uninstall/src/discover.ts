import * as path from 'node:path'
import { HOME, appleScriptEscape, getDirSize, macPaths, pathExists, safeReadDir, safeStat, parsePlist, exec, shellEscape } from '@system-cleaner/core'
import { readBundleInfo } from './bundle'
import type { AppInfo, StartupItem } from './types'

const APP_SEARCH_DIRS = [
  '/Applications',
  '/Applications/Utilities',
  path.join(HOME, 'Applications'),
]

const SYSTEM_APP_PATTERNS = [
  /^com\.apple\./,
  /^com\.google\.keystone/,
]

/**
 * Discover all installed applications
 */
export async function discoverApps(includeSystemApps = false): Promise<AppInfo[]> {
  const apps: AppInfo[] = []
  const seen = new Set<string>()

  for (const searchDir of APP_SEARCH_DIRS) {
    if (!pathExists(searchDir))
      continue

    for (const entry of safeReadDir(searchDir)) {
      if (!entry.endsWith('.app'))
        continue

      const appPath = path.join(searchDir, entry)
      if (seen.has(appPath))
        continue
      seen.add(appPath)

      const info = await getAppInfo(appPath)
      if (!info)
        continue

      if (!includeSystemApps && info.isSystemApp)
        continue

      apps.push(info)
    }
  }

  return apps.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Get detailed info about a specific app
 */
export async function getAppInfo(appPath: string): Promise<AppInfo | null> {
  const stat = safeStat(appPath)
  if (!stat || !stat.isDirectory())
    return null

  const bundle = readBundleInfo(appPath)
  const name = bundle.name || path.basename(appPath, '.app')
  const bundleId = bundle.bundleId || ''
  const isSystem = SYSTEM_APP_PATTERNS.some(p => p.test(bundleId))
    || appPath.startsWith('/System/')
    || (appPath.startsWith('/Applications/Utilities/') && bundleId.startsWith('com.apple.'))

  // Skip expensive du call during discovery — size calculated on demand
  return {
    name,
    bundleId,
    version: bundle.version || '',
    path: appPath,
    iconPath: bundle.iconPath || '',
    sizeBytes: 0,
    installDate: stat.birthtime || null,
    isSystemApp: isSystem,
  }
}

/**
 * Search for apps matching a name query
 */
export async function searchApps(query: string, includeSystemApps = false): Promise<AppInfo[]> {
  const all = await discoverApps(includeSystemApps)
  const lowerQuery = query.toLowerCase()
  return all.filter(app =>
    app.name.toLowerCase().includes(lowerQuery)
    || app.bundleId.toLowerCase().includes(lowerQuery),
  )
}

// ── Startup Items ────────────────────────────────────────────

const AGENT_DIRS = [
  { path: path.join(HOME, 'Library/LaunchAgents'), scope: 'user' as const, type: 'agent' as const },
  { path: '/Library/LaunchAgents', scope: 'system' as const, type: 'agent' as const },
  { path: '/Library/LaunchDaemons', scope: 'system' as const, type: 'daemon' as const },
]

const VENDOR_MAP: Record<string, { vendor: string, category: StartupItem['category'], icon: string }> = {
  'com.apple': { vendor: 'Apple', category: 'system', icon: '' },
  'com.microsoft': { vendor: 'Microsoft', category: 'vendor', icon: '🪟' },
  google: { vendor: 'Google', category: 'vendor', icon: '🔍' },
  adobe: { vendor: 'Adobe', category: 'vendor', icon: '🎨' },
  spotify: { vendor: 'Spotify', category: 'vendor', icon: '🎵' },
  dropbox: { vendor: 'Dropbox', category: 'vendor', icon: '📦' },
  docker: { vendor: 'Docker', category: 'dev', icon: '🐳' },
  homebrew: { vendor: 'Homebrew', category: 'dev', icon: '🍺' },
  slack: { vendor: 'Slack', category: 'vendor', icon: '💬' },
  zoom: { vendor: 'Zoom', category: 'vendor', icon: '📹' },
  '1password': { vendor: '1Password', category: 'vendor', icon: '🔐' },
  raycast: { vendor: 'Raycast', category: 'vendor', icon: '🚀' },
  steam: { vendor: 'Steam', category: 'vendor', icon: '🎮' },
  jetbrains: { vendor: 'JetBrains', category: 'dev', icon: '🧠' },
  github: { vendor: 'GitHub', category: 'dev', icon: '🐙' },
  figma: { vendor: 'Figma', category: 'vendor', icon: '🎨' },
  linear: { vendor: 'Linear', category: 'vendor', icon: '📋' },
  notion: { vendor: 'Notion', category: 'vendor', icon: '📝' },
}

function categorizeAgent(label: string): { vendor: string, category: StartupItem['category'], icon: string } {
  const lower = label.toLowerCase()
  // Check longer keys first to avoid false positives (e.g., "com.apple" before "apple")
  for (const [key, value] of Object.entries(VENDOR_MAP).sort((a, b) => b[0].length - a[0].length)) {
    if (lower.includes(key))
      return value
  }
  return { vendor: 'Third-party', category: 'other', icon: '⚙️' }
}

/**
 * Discover all startup items (launch agents and daemons)
 */
export function discoverStartupItems(): StartupItem[] {
  const items: StartupItem[] = []

  for (const dir of AGENT_DIRS) {
    const files = safeReadDir(dir.path).filter(f => f.endsWith('.plist'))
    for (const file of files) {
      const filepath = path.join(dir.path, file)
      const info = parsePlist(filepath)
      const cat = categorizeAgent(info.label)
      items.push({
        id: `startup-${items.length}`,
        name: info.label,
        label: info.label,
        vendor: cat.vendor,
        icon: cat.icon,
        category: cat.category,
        scope: dir.scope,
        type: dir.type,
        runAtLoad: info.runAtLoad,
        keepAlive: info.keepAlive,
        disabled: info.disabled,
        filepath,
        program: info.program,
      })
    }
  }

  items.sort((a, b) => {
    if (a.disabled !== b.disabled)
      return a.disabled ? 1 : -1
    return a.name.localeCompare(b.name)
  })

  return items
}

/**
 * Validate that a launch-agent / launch-daemon path is in one of the
 * official locations and that traversal sequences (`..`) can't smuggle the
 * filename out. Returns the resolved absolute path or `null`.
 */
function validateLaunchAgentPath(filepath: string): string | null {
  if (!filepath || !path.isAbsolute(filepath)) return null
  const resolved = path.resolve(filepath)
  const userAgentsDir = path.join(HOME, 'Library/LaunchAgents')
  const inUser = resolved === userAgentsDir || resolved.startsWith(`${userAgentsDir}/`)
  const inSystem = resolved.startsWith('/Library/LaunchAgents/') || resolved.startsWith('/Library/LaunchDaemons/')
  if (!inUser && !inSystem) return null
  return resolved
}

/**
 * Toggle a launch agent on or off.
 *
 * For system agents we go through `osascript -e 'do shell script "..."'`
 * to get a sudo prompt. The shell command is *itself* embedded in an
 * AppleScript double-quoted string — historically the filepath was only
 * shell-escaped (single-quoted), so a path containing `"` (which the
 * `startsWith('/Library/LaunchAgents/')` check did not block) would
 * close the AppleScript literal and inject extra script. We now apply
 * BOTH shell-quoting (for the inner sh) and AppleScript-escaping (for
 * the outer "..."), and validate the resolved path so traversal
 * sequences can't reach non-LaunchAgents files.
 */
export async function toggleStartupItem(filepath: string, action: 'enable' | 'disable'): Promise<{ success: boolean, error?: string }> {
  const resolved = validateLaunchAgentPath(filepath)
  if (resolved === null) return { success: false, error: 'Invalid launch agent path' }
  const isUserAgent = resolved.startsWith(path.join(HOME, 'Library/LaunchAgents'))

  const shellQuoted = shellEscape(resolved)
  const launchctlCmd = action === 'disable'
    ? `launchctl unload -w ${shellQuoted}`
    : `launchctl load -w ${shellQuoted}`

  try {
    if (isUserAgent) {
      await exec(`${launchctlCmd} 2>/dev/null`, { timeout: 5000 })
    }
    else {
      const innerForAS = appleScriptEscape(launchctlCmd)
      const osaCmd = `osascript -e 'do shell script "${innerForAS}" with administrator privileges'`
      await exec(osaCmd, { timeout: 30000 })
    }
    return { success: true }
  }
  catch (e: any) {
    return formatOsaError(e)
  }
}

/**
 * Remove a launch agent/daemon permanently.
 * Same dual-escaping defense as `toggleStartupItem`.
 */
export async function removeStartupItem(filepath: string): Promise<{ success: boolean, error?: string }> {
  const resolved = validateLaunchAgentPath(filepath)
  if (resolved === null) return { success: false, error: 'Invalid launch agent path' }
  const isUserAgent = resolved.startsWith(path.join(HOME, 'Library/LaunchAgents'))

  const shellQuoted = shellEscape(resolved)

  try {
    if (isUserAgent) {
      await exec(`launchctl unload -w ${shellQuoted} 2>/dev/null`, { timeout: 5000 }).catch(() => {})
      const fs = await import('node:fs')
      fs.unlinkSync(resolved)
    }
    else {
      const cmd = `launchctl unload -w ${shellQuoted} 2>/dev/null; rm -f ${shellQuoted}`
      const innerForAS = appleScriptEscape(cmd)
      const osaCmd = `osascript -e 'do shell script "${innerForAS}" with administrator privileges'`
      await exec(osaCmd, { timeout: 30000 })
    }
    return { success: true }
  }
  catch (e: any) {
    return formatOsaError(e)
  }
}

function formatOsaError(e: any): { success: false, error: string } {
  const msg = e.message || String(e)
  if (msg.includes('User canceled') || msg.includes('-128')) {
    return { success: false, error: 'Cancelled' }
  }
  if (msg.includes('authorization')) {
    return { success: false, error: 'Authorization failed' }
  }
  return { success: false, error: msg.slice(0, 100) || 'Operation failed' }
}
