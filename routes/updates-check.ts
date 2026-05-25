import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  HOME,
  exec,
  checkSoftwareUpdates,
  isNewerVersion,
  listApplicationEntries,
  readAppVersion,
  stripAnsi,
  TtlCache,
  singleFlight,
} from '@system-cleaner/core'

export interface UpdatesCheckResult {
  success: true
  brewFormulae: Array<{ name: string; current: string; latest: string; pinned: boolean }>
  brewCasks: Array<{ name: string; current: string; latest: string }>
  pantryOutdated: Array<{ name: string; current: string; wanted: string; latest: string }>
  pantryPackages: string[]
  pantryTrackedCount: number
  desktopApps: Array<{
    name: string
    version: string
    latestVersion: string | null
    updateAvailable: boolean
    source: string
    caskToken: string | null
    autoUpdates: boolean
  }>
  desktopOutdated: UpdatesCheckResult['desktopApps']
  systemUpdates: import('@system-cleaner/core').SoftwareUpdate[]
  systemUpdateCount: number
  clToolsInfo: import('@system-cleaner/core').ClToolsInfo
  macosVersion: string | null
  updateScanCached: boolean
  updateScannedAt: string
  cached: boolean
}

export type UpdatesTier = 'quick' | 'full'

const responseCache = new TtlCache<UpdatesCheckResult>(5 * 60_000)
const quickTierCache = new TtlCache<UpdatesCheckResult>(5 * 60_000)
const fullScanCache = new TtlCache<UpdatesCheckResult>(15 * 60_000)
const brewOutdatedCache = new TtlCache<string>(5 * 60_000)
const brewCaskListCache = new TtlCache<string>(60 * 60_000)
const masAvailableCache = new TtlCache<boolean>(60 * 60_000)

