import { expect, it } from 'bun:test'
import { createProcessShutdown } from '../app/Support/Runtime/process-shutdown'
import type { OwnedProcess } from '../app/Support/Runtime/process-shutdown'

function child(ignoreTerm = false) {
  let exited = false
  let resolve!: (code: number) => void
  const signals: string[] = []
  const process: OwnedProcess = {
    exited: new Promise(done => { resolve = done }),
    kill(signal = 'SIGTERM') {
      if (exited) throw new Error('Already gone')
      signals.push(signal)
      if (signal === 'SIGKILL' || !ignoreTerm) { exited = true; resolve(0) }
    },
  }
  return { process, signals, exit() { exited = true; resolve(0) } }
}
it('stops both the agent and the native window during a restart, exactly once', async () => {
  const agent = child()
  const craft = child()
  const shutdown = createProcessShutdown(() => [agent.process, craft.process])
  const first = shutdown.stop()
  expect(shutdown.stop()).toBe(first)
  await first
  expect(agent.signals).toEqual(['SIGTERM'])
  expect(craft.signals).toEqual(['SIGTERM'])
  shutdown.force()
  expect(craft.signals).toHaveLength(1)
})
it('waits for a native process that ignores SIGTERM and force-stops it', async () => {
  const agent = child()
  const craft = child(true)
  const shutdown = createProcessShutdown(() => [agent.process, craft.process], 10)
  let finished = false
  const stopped = shutdown.stop().then(() => { finished = true })
  expect(finished).toBe(false)
  expect(craft.signals).toEqual(['SIGTERM'])
  await stopped
  expect(craft.signals).toEqual(['SIGTERM', 'SIGKILL'])
})
it('handles a window that already quit and a launcher still starting its agent', async () => {
  const agent = child()
  agent.exit()
  const shutdown = createProcessShutdown(() => [agent.process], 10)
  await shutdown.stop()
  shutdown.force()
  expect(agent.signals).toEqual([])
})
