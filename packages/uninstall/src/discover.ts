import * as path from 'node:path'
import { HOME, getDirSize, macPaths, pathExists, safeReadDir, safeStat } from '@system-cleaner/core'
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

  const sizeBytes = await getDirSize(appPath)

  return {
    name,
    bundleId,
    version: bundle.version || '',
    path: appPath,
    iconPath: bundle.iconPath || '',
    sizeBytes,
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
  apple: { vendor: 'Apple', category: 'system', icon: '' },
  'com.apple': { vendor: 'Apple', category: 'system', icon: '' },
  google: { vendor: 'Google', category: 'vendor', icon: '🔍' },
  microsoft: { vendor: 'Microsoft', category: 'vendor', icon: '🪟' },
  'com.microsoft': { vendor: 'Microsoft', category: 'vendor', icon: '🪟' },
  adobe: { vendor: 'Adobe', category: 'vendor', icon: '🎨' },
  spotify: { vendor: 'Spotify', category: 'vendor', icon: '🎵' },
  dropbox: { vendor: 'Dropbox', category: 'vendor', icon: '📦' },
  docker: { vendor: 'Docker', category: 'dev', icon: '🐳' },
  homebrew: { vendor: 'Homebrew', category: 'dev', icon: '🍺' },
  brew: { vendor: 'Homebrew', category: 'dev', icon: '🍺' },
  slack: { vendor: 'Slack', category: 'vendor', icon: '💬' },
  zoom: { vendor: 'Zoom', category: 'vendor', icon: '📹' },
  '1password': { vendor: '1Password', category: 'vendor', icon: '🔐' },
  onepassword: { vendor: '1Password', category: 'vendor', icon: '🔐' },
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
  for (const [key, value] of Object.entries(VENDOR_MAP)) {
    if (lower.includes(key))
      return value
  }
  return { vendor: 'Third-party', category: 'other', icon: '⚙️' }
}

/**
 * Discover all startup items (launch agents and daemons)
 */
export function discoverStartupItems(): StartupItem[] {
  const { parsePlist } = require('@system-cleaner/core')
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

  // Sort: enabled first, then alphabetical
  items.sort((a, b) => {
    if (a.disabled !== b.disabled)
      return a.disabled ? 1 : -1
    return a.name.localeCompare(b.name)
  })

  return items
}

/**
 * Toggle a launch agent on or off
 */
export async function toggleStartupItem(filepath: string, action: 'enable' | 'disable'): Promise<{ success: boolean, error?: string }> {
  const { exec } = require('@system-cleaner/core')

  // Safety: only allow toggling user launch agents
  if (!filepath.startsWith(path.join(HOME, 'Library/LaunchAgents'))) {
    return { success: false, error: 'Can only toggle user launch agents' }
  }

  const cmd = action === 'disable'
    ? `launchctl unload -w "${filepath}" 2>/dev/null`
    : `launchctl load -w "${filepath}" 2>/dev/null`

  // launchctl often exits non-zero even on success
  await exec(cmd, { timeout: 5000 })
  return { success: true }
}