const CASK_MAP: Record<string, string> = {
  '1Password': '1password', '1Password 7': '1password',
  'Alacritty': 'alacritty', 'Alfred': 'alfred',
  'Android Studio': 'android-studio', 'AppCleaner': 'appcleaner',
  'Arc': 'arc', 'Audacity': 'audacity',
  'BBEdit': 'bbedit', 'Bartender': 'bartender',
  'Bear': 'bear', 'BetterTouchTool': 'bettertouchtool',
  'Brave Browser': 'brave-browser',
  'CLion': 'clion', 'Caffeine': 'caffeine',
  'ChatGPT': 'chatgpt', 'Claude': 'claude',
  'CleanMyMac': 'cleanmymac', 'CleanMyMac X': 'cleanmymac',
  'CleanShot X': 'cleanshot', 'CotEditor': 'coteditor',
  'Cursor': 'cursor', 'Cyberduck': 'cyberduck',
  'Dash': 'dash', 'DataGrip': 'datagrip',
  'DaVinci Resolve': 'davinci-resolve',
  'Discord': 'discord', 'Docker': 'docker',
  'Dropbox': 'dropbox', 'Dynobase': 'dynobase',
  'Fantastical': 'fantastical', 'Figma': 'figma',
  'Firefox': 'firefox', 'Fork': 'fork', 'ForkLift': 'forklift',
  'Ghostty': 'ghostty', 'GitHub Desktop': 'github',
  'GitKraken': 'gitkraken', 'GoLand': 'goland',
  'Google Chrome': 'google-chrome', 'Google Drive': 'google-drive',
  'Grammarly Desktop': 'grammarly-desktop',
  'HTTPie': 'httpie', 'HandBrake': 'handbrake',
  'Hyper': 'hyper',
  'IINA': 'iina', 'ImageOptim': 'imageoptim',
  'IntelliJ IDEA': 'intellij-idea', 'Insomnia': 'insomnia',
  'Joplin': 'joplin',
  'Kap': 'kap', 'Karabiner-Elements': 'karabiner-elements',
  'Keka': 'keka', 'Kitty': 'kitty',
  'Linear': 'linear-linear', 'Logseq': 'logseq',
  'Logi Options+': 'logi-options-plus',
  'logioptionsplus': 'logi-options-plus',
  'Logi Options Plus': 'logi-options-plus',
  'Loom': 'loom',
  'Maccy': 'maccy', 'MediaInfo': 'mediainfo',
  'Microsoft Edge': 'microsoft-edge',
  'Microsoft Teams': 'microsoft-teams',
  'MonitorControl': 'monitorcontrol', 'Mullvad VPN': 'mullvad-vpn',
  'Muzzle': 'muzzle',
  'NordVPN': 'nordvpn', 'Notion': 'notion', 'Nova': 'nova',
  'Numi': 'numi',
  'OBS': 'obs', 'Obsidian': 'obsidian',
  'OneDrive': 'onedrive', 'Opera': 'opera',
  'OrbStack': 'orbstack', 'Orion': 'orion',
  'Parallels Desktop': 'parallels',
  'Pearcleaner': 'pearcleaner', 'PhpStorm': 'phpstorm',
  'Plex': 'plex', 'Postman': 'postman',
  'Proxyman': 'proxyman', 'PyCharm': 'pycharm',
  'Raycast': 'raycast', 'Rectangle': 'rectangle',
  'Rider': 'rider', 'RubyMine': 'rubymine',
  'Sequel Ace': 'sequel-ace',
  'Setapp': 'setapp', 'Shottr': 'shottr',
  'Signal': 'signal', 'Sketch': 'sketch',
  'Skype': 'skype', 'Slack': 'slack',
  'SourceTree': 'sourcetree', 'Spotify': 'spotify',
  'Steam': 'steam', 'Sublime Merge': 'sublime-merge',
  'Sublime Text': 'sublime-text',
  'TablePlus': 'tableplus', 'Tailscale': 'tailscale',
  'Telegram': 'telegram', 'The Unarchiver': 'the-unarchiver',
  'Things3': 'things', 'Things': 'things',
  'TickTick': 'ticktick', 'Tinkerwell': 'tinkerwell',
  'Todoist': 'todoist', 'Tower': 'tower',
  'Transmit': 'transmit', 'Typora': 'typora',
  'UTM': 'utm',
  'VLC': 'vlc', 'VMware Fusion': 'vmware-fusion',
  'Visual Studio Code': 'visual-studio-code',
  'Vivaldi': 'vivaldi',
  'Warp': 'warp', 'WebStorm': 'webstorm',
  'WhatsApp': 'whatsapp', 'WireGuard': 'wireguard-go',
  'Zed': 'zed', 'Zen Browser': 'zen-browser',
  'Zoom': 'zoom', 'iTerm': 'iterm2',
  'iStat Menus': 'istat-menus',
}

const SYSTEM_APPS = new Set([
  'Safari', 'Preview', 'TextEdit', 'Automator', 'Font Book',
  'Migration Assistant', 'Photo Booth', 'System Preferences',
  'System Settings', 'Disk Utility', 'Terminal', 'Activity Monitor',
  'Console', 'Grapher', 'Script Editor', 'Time Machine', 'Photos',
  'Mail', 'Calendar', 'Contacts', 'Reminders', 'Notes', 'Maps',
  'Messages', 'FaceTime', 'Books', 'News', 'Stocks', 'Weather',
  'Home', 'Podcasts', 'Music', 'TV', 'Voice Memos', 'Freeform',
  'Shortcuts', 'Chess', 'Dictionary', 'Stickies', 'Image Capture',
  'Color Picker', 'Simulator', 'Simulator (Watch)',
])

const MAS_APPS = new Set([
  'Xcode', 'Numbers', 'Pages', 'Keynote', 'GarageBand', 'iMovie',
  'Grammarly for Safari', 'AdBlock', 'HP Smart', 'Audible',
  'CleanMyMac_5_MAS', 'Mini Motorways', 'Snake.io+',
  'Numbers Creator Studio', 'Things3',
])

function appNameToCaskSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(?:^-+|-+$)/g, '')
}

