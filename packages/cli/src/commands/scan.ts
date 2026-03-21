import type { CLI } from '@stacksjs/clapp'
import { scanExistingTargets, CLEAN_TARGETS } from '@system-cleaner/clean'
import { collectSnapshot, createCollectorState } from '@system-cleaner/monitor'
import { discoverStartupItems } from '@system-cleaner/uninstall'
import { formatBytes, formatPercent, getSystemInfo } from '@system-cleaner/core'

export function registerScanCommand(app: CLI): void {
  app.command('scan', 'Quick system health scan and cleanup recommendations')
    .option('--json', 'Output as JSON')
    .action(async (options: any) => {
      const { spinner, log, intro, outro } = await import('@stacksjs/clapp')

      intro('System Cleaner — System Scan')

      const s = spinner()

      // Phase 1: System info
      s.start('Collecting system information...')
      const sysInfo = await getSystemInfo()
      s.stop(`${sysInfo.modelName || sysInfo.cpuModel} — macOS ${sysInfo.macosVersion}`)

      // Phase 2: System metrics
      s.start('Analyzing system health...')
      const state = createCollectorState()
      const snapshot = await collectSnapshot(state)
      s.stop(`Health score: ${snapshot.health.score}/100 (${snapshot.health.label})`)

      // Phase 3: Cleanable space
      s.start('Scanning for reclaimable space...')
      const cleanResults = await scanExistingTargets(CLEAN_TARGETS)
      const totalCleanable = cleanResults.reduce((sum, r) => sum + r.sizeBytes, 0)
      s.stop(`Found ${formatBytes(totalCleanable)} reclaimable space`)

      // Phase 4: Startup items
      s.start('Scanning startup items...')
      const startupItems = discoverStartupItems()
      const enabledStartup = startupItems.filter(i => !i.disabled)
      const thirdPartyStartup = enabledStartup.filter(i => i.category !== 'system')
      s.stop(`${enabledStartup.length} startup items (${thirdPartyStartup.length} third-party)`)

      if (options.json) {
        console.log(JSON.stringify({
          systemInfo: sysInfo,
          health: snapshot.health,
          metrics: {
            cpu: snapshot.cpu.usagePercent,
            memory: snapshot.memory.usagePercent,
            disk: snapshot.diskIo.partitions[0]?.usedPercent || 0,
          },
          reclaimableBytes: totalCleanable,
          startupItems: startupItems.length,
          enabledStartupItems: enabledStartup.length,
          cleanableItems: cleanResults.map(r => ({
            name: r.target.name,
            category: r.target.category,
            sizeBytes: r.sizeBytes,
          })),
        }, null, 2))
        return
      }

      // Print report
      log.info('')
      log.info('──── System Report ────────────────────')
      log.info('')

      log.info(`  CPU:      ${formatPercent(snapshot.cpu.usagePercent)} (${snapshot.cpu.logicalCores} cores)`)
      log.info(`  Memory:   ${formatBytes(snapshot.memory.usedBytes)} / ${formatBytes(snapshot.memory.totalBytes)} (${formatPercent(snapshot.memory.usagePercent)})`)

      for (const p of snapshot.diskIo.partitions) {
        log.info(`  Disk:     ${formatBytes(p.usedBytes)} / ${formatBytes(p.totalBytes)} (${formatPercent(p.usedPercent)}) — ${formatBytes(p.freeBytes)} free`)
      }

      if (snapshot.battery) {
        log.info(`  Battery:  ${formatPercent(snapshot.battery.chargePercent)} health: ${formatPercent(snapshot.battery.healthPercent)}`)
      }

      log.info('')
      log.info('──── Recommendations ─────────────────')
      log.info('')

      // Recommendations based on findings
      if (totalCleanable > 1e9) {
        log.warn(`  ${formatBytes(totalCleanable)} of reclaimable space found — run 'system-cleaner clean'`)
      }
      else if (totalCleanable > 100e6) {
        log.info(`  ${formatBytes(totalCleanable)} of reclaimable space found`)
      }
      else {
        log.success('  Disk is clean — minimal reclaimable space')
      }

      if (thirdPartyStartup.length > 10) {
        log.warn(`  ${thirdPartyStartup.length} third-party startup items — consider disabling some`)
      }

      if (snapshot.memory.usagePercent > 85) {
        log.warn(`  Memory pressure high (${formatPercent(snapshot.memory.usagePercent)})`)
      }

      if (snapshot.health.factors.length > 0) {
        for (const f of snapshot.health.factors) {
          log.warn(`  -${f.impact} ${f.name}: ${f.description}`)
        }
      }

      if (snapshot.health.score >= 80 && totalCleanable < 500e6 && thirdPartyStartup.length <= 10) {
        log.success('  System is in good shape!')
      }

      // Top 5 cleanable categories
      if (cleanResults.length > 0) {
        log.info('')
        log.info('──── Top Reclaimable ─────────────────')
        log.info('')
        for (const r of cleanResults.slice(0, 8)) {
          log.info(`  ${r.sizeFormatted.padStart(10)}  ${r.target.icon} ${r.target.name}`)
        }
      }

      outro(`Score: ${snapshot.health.score}/100 — ${formatBytes(totalCleanable)} reclaimable`)
    })
}
