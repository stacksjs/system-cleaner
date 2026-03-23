import type { ChannelRegistrar } from '@stacksjs/stx'
import { getTopProcesses, summarizeProcesses } from '@system-cleaner/monitor'

export default function ({ channel }: ChannelRegistrar) {
  channel('processes', {
    interval: 3000,

    async data() {
      const procs = await getTopProcesses(20)
      const summary = summarizeProcesses(procs)

      return {
        processes: procs.map(p => ({
          id: `proc-${p.pid}`,
          pid: p.pid,
          name: p.name,
          fullCommand: p.fullCommand,
          user: p.user,
          cpu: p.cpuPercent,
          memMB: p.memoryMB,
          isSystem: p.isSystem,
        })),
        totalCPU: summary.totalCpuPercent,
        totalMemUsed: summary.totalMemoryMB,
      }
    },
  })
}
