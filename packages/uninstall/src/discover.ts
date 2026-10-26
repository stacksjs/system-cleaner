import * as path from 'node:path'
import { HOME, appleScriptEscape, pathExists, safeReadDir, safeStat, parsePlist, exec, isWindows, shellEscape } from '@system-cleaner/core'
import { readBundleInfo } from './bundle'
import { discoverWindowsPrograms, toAppInfo } from './apps-windows'
import { discoverWindowsStartup, toggleWindowsStartupItem } from './startup-windows'
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
  if (isWindows) {
    // A Windows program is a registry entry, not a directory, and there are no
    // `.app` bundles to walk. `includeSystemApps` has no counterpart either:
    // what Windows considers its own is marked `SystemComponent` and dropped
    // during discovery rather than filtered here.
    const programs = await discoverWindowsPrograms()
    return programs.map(toAppInfo)
  }

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

/**
 * `icon` is an Iconify Framework7 class, not an emoji. The UI renders this
 * value straight into a `class` attribute, so emoji here shipped literal
 * glyphs into the startup list and broke the app's single-collection,
 * single-tint iconography.
 */
const VENDOR_MAP: Record<string, { vendor: string, category: StartupItem['category'], icon: string }> = {
  'com.apple': { vendor: 'Apple', category: 'system', icon: 'i-f7-logo-apple' },
  'com.microsoft': { vendor: 'Microsoft', category: 'vendor', icon: 'i-f7-logo-windows' },
  google: { vendor: 'Google', category: 'vendor', icon: 'i-f7-logo-google' },
  adobe: { vendor: 'Adobe', category: 'vendor', icon: 'i-f7-paintbrush-fill' },
  spotify: { vendor: 'Spotify', category: 'vendor', icon: 'i-f7-music-note-2' },
  dropbox: { vendor: 'Dropbox', category: 'vendor', icon: 'i-f7-cube-box-fill' },
  docker: { vendor: 'Docker', category: 'dev', icon: 'i-f7-cube-fill' },
  homebrew: { vendor: 'Homebrew', category: 'dev', icon: 'i-f7-wrench-fill' },
  slack: { vendor: 'Slack', category: 'vendor', icon: 'i-f7-number' },
  zoom: { vendor: 'Zoom', category: 'vendor', icon: 'i-f7-videocam-fill' },
  '1password': { vendor: '1Password', category: 'vendor', icon: 'i-f7-lock-fill' },
  raycast: { vendor: 'Raycast', category: 'vendor', icon: 'i-f7-bolt-fill' },
  steam: { vendor: 'Steam', category: 'vendor', icon: 'i-f7-gamecontroller-fill' },
  jetbrains: { vendor: 'JetBrains', category: 'dev', icon: 'i-f7-chevron-left-slash-chevron-right' },
  github: { vendor: 'GitHub', category: 'dev', icon: 'i-f7-logo-github' },
  figma: { vendor: 'Figma', category: 'vendor', icon: 'i-f7-paintbrush-fill' },
  linear: { vendor: 'Linear', category: 'vendor', icon: 'i-f7-list-bullet' },
  notion: { vendor: 'Notion', category: 'vendor', icon: 'i-f7-doc-text-fill' },
}

function categorizeAgent(label: string): { vendor: string, category: StartupItem['category'], icon: string } {
  const lower = label.toLowerCase()
  // Check longer keys first to avoid false positives (e.g., "com.apple" before "apple")
  for (const [key, value] of Object.entries(VENDOR_MAP).sort((a, b) => b[0].length - a[0].length)) {
    if (lower.includes(key))
      return value
  }
  return { vendor: 'Third-party', category: 'other', icon: 'i-f7-gear-alt-fill' }
}

/**
 * Discover all startup items (launch agents and daemons)
 */
/**
 * Everything that starts at login.
 *
 * Asynchronous because Windows keeps half of this in the registry, and reading
 * it means spawning `reg.exe`. The macOS path below awaits nothing — it reads
 * plists off disk exactly as before — but a function that blocks the agent on
 * one platform and not the other is the kind of difference that only shows up
 * as a frozen UI on the platform nobody is testing on.
 */
