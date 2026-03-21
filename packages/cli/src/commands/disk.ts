import type { CLI } from '@stacksjs/clapp'
import { scanDirectory, findLargestFiles, analyzeByCategory, findProjectArtifacts } from '@system-cleaner/disk'
import { formatBytes, HOME } from '@system-cleaner/core'

export function registerDiskCommand(app: CLI): void {
  app.command('disk [path]', 'Analyze disk usage, find large files, and discover reclaimable space')
    .option('-d, --depth <depth>', 'Maximum scan depth', { default: 4 })
    .option('-t, --top <count>', 'Number of largest files to show', { default: 20 })
    .option('--category', 'Show usage by file category')
    .option('--artifacts', 'Find project build artifacts (node_modules, target, etc.)')
    .option('--json', 'Output results as JSON')
    .action(async (targetPath: string | undefined, options: any) => {
      const { spinner, log, intro, outro } = await import('@stacksjs/clapp')

      intro('System Cleaner — Disk Analyzer')

      const scanPath = targetPath || HOME

      if (options.artifacts) {
        const s = spinner()
        s.start('Scanning for project build artifacts...')
        const artifacts = await findProjectArtifacts()
        s.stop(`Found ${artifacts.length} artifact(s)`)

        if (artifacts.length === 0) {
          log.info('No project artifacts found.')
          outro('Done')
          return
        }

        const totalSize = artifacts.reduce((sum, a) => sum + a.sizeBytes, 0)

        if (options.json) {
          console.log(JSON.stringify({ artifacts, totalSize }, null, 2))
          return
        }

        log.info(`Total reclaimable: ${formatBytes(totalSize)}`)
        log.info('')

        for (const artifact of artifacts) {
          const sizeStr = formatBytes(artifact.sizeBytes).padStart(10)
          const typeStr = artifact.type.padEnd(14)
          log.info(`  ${sizeStr}  ${typeStr}  ${artifact.projectName}/${artifact.path.split('/').pop()}`)
        }

        outro(`${artifacts.length} artifacts — ${formatBytes(totalSize)} reclaimable`)
        return
      }

      // Full disk scan
      const depth = Number.parseInt(options.depth) || 4
      const topCount = Number.parseInt(options.top) || 20

      const s = spinner()
      s.start(`Scanning ${scanPath}...`)

      const result = scanDirectory(scanPath, {
        maxDepth: depth,
        timeoutMs: 30_000,
        onProgress: (count, current) => {
          if (count % 1000 === 0)
            s.message(`Scanned ${count} items...`)
        },
      })

      const timeStr = result.scanTimeMs < 1000
        ? `${result.scanTimeMs}ms`
        : `${(result.scanTimeMs / 1000).toFixed(1)}s`

      s.stop(`Scanned ${result.totalFiles} files, ${result.totalFolders} folders in ${timeStr}${result.aborted ? ' (aborted — timeout)' : ''}`)

      if (options.json) {
        console.log(JSON.stringify({
          path: scanPath,
          totalSize: result.tree.sizeBytes,
          totalSizeFormatted: formatBytes(result.tree.sizeBytes),
          totalFiles: result.totalFiles,
          totalFolders: result.totalFolders,
          scanTimeMs: result.scanTimeMs,
          largestFiles: findLargestFiles(result.tree, topCount),
        }, null, 2))
        return
      }

      // Show top-level breakdown
      log.info('')
      log.info(`Total: ${formatBytes(result.tree.sizeBytes)}`)
      log.info('')

      const topDirs = result.tree.children?.slice(0, 15) || []
      for (const dir of topDirs) {
        const sizeStr = formatBytes(dir.sizeBytes).padStart(10)
        const pctStr = result.tree.sizeBytes > 0
          ? `${Math.round((dir.sizeBytes / result.tree.sizeBytes) * 100)}%`.padStart(4)
          : '  0%'
        const icon = dir.isDirectory ? '📁' : '📄'
        log.info(`  ${sizeStr} ${pctStr}  ${icon} ${dir.name}`)
      }

      // Show category breakdown if requested
      if (options.category) {
        log.info('')
        log.info('Usage by file type:')
        const categories = analyzeByCategory(result.tree)
        for (const cat of categories.slice(0, 12)) {
          const sizeStr = formatBytes(cat.sizeBytes).padStart(10)
          log.info(`  ${sizeStr} ${cat.percentage}%  ${cat.icon} ${cat.label} (${cat.fileCount} files)`)
        }
      }

      // Show largest files
      log.info('')
      log.info(`Top ${topCount} largest files:`)
      const largeFiles = findLargestFiles(result.tree, topCount)
      for (const file of largeFiles) {
        const sizeStr = formatBytes(file.sizeBytes).padStart(10)
        // Shorten path for display
        const shortPath = file.path.replace(HOME, '~')
        log.info(`  ${sizeStr}  ${shortPath}`)
      }

      outro(`Scan complete — ${formatBytes(result.tree.sizeBytes)} analyzed`)
    })
}
