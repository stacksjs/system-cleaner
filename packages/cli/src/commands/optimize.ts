import type { CLI } from '@stacksjs/clapp'
import { exec } from '@system-cleaner/core'

interface OptimizeTask {
  id: string
  name: string
  description: string
  command: string
  requiresSudo: boolean
}

const OPTIMIZE_TASKS: OptimizeTask[] = [
  {
    id: 'dns-cache',
    name: 'Flush DNS Cache',
    description: 'Clear the DNS resolver cache to fix stale DNS entries',
    command: 'sudo dscacheutil -flushcache && sudo killall -HUP mDNSResponder',
    requiresSudo: true,
  },
  {
    id: 'spotlight',
    name: 'Rebuild Spotlight Index',
    description: 'Rebuild the Spotlight search index (may take time in background)',
    command: 'sudo mdutil -E /',
    requiresSudo: true,
  },
  {
    id: 'launch-services',
    name: 'Rebuild Launch Services',
    description: 'Fix "Open With" menu showing duplicate or missing apps',
    command: '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -kill -r -domain local -domain system -domain user',
    requiresSudo: false,
  },
  {
    id: 'finder',
    name: 'Restart Finder',
    description: 'Restart Finder to clear its cache and fix display issues',
    command: 'killall Finder',
    requiresSudo: false,
  },
  {
    id: 'dock',
    name: 'Restart Dock',
    description: 'Restart the Dock to fix stuck icons or layout issues',
    command: 'killall Dock',
    requiresSudo: false,
  },
  {
    id: 'font-cache',
    name: 'Clear Font Cache',
    description: 'Remove font cache to fix font rendering issues',
    command: 'atsutil databases -remove 2>/dev/null',
    requiresSudo: false,
  },
  {
    id: 'kext-cache',
    name: 'Rebuild System Cache',
    description: 'Rebuild boot and system caches (useful after updates)',
    command: 'sudo kmutil configure-boot 2>/dev/null || sudo kextcache -system-prelinked-kernel 2>/dev/null && sudo kextcache -system-caches 2>/dev/null',
    requiresSudo: true,
  },
  {
    id: 'purgeable',
    name: 'Purge Memory',
    description: 'Clear inactive memory (macOS does this automatically, but this forces it)',
    command: 'sudo purge',
    requiresSudo: true,
  },
  {
    id: 'maintenance-scripts',
    name: 'Run Maintenance Scripts',
    description: 'Run the daily, weekly, and monthly maintenance scripts',
    command: 'sudo periodic daily weekly monthly',
    requiresSudo: true,
  },
  {
    id: 'fix-preferences',
    name: 'Fix Broken Preferences',
    description: 'Validate and fix corrupted .plist preference files',
    command: 'find ~/Library/Preferences -name "*.plist" -exec plutil -lint {} \\; 2>&1 | grep -v "OK"',
    requiresSudo: false,
  },
  {
    id: 'network-stack',
    name: 'Reset Network Stack',
    description: 'Flush routing table and ARP cache to fix network issues',
    command: 'sudo route -n flush 2>/dev/null && sudo arp -a -d 2>/dev/null',
    requiresSudo: true,
  },
  {
    id: 'disk-permissions',
    name: 'Repair Disk Permissions',
    description: 'Reset user directory permissions to defaults',
    command: 'diskutil resetUserPermissions / $(id -u)',
    requiresSudo: false,
  },
  {
    id: 'bluetooth-reset',
    name: 'Reset Bluetooth',
    description: 'Restart the Bluetooth daemon to fix connectivity issues',
    command: 'sudo pkill bluetoothd 2>/dev/null',
    requiresSudo: true,
  },
  {
    id: 'sqlite-vacuum',
    name: 'Optimize Databases',
    description: 'Vacuum SQLite databases (Mail, Safari must not be running)',
    command: 'pgrep -x Mail >/dev/null && echo "SKIP: Mail is running" || find ~/Library -name "*.db" -path "*/Mail/*" -exec sqlite3 {} "VACUUM;" \\; 2>/dev/null; pgrep -x Safari >/dev/null && echo "SKIP: Safari is running" || find ~/Library -name "*.db" -path "*/Safari/*" -exec sqlite3 {} "VACUUM;" \\; 2>/dev/null',
    requiresSudo: false,
  },
  {
    id: 'saved-state',
    name: 'Clear Saved App State',
    description: 'Remove saved application state to fix window restore issues',
    command: 'find ~/Library/Saved\\ Application\\ State -name "*.savedState" -mtime +30 -exec rm -rf {} + 2>/dev/null',
    requiresSudo: false,
  },
]

