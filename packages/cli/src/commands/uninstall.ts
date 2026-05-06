import type { CLI } from '@stacksjs/clapp'
import { discoverApps, searchApps, findRemnants, summarizeRemnants, uninstallApp } from '@system-cleaner/uninstall'
import { formatBytes } from '@system-cleaner/core'

export function registerUninstallCommand(app: CLI): void {
  app.command('uninstall [app-name]', 'Smart uninstall apps with deep remnant removal')
    .option('--list', 'List all installed apps')
    .option('--deep', 'Include deep scan for hidden remnants (default)')
    .option('--shallow', 'Only remove the app bundle, skip remnant scan')
    .option('--dry-run', 'Preview what would be removed without deleting')
    .option('--include-system', 'Include system apps in listing')
    .action(async (appName: string | undefined, options: any) => {
      const { select, confirm, spinner, log, intro, outro } = await import('@stacksjs/clapp')

      intro('System Cleaner — Smart Uninstaller')

      if (options.list) {
        const s = spinner()
        s.start('Discovering installed apps...')
        const apps = await discoverApps(options.includeSystem)
        s.stop(`Found ${apps.length} apps`)

        for (const app of apps) {
          const size = app.sizeBytes > 0 ? formatBytes(app.sizeBytes) : '—'
          log.info(`  ${app.name} (${app.version || '—'}) — ${size}`)
        }

        outro(`${apps.length} applications`)
        return
      }

      // Find the app to uninstall
      let targetApp

      if (appName) {
        const s = spinner()
        s.start(`Searching for "${appName}"...`)
        const matches = await searchApps(appName, options.includeSystem)
        s.stop(`Found ${matches.length} match(es)`)

        if (matches.length === 0) {
          log.error(`No app found matching "${appName}"`)
          outro('Cancelled')
          return
        }

        if (matches.length === 1) {
          targetApp = matches[0]
        }
        else {
          const selected = (await select({
            message: 'Multiple apps found. Select one:',
            options: matches.map(app => ({
              value: app.path,
              label: `${app.name} (${app.version || '—'})`,
              hint: `${formatBytes(app.sizeBytes)} — ${app.path}`,
            })),
          })) as unknown as string

          targetApp = matches.find(a => a.path === selected)
          if (!targetApp) {
            outro('Cancelled')
            return
          }
        }
      }
      else {
        const s = spinner()
        s.start('Discovering installed apps...')
        const apps = await discoverApps(options.includeSystem)
        s.stop(`Found ${apps.length} apps`)

        const selected = (await select({
          message: 'Select an app to uninstall:',
          options: apps.map(app => ({
            value: app.path,
            label: `${app.name} (${app.version || '—'})`,
            hint: formatBytes(app.sizeBytes),
          })),
          maxItems: 15,
        })) as unknown as string

        targetApp = apps.find(a => a.path === selected)
        if (!targetApp) {
          outro('Cancelled')
          return
        }
      }

      // Scan for remnants
      const s = spinner()
      const deep = options.shallow !== true
      s.start(deep ? 'Scanning for app remnants...' : 'Preparing uninstall...')

      const remnants = deep ? await findRemnants(targetApp) : []
      const summary = summarizeRemnants(targetApp, remnants)
      s.stop(`Found ${remnants.length} remnant location(s)`)

      // Show summary
      log.info('')
      log.info(`App: ${targetApp.name} (${targetApp.bundleId})`)
      log.info(`Bundle size: ${formatBytes(targetApp.sizeBytes)}`)

      if (remnants.length > 0) {
        log.info(`Remnants: ${summary.totalRemnantSizeFormatted} across ${remnants.length} locations`)
        log.info('')
        for (const remnant of remnants.slice(0, 10)) {
          log.info(`  ${formatBytes(remnant.sizeBytes).padStart(10)} ${remnant.type.padEnd(20)} ${remnant.path}`)
        }
        if (remnants.length > 10)
          log.info(`  ... and ${remnants.length - 10} more`)
      }

      log.info('')
      log.info(`Total to remove: ${summary.totalSizeFormatted}`)

      // Confirm
      const ok = (await confirm({
        message: `Uninstall ${targetApp.name} and remove all remnants?`,
      })) as unknown as boolean

      if (!ok) {
        outro('Cancelled')
        return
      }

      // Execute
      s.start(`Uninstalling ${targetApp.name}...`)
      const result = await uninstallApp(targetApp, {
        dryRun: options.dryRun,
        deep,
        onProgress: step => s.message(step),
      })
      s.stop('Uninstall complete')

      if (result.success) {
        log.success(`Freed ${result.totalFreedFormatted}`)
        log.info(`Removed ${result.removedPaths.length} item(s)`)
      }

      if (result.errors.length > 0) {
        log.warn(`${result.errors.length} error(s):`)
        for (const err of result.errors.slice(0, 5))
          log.warn(`  ${err}`)
      }

      if (options.dryRun)
        log.info('[DRY RUN] No files were actually removed')

      outro('Done')
    })
}