/**
 * Does this entry point at a binary that is no longer there?
 *
 * Only an absolute path can be answered. A relative one is resolved through
 * launchd's `PATH` and a missing `Program` may still run via `BundleProgram`
 * or on demand through `MachServices`, so both return `false` — the field
 * means "known dead", and a maybe has to read as alive or a sweep that
 * trusts it would remove working agents.
 *
 * `pathExists` is `access(F_OK)`, which also fails when a parent directory
 * cannot be traversed. Every launchd target on a Mac lives somewhere
 * world-readable (`/usr/libexec`, `/Library`, `/opt`, `/Applications`), and a
 * run across all 33 agents and daemons on the development machine flagged
 * four — three Homebrew PHP daemons for uninstalled formulae and a Google
 * updater whose bundle was gone — and no Apple entry at all.
 */
export function isTargetMissing(program: string): boolean {
  if (!program || !path.isAbsolute(program))
    return false
  return !pathExists(program)
}

export async function discoverStartupItems(): Promise<StartupItem[]> {
  if (isWindows)
    return discoverWindowsStartup()

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
        targetMissing: isTargetMissing(info.program),
      })
    }
  }

  // Dead entries lead. They are the only rows on this screen that can be
  // removed without knowing what they do, so burying them alphabetically
  // among thirty live agents hides the one safe action the list offers.
  items.sort((a, b) => {
    if (a.targetMissing !== b.targetMissing)
      return a.targetMissing ? -1 : 1
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
  if (isWindows)
    return toggleWindowsStartupItem(filepath, action)

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

/**
 * Remove several launch agents/daemons, with one password prompt for the lot.
 *
 * Calling `removeStartupItem` in a loop is correct but unusable: every
 * system-scope entry spawns its own `with administrator privileges`, so
 * clearing the three stale Homebrew PHP daemons on a machine means typing a
 * password three times. The system entries are therefore unloaded and deleted
 * by a single `osascript`, which either authorizes once or is cancelled once.
 *
 * The trade is granularity. A batch that is cancelled or fails reports the
 * same error against every system path in it, because one shell invocation
 * cannot say which of its statements was the one that broke. User agents are
 * still handled individually — they need no prompt, so there is nothing to
 * save by grouping them and a per-item result is strictly better.
 */
export async function removeStartupItems(
  filepaths: string[],
): Promise<{ succeeded: string[], failed: { filepath: string, error: string }[] }> {
  const succeeded: string[] = []
  const failed: { filepath: string, error: string }[] = []

  const systemPaths: string[] = []

  for (const filepath of filepaths) {
    const resolved = validateLaunchAgentPath(filepath)
    if (resolved === null) {
      failed.push({ filepath, error: 'Invalid launch agent path' })
      continue
    }

    if (resolved.startsWith(path.join(HOME, 'Library/LaunchAgents'))) {
      const result = await removeStartupItem(resolved)
      if (result.success)
        succeeded.push(resolved)
      else
        failed.push({ filepath: resolved, error: result.error || 'Operation failed' })
      continue
    }

    systemPaths.push(resolved)
  }

  if (systemPaths.length > 0) {
    if (isWindows) {
      // No launchd and no osascript. Nothing reaches here today, because
      // Windows startup entries are registry keys and shortcuts rather than
      // plists, and `validateLaunchAgentPath` rejects every one of them.
      for (const filepath of systemPaths)
        failed.push({ filepath, error: 'Not supported on Windows' })
    }
    else {
      const cmd = systemPaths
        .map((p) => {
          const quoted = shellEscape(p)
          return `launchctl unload -w ${quoted} 2>/dev/null; rm -f ${quoted}`
        })
        .join('; ')

      try {
        const innerForAS = appleScriptEscape(cmd)
        await exec(`osascript -e 'do shell script "${innerForAS}" with administrator privileges'`, { timeout: 60000 })
        succeeded.push(...systemPaths)
      }
      catch (e: any) {
        const { error } = formatOsaError(e)
        for (const filepath of systemPaths)
          failed.push({ filepath, error })
      }
    }
  }

  return { succeeded, failed }
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
