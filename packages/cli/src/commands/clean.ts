import type { CLI } from '@stacksjs/clapp'
import { CLEAN_TARGETS, cleanAll, cleanTargets, getCleanTargets, scanExistingTargets } from '@system-cleaner/clean'
import { formatBytes } from '@system-cleaner/core'

export function registerCleanCommand(app: CLI): void {
  app.command('clean', 'Deep clean caches, logs, browser data, and temporary files')
    .option('-c, --category <category>', 'Filter by category (cache, log, browser, developer, system, application, trash, homebrew)')
    .option('-a, --all', 'Clean all categories without prompting')
    .option('--dry-run', 'Preview what would be cleaned without deleting')
    .option('--browser', 'Clean browser caches only')
    .option('--developer', 'Clean developer tool caches only')
    .option('--system', 'Clean system logs and caches only')
    .action(async (options: any) => {
      const { multiselect, confirm, spinner, log, intro, outro } = await import('@stacksjs/clapp')

      intro('System Cleaner — Deep Clean')

      // Determine categories
      let categories: string[] | undefined

      if (options.browser) categories = ['browser']
      else if (options.developer) categories = ['developer']
      else if (options.system) categories = ['system', 'log']
      else if (options.category) categories = [options.category]

      const targets = getCleanTargets(categories)

      // Scan for existing targets with sizes
      const s = spinner()
      s.start('Scanning for cleanable items...')
      const scanResults = await scanExistingTargets(targets)
      s.stop(`Found ${scanResults.length} cleanable items`)

      if (scanResults.length === 0) {
        log.info('Nothing to clean!')
        outro('Done')
        return
      }

      // Show total reclaimable
      const totalBytes = scanResults.reduce((sum, r) => sum + r.sizeBytes, 0)
      log.info(`Total reclaimable: ${formatBytes(totalBytes)}`)
      log.info('')

      let selectedTargets = scanResults.map(r => r.target)

      if (!options.all) {
        const selected = await multiselect({
          message: 'Select items to clean:',
          options: scanResults.map(r => ({
            value: r.target.id,
            label: `${r.target.icon} ${r.target.name}`,
            hint: `${r.sizeFormatted} — ${r.target.description}`,
          })),
          required: true,
        })

        if (!Array.isArray(selected) || selected.length === 0) {
          outro('Cancelled')
          return
        }

        selectedTargets = scanResults
          .filter(r => selected.includes(r.target.id))
          .map(r => r.target)
      }

      // Confirm
      const selectedBytes = scanResults
        .filter(r => selectedTargets.some(t => t.id === r.target.id))
        .reduce((sum, r) => sum + r.sizeBytes, 0)

      if (!options.all) {
        const ok = await confirm({
          message: `Clean ${selectedTargets.length} items (${formatBytes(selectedBytes)})?`,
        })
        if (!ok) {
          outro('Cancelled')
          return
        }
      }

      // Execute cleaning
      s.start('Cleaning...')
      const result = await cleanTargets(selectedTargets, {
        dryRun: options.dryRun,
        onProgress: (id, status) => s.message(`Cleaning ${id}...`),
      })
      s.stop(`Cleaned ${result.results.length} items`)

      // Report results
      for (const r of result.results) {
        if (r.success && r.freedBytes > 0) {
          log.success(`${r.targetName}: freed ${r.freedFormatted}`)
        }
        else if (r.errors.length > 0) {
          log.warn(`${r.targetName}: ${r.errors[0]}`)
        }
      }

      log.info('')
      if (options.dryRun) {
        log.info(`[DRY RUN] Would free: ${result.totalFreedFormatted}`)
      }
      else {
        log.success(`Total freed: ${result.totalFreedFormatted}`)
      }

      outro('Clean complete')
    })
}
