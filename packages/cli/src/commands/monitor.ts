import type { CLI } from '@stacksjs/clapp'
import { collectSnapshot, createCollectorState, startMonitoring } from '@system-cleaner/monitor'
import { formatBytes, formatRate, formatPercent, formatUptime, getSystemInfo } from '@system-cleaner/core'

export function registerMonitorCommand(app: CLI): void {
  app.command('monitor', 'Live system monitoring — CPU, GPU, memory, disk, network stats')
    .alias('status')
    .option('-i, --interval <ms>', 'Refresh interval in milliseconds', { default: 2000 })
    .option('--cpu', 'Show CPU metrics only')
    .option('--memory', 'Show memory metrics only')
    .option('--disk', 'Show disk metrics only')
    .option('--network', 'Show network metrics only')
    .option('--gpu', 'Show GPU metrics only')
    .option('--battery', 'Show battery metrics only')
    .option('--processes', 'Show top processes only')
    .option('--json', 'Output as JSON (single snapshot)')
    .option('--once', 'Collect a single snapshot and exit')
    .action(async (options: any) => {
      const { log, intro, outro, spinner } = await import('@stacksjs/clapp')

      const state = createCollectorState()

      // JSON mode: single snapshot
      if (options.json || options.once) {
        const s = spinner()
        s.start('Collecting system metrics...')

        // Collect twice to get rate data
        await collectSnapshot(state, { intervalMs: 1000 })
        await new Promise(resolve => setTimeout(resolve, 1100))
        const snapshot = await collectSnapshot(state)
        s.stop('Done')

        if (options.json) {
          // eslint-disable-next-line no-console
          console.log(JSON.stringify(snapshot, null, 2))
          return
        }

        printSnapshot(snapshot, options, log)
        return
      }

      // Live monitoring mode
      intro('System Cleaner — Live Monitor')

      const sysInfo = await getSystemInfo()
      log.info(`${sysInfo.modelName || sysInfo.cpuModel} — macOS ${sysInfo.macosVersion}`)
      log.info(`Uptime: ${formatUptime(sysInfo.uptimeSeconds)}`)
      log.info('')
      log.info('Press Ctrl+C to stop monitoring')
      log.info('')

      const intervalMs = Number.parseInt(options.interval) || 2000

      const { stop } = startMonitoring({
        intervalMs,
        includeCpu: !hasSpecificFilter(options) || options.cpu,
        includeMemory: !hasSpecificFilter(options) || options.memory,
        includeDisk: !hasSpecificFilter(options) || options.disk,
        includeNetwork: !hasSpecificFilter(options) || options.network,
        includeGpu: !hasSpecificFilter(options) || options.gpu,
        includeBattery: !hasSpecificFilter(options) || options.battery,
        includeProcesses: !hasSpecificFilter(options) || options.processes,
        onSnapshot: (snapshot) => {
          // Clear screen and redraw
          process.stdout.write('\x1B[2J\x1B[H')
          printSnapshot(snapshot, options, log)
        },
      })

      // Handle Ctrl+C gracefully
      process.on('SIGINT', () => {
        stop()
        outro('Monitoring stopped')
        process.exit(0)
      })
    })
}

function hasSpecificFilter(options: any): boolean {
  return options.cpu || options.memory || options.disk || options.network || options.gpu || options.battery || options.processes
}

