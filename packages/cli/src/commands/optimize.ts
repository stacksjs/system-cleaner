import type { CLI } from '@stacksjs/clapp'
import type { MaintenanceTask } from '@system-cleaner/clean'
import { MAINTENANCE_TASKS } from '@system-cleaner/clean'
import { exec } from '@system-cleaner/core'

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
      let selectedTasks: MaintenanceTask[] = []

      if (options.dns) selectedTasks = MAINTENANCE_TASKS.filter(t => t.id === 'dns-cache')
      else if (options.spotlight) selectedTasks = MAINTENANCE_TASKS.filter(t => t.id === 'spotlight')
      else if (options.finder) selectedTasks = MAINTENANCE_TASKS.filter(t => t.id === 'finder')
      else if (options.dock) selectedTasks = MAINTENANCE_TASKS.filter(t => t.id === 'dock')
      else if (options.all) {
        selectedTasks = MAINTENANCE_TASKS
      }
      else {
        const selected = await multiselect({
          message: 'Select optimizations to run:',
          options: MAINTENANCE_TASKS.map(task => ({
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

        selectedTasks = MAINTENANCE_TASKS.filter(t => selected.includes(t.id))
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

      // Execute tasks. Unlike the app, a terminal *can* answer a sudo prompt,
      // so the CLI runs the whole table rather than refusing half of it.
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