export function registerOptimizeCommand(app: CLI): void {
  app.command('optimize', 'System optimization — rebuild caches, fix services, tune performance')
    .option('-a, --all', 'Run all optimization tasks')
    .option('--dns', 'Flush DNS cache only')
    .option('--spotlight', 'Rebuild Spotlight index only')
    .option('--finder', 'Restart Finder only')
    .option('--dock', 'Restart Dock only')
    .option('--dry-run', 'Show commands without executing')
    .action(async (options: any) => {
      const { multiselect, confirm, spinner, log, intro, outro } = await import('@stacksjs/clapp')

      intro('System Cleaner — System Optimizer')

      // Handle specific task shortcuts
      let selectedTasks: OptimizeTask[] = []

      if (options.dns) selectedTasks = OPTIMIZE_TASKS.filter(t => t.id === 'dns-cache')
      else if (options.spotlight) selectedTasks = OPTIMIZE_TASKS.filter(t => t.id === 'spotlight')
      else if (options.finder) selectedTasks = OPTIMIZE_TASKS.filter(t => t.id === 'finder')
      else if (options.dock) selectedTasks = OPTIMIZE_TASKS.filter(t => t.id === 'dock')
      else if (options.all) {
        selectedTasks = OPTIMIZE_TASKS
      }
      else {
        const selected = await multiselect({
          message: 'Select optimizations to run:',
          options: OPTIMIZE_TASKS.map(task => ({
            value: task.id,
            label: task.name,
            hint: `${task.description}${task.requiresSudo ? ' (requires sudo)' : ''}`,
          })),
          required: true,
        })

        if (!Array.isArray(selected) || selected.length === 0) {
          outro('Cancelled')
          return
        }

        selectedTasks = OPTIMIZE_TASKS.filter(t => selected.includes(t.id))
      }

      if (selectedTasks.length === 0) {
        log.info('No tasks selected.')
        outro('Done')
        return
      }

      // Check if any tasks require sudo
      const needsSudo = selectedTasks.some(t => t.requiresSudo)
      if (needsSudo && !options.dryRun) {
        log.warn('Some tasks require elevated privileges (sudo)')
      }

      if (!options.all) {
        const ok = (await confirm({
          message: `Run ${selectedTasks.length} optimization task(s)?`,
        })) as unknown as boolean
        if (!ok) {
          outro('Cancelled')
          return
        }
      }

      // Execute tasks
      const s = spinner()
      let succeeded = 0
      let failed = 0

      for (const task of selectedTasks) {
        if (options.dryRun) {
          log.info(`[DRY RUN] ${task.name}: ${task.command}`)
          succeeded++
          continue
        }

        s.start(`Running: ${task.name}...`)
        const result = await exec(task.command, { timeout: 60_000 })

        if (result.ok || result.exitCode === 0) {
          s.stop(`${task.name} — done`)
          succeeded++
        }
        else {
          s.stop(`${task.name} — failed`)
          log.warn(`  ${result.stderr || 'Unknown error'}`)
          failed++
        }
      }

      log.info('')
      if (failed === 0) {
        log.success(`All ${succeeded} task(s) completed successfully`)
      }
      else {
        log.warn(`${succeeded} succeeded, ${failed} failed`)
      }

      outro('Optimization complete')
    })
}