function printSnapshot(snapshot: any, options: any, log: any): void {
  const showAll = !hasSpecificFilter(options)

  // Health score header
  const health = snapshot.health
  log.info(`Health: ${health.score}/100 (${health.label})`)
  if (health.factors.length > 0) {
    for (const f of health.factors)
      log.info(`  -${f.impact} ${f.name}: ${f.description}`)
  }
  log.info('')

  // CPU
  if (showAll || options.cpu) {
    const cpu = snapshot.cpu
    log.info(`CPU: ${formatPercent(cpu.usagePercent)} — ${cpu.modelName}`)
    log.info(`  Cores: ${cpu.logicalCores} logical, ${cpu.physicalCores} physical`)
    if (cpu.performanceCores > 0)
      log.info(`  P-cores: ${cpu.performanceCores}, E-cores: ${cpu.efficiencyCores}`)
    log.info(`  Load: ${cpu.loadAvg1.toFixed(2)} / ${cpu.loadAvg5.toFixed(2)} / ${cpu.loadAvg15.toFixed(2)}`)
    if (cpu.temperature)
      log.info(`  Temperature: ${cpu.temperature.toFixed(1)}°C`)
    log.info('')
  }

  // Memory
  if (showAll || options.memory) {
    const mem = snapshot.memory
    log.info(`Memory: ${formatBytes(mem.usedBytes)} / ${formatBytes(mem.totalBytes)} (${formatPercent(mem.usagePercent)})`)
    log.info(`  Active: ${formatBytes(mem.activeBytes)}, Wired: ${formatBytes(mem.wiredBytes)}, Compressed: ${formatBytes(mem.compressedBytes)}`)
    if (mem.swapUsedBytes > 0)
      log.info(`  Swap: ${formatBytes(mem.swapUsedBytes)} / ${formatBytes(mem.swapTotalBytes)}`)
    log.info(`  Pressure: ${mem.pressure}`)
    log.info('')
  }

  // Disk
  if (showAll || options.disk) {
    for (const p of snapshot.diskIo.partitions) {
      log.info(`Disk (${p.mountPoint}): ${formatBytes(p.usedBytes)} / ${formatBytes(p.totalBytes)} (${formatPercent(p.usedPercent)})`)
      log.info(`  Free: ${formatBytes(p.freeBytes)}`)
      if (p.readBytesPerSec > 0 || p.writeBytesPerSec > 0)
        log.info(`  I/O: R ${formatRate(p.readBytesPerSec)} / W ${formatRate(p.writeBytesPerSec)}`)
    }
    log.info('')
  }

  // Network
  if (showAll || options.network) {
    const activeInterfaces = snapshot.network.interfaces.filter((i: any) => i.isUp)
    if (activeInterfaces.length > 0) {
      log.info('Network:')
      for (const iface of activeInterfaces) {
        const ip = iface.ipAddress ? ` (${iface.ipAddress})` : ''
        log.info(`  ${iface.name}${ip}: ↓ ${formatRate(iface.rxBytesPerSec)} / ↑ ${formatRate(iface.txBytesPerSec)}`)
      }
      log.info('')
    }
  }

  // GPU
  if ((showAll || options.gpu) && snapshot.gpu) {
    const gpu = snapshot.gpu
    log.info(`GPU: ${gpu.model} — ${formatPercent(gpu.usagePercent)}`)
    if (gpu.vramMB > 0) log.info(`  VRAM: ${gpu.vramMB} MB`)
    if (gpu.temperature) log.info(`  Temperature: ${gpu.temperature.toFixed(1)}°C`)
    log.info('')
  }

  // Battery
  if ((showAll || options.battery) && snapshot.battery) {
    const bat = snapshot.battery
    log.info(`Battery: ${formatPercent(bat.chargePercent)} — ${bat.isCharging ? 'Charging' : bat.isPowerConnected ? 'AC Power' : 'On Battery'}`)
    log.info(`  Health: ${formatPercent(bat.healthPercent)} (${bat.healthStatus}), Cycles: ${bat.cycleCount}`)
    if (bat.timeRemainingMinutes > 0) {
      const h = Math.floor(bat.timeRemainingMinutes / 60)
      const m = bat.timeRemainingMinutes % 60
      log.info(`  Time remaining: ${h}h ${m}m`)
    }
    log.info('')
  }

  // Top processes
  if ((showAll || options.processes) && snapshot.processes.length > 0) {
    log.info('Top Processes:')
    log.info('  PID       CPU    MEM     Name')
    for (const proc of snapshot.processes.slice(0, 10)) {
      const pid = String(proc.pid).padStart(7)
      const cpu = `${proc.cpuPercent.toFixed(1)}%`.padStart(6)
      const mem = `${proc.memoryMB}MB`.padStart(6)
      log.info(`  ${pid} ${cpu} ${mem}     ${proc.name}`)
    }
  }
}
