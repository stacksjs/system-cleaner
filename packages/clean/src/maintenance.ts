import { exec } from '@system-cleaner/core'

/**
 * The macOS maintenance routines an app like this is expected to offer —
 * OnyX's whole reason to exist, and CleanMyMac's Maintenance tab.
 *
 * The table lived inside the CLI's `optimize` command, which meant the app had
 * no way to run any of it. It is here so that the CLI and `/api/run-maintenance`
 * execute the same list rather than two lists that drift.
 */
export interface MaintenanceTask {
  id: string
  name: string
  /** What the task does. */
  description: string
  /** What the user will notice afterwards — the reason to run it. */
  effect: string
  command: string
  /**
   * A task the app itself cannot run.
   *
   * The agent has no terminal to prompt on, so `sudo` here would hang on a
   * password nobody can type. These are listed with their command instead, and
   * the UI offers to copy it — an honest "here is what to run" beats a button
   * that can only ever fail.
   */
  requiresSudo: boolean
  category: 'caches' | 'services' | 'network' | 'storage'
  icon: string
}

export const MAINTENANCE_TASKS: MaintenanceTask[] = [
  {
    id: 'launch-services',
    name: 'Rebuild Launch Services',
    description: 'Re-register every app bundle with the Launch Services database',
    effect: 'Fixes an "Open With" menu showing duplicates, ghosts of deleted apps, or the wrong default',
    command: '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -kill -r -domain local -domain system -domain user',
    requiresSudo: false,
    category: 'services',
    icon: 'i-f7-app-fill',
  },
  {
    id: 'finder',
    name: 'Restart Finder',
    description: 'Relaunch the Finder process',
    effect: 'Clears a Finder stuck on stale thumbnails, wrong sizes, or a window that will not redraw',
    command: 'killall Finder',
    requiresSudo: false,
    category: 'services',
    icon: 'i-f7-folder-fill',
  },
  {
    id: 'dock',
    name: 'Restart Dock',
    description: 'Relaunch the Dock process',
    effect: 'Clears stuck icons, a frozen Mission Control, and a Dock that ignores its own settings',
    command: 'killall Dock',
    requiresSudo: false,
    category: 'services',
    icon: 'i-f7-macwindow',
  },
  {
    id: 'font-cache',
    name: 'Clear Font Cache',
    description: 'Drop the ATS font databases so they are rebuilt on demand',
    effect: 'Fixes garbled, missing, or duplicated fonts in menus and documents',
    command: 'atsutil databases -remove 2>/dev/null',
    requiresSudo: false,
    category: 'caches',
    icon: 'i-f7-textformat',
  },
  {
    id: 'quicklook-cache',
    name: 'Reset QuickLook',
    description: 'Reset the QuickLook generator and its thumbnail cache',
    effect: 'Fixes blank or wrong previews when you press Space on a file',
    command: 'qlmanage -r cache 2>/dev/null && qlmanage -r 2>/dev/null',
    requiresSudo: false,
    category: 'caches',
    icon: 'i-f7-eye-fill',
  },
  {
    id: 'saved-state',
    name: 'Clear Saved App State',
    description: 'Remove saved window state older than 30 days',
    effect: 'Stops long-quit apps from reopening the windows and documents they had months ago',
    command: 'find ~/Library/Saved\\ Application\\ State -name "*.savedState" -mtime +30 -exec rm -rf {} + 2>/dev/null',
    requiresSudo: false,
    category: 'storage',
    icon: 'i-f7-macwindow',
  },
  {
    id: 'sqlite-vacuum',
    name: 'Compact Mail & Safari Databases',
    description: 'VACUUM the Mail and Safari SQLite databases',
    effect: 'Shrinks databases that have grown far past their content, and speeds up search in both',
    command: 'pgrep -x Mail >/dev/null && echo "SKIP: Mail is running" || find ~/Library -name "*.db" -path "*/Mail/*" -exec sqlite3 {} "VACUUM;" \\; 2>/dev/null; pgrep -x Safari >/dev/null && echo "SKIP: Safari is running" || find ~/Library -name "*.db" -path "*/Safari/*" -exec sqlite3 {} "VACUUM;" \\; 2>/dev/null',
    requiresSudo: false,
    category: 'storage',
    icon: 'i-f7-doc-chart-fill',
  },
  {
    id: 'fix-preferences',
    name: 'Check Preference Files',
    description: 'Lint every .plist in ~/Library/Preferences and report the corrupt ones',
    effect: 'Names the preference files behind an app that forgets its settings on every launch',
    command: 'find ~/Library/Preferences -name "*.plist" -exec plutil -lint {} \\; 2>&1 | grep -v "OK$" | head -40',
    requiresSudo: false,
    category: 'storage',
    icon: 'i-f7-gear-alt-fill',
  },
  {
    id: 'disk-permissions',
    name: 'Repair Home Permissions',
    description: 'Reset the permissions and ACLs on your home directory to their defaults',
    effect: 'Fixes "you do not have permission" on files you own',
    command: 'diskutil resetUserPermissions / $(id -u)',
    requiresSudo: false,
    category: 'storage',
    icon: 'i-f7-lock-shield-fill',
  },

  // ── Tasks the app cannot run itself ─────────────────────────
  {
    id: 'dns-cache',
    name: 'Flush DNS Cache',
    description: 'Clear the resolver cache and restart mDNSResponder',
    effect: 'Fixes a site that resolves to an address it moved off days ago',
    command: 'sudo dscacheutil -flushcache && sudo killall -HUP mDNSResponder',
    requiresSudo: true,
    category: 'network',
    icon: 'i-f7-wifi',
  },
  {
    id: 'network-stack',
    name: 'Reset Network Stack',
    description: 'Flush the routing table and the ARP cache',
    effect: 'Fixes a Mac that stays offline after a network change until it reboots',
    command: 'sudo route -n flush 2>/dev/null && sudo arp -a -d 2>/dev/null',
    requiresSudo: true,
    category: 'network',
    icon: 'i-f7-antenna-radiowaves-left-right',
  },
  {
    id: 'bluetooth-reset',
    name: 'Reset Bluetooth',
    description: 'Restart the Bluetooth daemon',
    effect: 'Fixes a mouse, keyboard, or pair of headphones that will not reconnect',
    command: 'sudo pkill bluetoothd 2>/dev/null',
    requiresSudo: true,
    category: 'services',
    icon: 'i-f7-antenna-radiowaves-left-right',
  },
  {
    id: 'spotlight',
    name: 'Rebuild Spotlight Index',
    description: 'Erase and rebuild the Spotlight index for the boot volume',
    effect: 'Fixes search that misses files you know are there. Reindexing runs for hours afterwards',
    command: 'sudo mdutil -E /',
    requiresSudo: true,
    category: 'storage',
    icon: 'i-f7-search',
  },
  {
    id: 'maintenance-scripts',
    name: 'Run Periodic Scripts',
    description: 'Run the daily, weekly, and monthly maintenance scripts now',
    effect: 'Rotates system logs on a Mac that sleeps through the small hours when these normally run',
    command: 'sudo periodic daily weekly monthly',
    requiresSudo: true,
    category: 'services',
    icon: 'i-f7-calendar',
  },
  {
    id: 'purgeable',
    name: 'Purge Inactive Memory',
    description: 'Force the kernel to release its inactive page cache',
    effect: 'Frees memory before a heavy job. macOS does this on its own, so it rarely changes anything',
    command: 'sudo purge',
    requiresSudo: true,
    category: 'caches',
    icon: 'i-f7-memories',
  },
  {
    id: 'kext-cache',
    name: 'Rebuild Boot Caches',
    description: 'Rebuild the prelinked kernel and system caches',
    effect: 'Fixes a slow boot after a failed update or a kernel extension change',
    command: 'sudo kmutil configure-boot 2>/dev/null || sudo kextcache -system-prelinked-kernel 2>/dev/null && sudo kextcache -system-caches 2>/dev/null',
    requiresSudo: true,
    category: 'caches',
    icon: 'i-f7-power',
  },
]

