import type { CLI } from '@stacksjs/clapp'
import { findProjectArtifacts } from '@system-cleaner/disk'
import { formatBytes, HOME } from '@system-cleaner/core'
import * as fs from 'node:fs'
import * as path from 'node:path'

export function registerPurgeCommand(app: CLI): void {
  app.command('purge', 'Find and remove project build artifacts (node_modules, target, dist, etc.)')
    .option('--path <paths>', 'Comma-separated directories to scan (default: ~/Code, ~/Projects, ~/Developer)')
    .option('--dry-run', 'Preview what would be removed')
    .option('--json', 'Output as JSON')
    .option('-a, --all', 'Remove all found artifacts without prompting')
    .action(async (options: any) => {
      const { multiselect, confirm, spinner, log, intro, outro } = await import('@stacksjs/clapp')

      intro('System Cleaner — Project Artifact Purge')

      const searchPaths = options.path
        ? options.path.split(',').map((p: string) => p.trim().replace(/^~/, HOME))
        : [
            path.join(HOME, 'Code'),
            path.join(HOME, 'Projects'),
            path.join(HOME, 'Developer'),
            path.join(HOME, 'Work'),
          ]

      const s = spinner()
      s.start('Scanning for project build artifacts...')
      const artifacts = await findProjectArtifacts(searchPaths)
      s.stop(`Found ${artifacts.length} artifact(s)`)

      if (artifacts.length === 0) {
        log.info('No project artifacts found in scan paths.')
        outro('Done')
        return
      }

      const totalSize = artifacts.reduce((sum, a) => sum + a.sizeBytes, 0)

      if (options.json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ artifacts, totalSize, totalSizeFormatted: formatBytes(totalSize) }, null, 2))
        return
      }

      log.info(`Total reclaimable: ${formatBytes(totalSize)}`)
      log.info('')

      let selected: string[]

      if (options.all) {
        selected = artifacts.map(a => a.path)
      }
      else {
        const result = await multiselect({
          message: 'Select artifacts to remove:',
          options: artifacts.map(a => ({
            value: a.path,
            label: `${a.projectName}/${path.basename(a.path)}`,
            hint: `${formatBytes(a.sizeBytes).padStart(10)} — ${a.type}`,
          })),
          required: true,
        })

        if (!Array.isArray(result) || result.length === 0) {
          outro('Cancelled')
          return
        }
        selected = result as string[]
      }

      const selectedArtifacts = artifacts.filter(a => selected.includes(a.path))
      const selectedSize = selectedArtifacts.reduce((sum, a) => sum + a.sizeBytes, 0)

      if (!options.all) {
        const ok = (await confirm({
          message: `Remove ${selectedArtifacts.length} artifact(s) (${formatBytes(selectedSize)})?`,
        })) as unknown as boolean
        if (!ok) {
          outro('Cancelled')
          return
        }
      }

      // Execute removal
      s.start('Removing artifacts...')
      let freed = 0
      let errors = 0

      for (const artifact of selectedArtifacts) {
        try {
          if (!options.dryRun) {
            fs.rmSync(artifact.path, { recursive: true, force: true })
          }
          freed += artifact.sizeBytes
        }
        catch {
          errors++
        }
      }
      s.stop('Done')

      if (options.dryRun) {
        log.info(`[DRY RUN] Would free: ${formatBytes(freed)}`)
      }
      else {
        log.success(`Freed ${formatBytes(freed)}`)
        if (errors > 0)
          log.warn(`${errors} error(s) during removal`)
      }

      outro(`${selectedArtifacts.length} artifacts removed`)
    })
}