function getPantryTrackedFromLock(cwd = process.cwd()): { count: number; names: string[] } {
  const lockPath = path.join(cwd, 'pantry.lock')
  if (!fs.existsSync(lockPath))
    return { count: 0, names: [] }
  try {
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as {
      workspaces?: Record<string, { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>
    }
    const root = lock.workspaces?.['']
    if (!root)
      return { count: 0, names: [] }
    const names = [
      ...Object.keys(root.dependencies || {}),
      ...Object.keys(root.devDependencies || {}),
    ]
    return { count: names.length, names }
  }
  catch {
    return { count: 0, names: [] }
  }
}

function parsePantryOutdated(stdout: string): UpdatesCheckResult['pantryOutdated'] {
  const pantryOutdated: UpdatesCheckResult['pantryOutdated'] = []
  const lines = stdout.split('\n')
  let inTable = false
  for (const rawLine of lines) {
    const line = stripAnsi(rawLine).trim()
    if (line.startsWith('---')) {
      inTable = true
      continue
    }
    if (!inTable || !line || line.startsWith('Legend') || line.startsWith('Found') || line.startsWith('Checking'))
      continue
    const parts = line.split(/\s{2,}/).map(p => p.trim()).filter(Boolean)
    if (parts.length >= 4) {
      pantryOutdated.push({
        name: parts[0],
        current: parts[1].replace(/^["']|["']$/g, ''),
        wanted: parts[2].replace(/^["']|["']$/g, ''),
        latest: parts[3],
      })
    }
  }
  return pantryOutdated
}

async function isMasInstalled(): Promise<boolean> {
  const cached = masAvailableCache.get('mas')
  if (cached !== undefined) return cached
  const r = await exec('command -v mas 2>/dev/null', { timeout: 2000 })
  const available = r.ok && !!r.stdout.trim()
  masAvailableCache.set('mas', available)
  return available
}

async function getBrewOutdatedJson(): Promise<string | null> {
  const cached = brewOutdatedCache.get('json')
  if (cached) return cached
  const r = await exec('brew outdated --json 2>/dev/null', { timeout: 30_000 })
  if (r.ok && r.stdout) {
    brewOutdatedCache.set('json', r.stdout)
    return r.stdout
  }
  return null
}

async function getBrewCaskList(): Promise<string> {
  const cached = brewCaskListCache.get('list')
  if (cached) return cached
  const r = await exec('brew list --cask 2>/dev/null', { timeout: 15_000 })
  const list = r.ok ? r.stdout : ''
  brewCaskListCache.set('list', list)
  return list
}

export function invalidateUpdatesCaches(): void {
  responseCache.clear()
  quickTierCache.clear()
  fullScanCache.clear()
  brewOutdatedCache.clear()
}

export async function runUpdatesCheck(
  fullScan = false,
  forceRefresh = false,
  tier: UpdatesTier = 'full',
): Promise<UpdatesCheckResult> {
  const cache = fullScan ? fullScanCache : (tier === 'quick' ? quickTierCache : responseCache)
  const cacheKey = fullScan ? 'full' : (tier === 'quick' ? 'tier-quick' : 'quick')

  if (!forceRefresh) {
    const hit = cache.get(cacheKey)
    if (hit) return { ...hit, cached: true }
  }

  return singleFlight(`updates-check:${cacheKey}:${forceRefresh}`, async () => {
    if (!forceRefresh) {
      const hit = cache.get(cacheKey)
      if (hit) return { ...hit, cached: true }
    }

    const result = await performUpdatesCheck(fullScan, tier)
    cache.set(cacheKey, result)
    return result
  })
}

async function performUpdatesCheck(fullScan: boolean, tier: UpdatesTier): Promise<UpdatesCheckResult> {
  const skipDesktop = tier === 'quick'

  const [brewJson, pantryResult, pantryPkgs, systemUpdates, brewCaskList, masResult] = await Promise.all([
    getBrewOutdatedJson(),
    exec('pantry outdated 2>/dev/null', { timeout: 10_000 }),
    Promise.resolve(getPantryTrackedFromLock()),
    checkSoftwareUpdates({ fullScan }),
    skipDesktop ? Promise.resolve('') : getBrewCaskList(),
    skipDesktop
      ? Promise.resolve({ ok: false, stdout: '', stderr: '' })
      : (async () => {
          const masInstalled = await isMasInstalled()
          return masInstalled
            ? exec('mas outdated 2>/dev/null', { timeout: 30_000 })
            : { ok: false, stdout: '', stderr: '' }
        })(),
  ])

  const brewFormulae: UpdatesCheckResult['brewFormulae'] = []
  const brewCasks: UpdatesCheckResult['brewCasks'] = []
  if (brewJson) {
    try {
      const data = JSON.parse(brewJson)
      for (const f of (data.formulae || [])) {
        brewFormulae.push({
          name: f.name,
          current: (f.installed_versions || [])[0] || '?',
          latest: f.current_version || '?',
          pinned: f.pinned || false,
        })
      }
      for (const c of (data.casks || [])) {
        brewCasks.push({
          name: c.name,
          current: (c.installed_versions || [])[0]?.split(',')[0] || '?',
          latest: c.current_version?.split(',')[0] || '?',
        })
      }
    }
    catch {}
  }

  const pantryOutdated = pantryResult.ok && pantryResult.stdout
    ? parsePantryOutdated(pantryResult.stdout)
    : []
  const pantryTracked = typeof pantryPkgs === 'object' && pantryPkgs !== null && 'names' in pantryPkgs
    ? pantryPkgs as { count: number; names: string[] }
    : { count: 0, names: [] as string[] }
  const checkingMatch = pantryResult.stdout?.match(/Checking (\d+) packages/)
  const pantryTrackedCount = checkingMatch
    ? Math.max(pantryTracked.count, Number.parseInt(checkingMatch[1], 10) || 0)
    : pantryTracked.count
  const pantryPackageNames = pantryTracked.names

  const systemOutdated = systemUpdates.updates

  if (skipDesktop) {
    return {
      success: true,
      brewFormulae,
      brewCasks,
      pantryOutdated,
      pantryPackages: pantryPackageNames,
      pantryTrackedCount,
      desktopApps: [],
      desktopOutdated: [],
      systemUpdates: systemOutdated,
      systemUpdateCount: systemOutdated.length,
      clToolsInfo: systemUpdates.clToolsInfo,
      macosVersion: systemUpdates.macosVersion,
      updateScanCached: systemUpdates.cached,
      updateScannedAt: systemUpdates.scannedAt,
      cached: false,
    }
  }

  const appEntries = listApplicationEntries()
  const rawApps = appEntries
    .filter(({ name }) => !SYSTEM_APPS.has(name))
    .map(({ name, plistPath }) => ({ name, version: readAppVersion(plistPath) }))

  const brewCaskSet = new Set(
    brewCaskList.split('\n').map(s => s.trim()).filter(Boolean),
  )

  const masOutdated: Record<string, { current: string; latest: string }> = {}
  if (masResult.ok && masResult.stdout.trim()) {
    for (const line of masResult.stdout.split('\n')) {
      const match = line.trim().match(/^\d+\s+(.+?)\s+\((.+?)\s*->\s*(.+?)\)$/)
      if (match) {
        masOutdated[match[1].trim()] = { current: match[2].trim(), latest: match[3].trim() }
      }
    }
  }

  const resolveCaskToken = (appName: string): string | null => {
    if (CASK_MAP[appName]) return CASK_MAP[appName]
    const slug = appNameToCaskSlug(appName)
    if (slug && brewCaskSet.has(slug)) return slug
    return null
  }

  const tokensToQuery: string[] = []
  for (const app of rawApps) {
    const token = resolveCaskToken(app.name)
    if (token && !tokensToQuery.includes(token)) tokensToQuery.push(token)
  }

  const caskVersions: Record<string, { version: string; autoUpdates: boolean }> = {}
  if (tokensToQuery.length > 0) {
    await Promise.all(
      Array.from({ length: Math.ceil(tokensToQuery.length / 15) }, (_, i) => {
        const batch = tokensToQuery.slice(i * 15, i * 15 + 15)
        return exec(`brew info --cask --json=v2 ${batch.join(' ')} 2>/dev/null`, { timeout: 30_000 })
          .then((r) => {
            if (!r.ok || !r.stdout) return
            try {
              const data = JSON.parse(r.stdout)
              for (const cask of (data.casks || [])) {
                caskVersions[cask.token] = {
                  version: (cask.version || '').split(',')[0],
                  autoUpdates: cask.auto_updates || false,
                }
              }
            }
            catch {}
          })
      }),
    )
  }

  const desktopApps: UpdatesCheckResult['desktopApps'] = []
  const desktopOutdated: UpdatesCheckResult['desktopApps'] = []

  for (const app of rawApps) {
    const masInfo = masOutdated[app.name]
    const isMAS = MAS_APPS.has(app.name) || !!masInfo
    const token = resolveCaskToken(app.name)
    const caskInfo = token ? caskVersions[token] : null

    let source = 'unknown'
    let latestVersion: string | null = null
    let updateAvailable = false
    let autoUpdates = false

    if (masInfo) {
      source = 'mas'
      latestVersion = masInfo.latest
      updateAvailable = isNewerVersion(masInfo.latest, masInfo.current) || isNewerVersion(masInfo.latest, app.version)
    }
    else if (isMAS) {
      source = 'mas'
    }
    else if (caskInfo) {
      latestVersion = caskInfo.version
      autoUpdates = caskInfo.autoUpdates
      updateAvailable = isNewerVersion(latestVersion, app.version)
      source = autoUpdates ? 'auto' : 'brew'
    }

    const entry = {
      name: app.name,
      version: app.version,
      latestVersion,
      updateAvailable,
      source,
      caskToken: token,
      autoUpdates,
    }
    desktopApps.push(entry)
    if (updateAvailable) desktopOutdated.push(entry)
  }

  desktopApps.sort((a, b) => {
    if (a.updateAvailable && !b.updateAvailable) return -1
    if (!a.updateAvailable && b.updateAvailable) return 1
    return a.name.localeCompare(b.name)
  })

  return {
    success: true,
    brewFormulae,
    brewCasks,
    pantryOutdated,
    pantryPackages: pantryPackageNames,
    pantryTrackedCount,
    desktopApps,
    desktopOutdated,
    systemUpdates: systemOutdated,
    systemUpdateCount: systemOutdated.length,
    clToolsInfo: systemUpdates.clToolsInfo,
    macosVersion: systemUpdates.macosVersion,
    updateScanCached: systemUpdates.cached,
    updateScannedAt: systemUpdates.scannedAt,
    cached: false,
  }
}

function countOutdatedFromCheck(check: UpdatesCheckResult): number {
  return check.systemUpdateCount
    + check.brewFormulae.length
    + check.brewCasks.length
    + check.pantryOutdated.length
    + check.desktopOutdated.length
}

export async function getUpdatesSummary(): Promise<{
  success: true
  total: number
  systemCount: number
  brewCount: number
  pantryCount: number
  desktopCount: number
  clToolsCount: number
  macosCount: number
  cached: boolean
}> {
  const cached = responseCache.get('quick')
    || quickTierCache.get('tier-quick')
    || fullScanCache.get('full')
  if (cached) {
    return {
      success: true,
      total: countOutdatedFromCheck(cached),
      systemCount: cached.systemUpdateCount,
      brewCount: cached.brewFormulae.length + cached.brewCasks.length,
      pantryCount: cached.pantryOutdated.length,
      desktopCount: cached.desktopOutdated.length,
      clToolsCount: cached.systemUpdates.filter(u => u.kind === 'cltools').length,
      macosCount: cached.systemUpdates.filter(u => u.kind === 'macos').length,
      cached: true,
    }
  }

  const check = await runUpdatesCheck(false, false, 'quick')
  const fullHit = responseCache.get('quick')
  const desktopCount = fullHit?.desktopOutdated.length ?? 0

  return {
    success: true,
    total: countOutdatedFromCheck(check) + desktopCount,
    systemCount: check.systemUpdateCount,
    brewCount: check.brewFormulae.length + check.brewCasks.length,
    pantryCount: check.pantryOutdated.length,
    desktopCount,
    clToolsCount: check.systemUpdates.filter(u => u.kind === 'cltools').length,
    macosCount: check.systemUpdates.filter(u => u.kind === 'macos').length,
    cached: check.cached,
  }
}