export function getMaintenanceTask(id: string): MaintenanceTask | undefined {
  return MAINTENANCE_TASKS.find(task => task.id === id)
}

export interface MaintenanceRunResult {
  id: string
  name: string
  success: boolean
  /** True when the task was refused because only a terminal can run it. */
  needsSudo: boolean
  /** The command to run by hand, present whenever `needsSudo` is true. */
  command?: string
  output: string
  error?: string
  durationMs: number
}

/**
 * Run one maintenance task.
 *
 * A `sudo` task is refused rather than attempted: `exec` has no terminal, so
 * the password prompt would go to a pipe nobody is reading and the task would
 * sit there until its timeout. Refusing costs nothing and lets the caller show
 * the command instead.
 */
export async function runMaintenanceTask(id: string): Promise<MaintenanceRunResult> {
  const task = getMaintenanceTask(id)
  if (!task) {
    return {
      id,
      name: id,
      success: false,
      needsSudo: false,
      output: '',
      error: 'Unknown maintenance task',
      durationMs: 0,
    }
  }

  if (task.requiresSudo) {
    return {
      id: task.id,
      name: task.name,
      success: false,
      needsSudo: true,
      command: task.command,
      output: '',
      error: 'This task needs administrator rights, which have to be granted in Terminal',
      durationMs: 0,
    }
  }

  const startedAt = Date.now()
  const result = await exec(task.command, { timeout: 120_000 })

  return {
    id: task.id,
    name: task.name,
    // `killall Finder` writes nothing and exits 0; `plutil -lint` exits
    // non-zero when it finds a bad file, which is a successful *check*. The
    // exit code alone is not the answer for either, so a task that produced
    // output is treated as having run.
    success: result.ok || result.stdout.length > 0,
    needsSudo: false,
    output: (result.stdout || '').slice(0, 4000),
    error: result.ok ? undefined : (result.stderr || '').slice(0, 500) || undefined,
    durationMs: Date.now() - startedAt,
  }
}
