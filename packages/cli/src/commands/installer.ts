import type { CLI } from '@stacksjs/clapp'
import { formatBytes, HOME, exec, shellEscape } from '@system-cleaner/core'
import * as fs from 'node:fs'
import * as path from 'node:path'

// eslint-disable-next-line pickier/no-unused-vars
const INSTALLER_EXTENSIONS = new Set(['.dmg', '.pkg', '.mpkg', '.iso', '.xip'])

const SCAN_LOCATIONS = [
  { path: path.join(HOME, 'Downloads'), label: 'Downloads' },
  { path: path.join(HOME, 'Desktop'), label: 'Desktop' },
  { path: path.join(HOME, 'Documents'), label: 'Documents' },
  { path: path.join(HOME, 'Library/Downloads'), label: 'Library Downloads' },
  { path: path.join(HOME, 'Library/Caches/Homebrew'), label: 'Homebrew' },
  { path: path.join(HOME, 'Library/Mobile Documents/com~apple~CloudDocs/Downloads'), label: 'iCloud Downloads' },
  { path: path.join(HOME, 'Library/Containers/com.apple.mail/Data/Library/Mail Downloads'), label: 'Mail' },
  { path: '/Users/Shared', label: 'Shared' },
]

interface InstallerFile {
  path: string
  name: string
  sizeBytes: number
  source: string
}

export function registerInstallerCommand(app: CLI): void {
  app.command('installer', 'Find and remove installer files (.dmg, .pkg, .iso, .xip)')
    .option('--dry-run', 'Preview what would be removed')
    .option('--json', 'Output as JSON')
    .option('-a, --all', 'Remove all found installers without prompting')
    .action(async (options: any) => {
      const { multiselect, confirm, spinner, log, intro, outro } = await import('@stacksjs/clapp')

      intro('System Cleaner — Installer File Finder')

      const s = spinner()
      s.start('Scanning for installer files...')

      const installers: InstallerFile[] = []

      for (const location of SCAN_LOCATIONS) {
        if (!fs.existsSync(location.path))
          continue

        try {
          const result = await exec(
            `find ${shellEscape(location.path)} -maxdepth 2 -type f \\( -name "*.dmg" -o -name "*.pkg" -o -name "*.mpkg" -o -name "*.iso" -o -name "*.xip" \\) 2>/dev/null`,
            { timeout: 10_000 },
          )

          if (result.ok && result.stdout) {
            for (const filePath of result.stdout.split('\n').filter(Boolean)) {
              try {
                const stat = fs.statSync(filePath)
                if (stat.isSymbolicLink())
                  continue
                installers.push({
                  path: filePath,
                  name: path.basename(filePath),
                  sizeBytes: stat.size,
                  source: location.label,
                })
              }
              catch { /* skip */ }
            }
          }
        }
        catch { /* skip */ }
      }

      s.stop(`Found ${installers.length} installer file(s)`)

      if (installers.length === 0) {
        log.info('No installer files found.')
        outro('Done')
        return
      }

      // Sort by size descending
      installers.sort((a, b) => b.sizeBytes - a.sizeBytes)
      const totalSize = installers.reduce((sum, f) => sum + f.sizeBytes, 0)

      if (options.json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ files: installers, totalSize, totalSizeFormatted: formatBytes(totalSize) }, null, 2))
        return
      }

      log.info(`Total: ${formatBytes(totalSize)}`)
      log.info('')

      let selected: string[]

      if (options.all) {
        selected = installers.map(f => f.path)
      }
      else {
        const result = await multiselect({
          message: 'Select installer files to remove:',
          options: installers.map(f => ({
            value: f.path,
            label: f.name,
            hint: `${formatBytes(f.sizeBytes).padStart(10)} — ${f.source}`,
          })),
          required: true,
        })

        if (!Array.isArray(result) || result.length === 0) {
          outro('Cancelled')
          return
        }
        selected = result as string[]
      }

      const selectedFiles = installers.filter(f => selected.includes(f.path))
      const selectedSize = selectedFiles.reduce((sum, f) => sum + f.sizeBytes, 0)

      if (!options.all) {
        const ok = await confirm({
          message: `Remove ${selectedFiles.length} file(s) (${formatBytes(selectedSize)})?`,
        })
        if (!ok) {
          outro('Cancelled')
          return
        }
      }

      // Move to trash (safer than rm)
      s.start('Moving to Trash...')
      let freed = 0

      for (const file of selectedFiles) {
        try {
          if (!options.dryRun) {
            // Use Finder to move to Trash (recoverable)
            const escapedPath = file.path.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
            await exec(`osascript -e 'tell application "Finder" to delete POSIX file "${escapedPath}"'`, { timeout: 10_000 })
          }
          freed += file.sizeBytes
        }
        catch {
          // Fallback to rm
          try {
            if (!options.dryRun)
              fs.unlinkSync(file.path)
            freed += file.sizeBytes
          }
          catch { /* skip */ }
        }
      }
      s.stop('Done')

      if (options.dryRun) {
        log.info(`[DRY RUN] Would free: ${formatBytes(freed)}`)
      }
      else {
        log.success(`Moved ${selectedFiles.length} file(s) to Trash — freed ${formatBytes(freed)}`)
      }

      outro('Done')
    })
}
