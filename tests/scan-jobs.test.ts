import { afterEach, expect, it } from 'bun:test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { ScanJobs } from '../app/Workers/scan-jobs'
import { terminateScanProcess } from '../app/Workers/scan-pool'
import { ScanSessions } from '../resources/lib/scan-sessions'
import type { ScanSession } from '../app/Workers/scan-jobs'

const waitFor = async (predicate: () => boolean) => {
  const deadline = Date.now() + 5000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for scan state')
    await Bun.sleep(10)
  }
}

it('cancels running work, retains its last snapshot, and starts the next job after shutdown', async () => {
  let stopped = false
  const jobs = new ScanJobs<string>(async (request, signal, publish) => {
    if (request === 'second') {
      expect(stopped).toBe(true)
      return { success: true }
    }
    publish({ scanned: 25, path: '/fixture/one', measuredBytes: 42, snapshot: { success: true, files: [{ path: '/fixture/one', sizeBytes: 42 }] } })
    await new Promise<void>(resolve => signal.addEventListener('abort', () => {
      setTimeout(() => { stopped = true; resolve() }, 20)
    }))
    throw new DOMException('Cancelled', 'AbortError')
  })
  const first = jobs.start('large-files', 'first', { path: '/fixture', minSizeMB: 1 })
  const second = jobs.start('tree', 'second')
  await waitFor(() => jobs.sessions()[0].status === 'running')
  const id = jobs.sessions()[0].id
  const cancelling = jobs.cancel(id)
  expect(jobs.sessions()[0].status).toBe('cancelling')
  expect(jobs.sessions()[1].status).toBe('queued')
  await cancelling
  expect(await first).toMatchObject({ cancelled: true, scanned: 25, files: [{ path: '/fixture/one', sizeBytes: 42 }] })
  await second
  expect(jobs.sessions()[0]).toMatchObject({ status: 'cancelled', parameters: { path: '/fixture', minSizeMB: 1 }, progress: { scanned: 25 } })
  expect(stopped).toBe(true)
})

it('cancels queued work immediately without launching it or stopping another scan', async () => {
  let release!: () => void
  const launched: string[] = []
  const jobs = new ScanJobs<string>(async request => {
    launched.push(request)
    if (request === 'running') await new Promise<void>(resolve => { release = resolve })
    return { success: true }
  })
  const running = jobs.start('tree', 'running')
  const queued = jobs.start('duplicates', 'queued')
  await waitFor(() => launched.length === 1)
  const previousId = jobs.sessions()[1].id
  await jobs.cancel(previousId)
  expect((await queued).cancelled).toBe(true)
  expect(jobs.sessions()[0].status).toBe('running')
  const replacement = jobs.start('duplicates', 'replacement')
  expect(await jobs.cancel(previousId)).toBe(null)
  release()
  await Promise.all([running, replacement])
  expect(launched).toEqual(['running', 'replacement'])
  expect(jobs.sessions()[1].status).toBe('completed')
})

it('retains completed results without a navigation TTL and joins duplicate starts', async () => {
  let release!: () => void
  const jobs = new ScanJobs<string>(async () => {
    await new Promise<void>(resolve => { release = resolve })
    return { success: true, matched: 3 }
  })
  const first = jobs.start('large-files', 'first')
  const joined = jobs.start('large-files', 'second')
  expect(joined).toBe(first)
  await waitFor(() => !!release)
  release()
  await first
  const snapshot = jobs.sessions()[0]
  snapshot.status = 'failed'
  expect(jobs.sessions()[0]).toMatchObject({ status: 'completed', result: { matched: 3 } })
})

it('terminates a scanner and its subprocesses, including children ignoring SIGTERM', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cleaner-process-test-'))
  const ready = path.join(root, 'ready')
  const childCode = `require('node:fs').writeFileSync(${JSON.stringify(ready)},String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000)`
  const code = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:'ignore'});process.on('SIGTERM',()=>{});setInterval(()=>{},1000)`
  const proc = spawn(process.execPath, ['-e', code], { detached: process.platform !== 'win32', stdio: 'ignore' })
  try {
    await waitFor(() => fs.existsSync(ready))
    const childPid = Number(fs.readFileSync(ready, 'utf8'))
    const closed = once(proc, 'close')
    await terminateScanProcess(proc)
    await closed
    await waitFor(() => {
      try { process.kill(childPid, 0); return false }
      catch { return true }
    })
    expect(proc.exitCode !== null || proc.signalCode !== null).toBe(true)
  }
  finally {
    await terminateScanProcess(proc)
    fs.rmSync(root, { recursive: true, force: true })
  }
})

const clients: ScanSessions[] = []
afterEach(() => clients.splice(0).forEach(client => client.dispose()))
it('reattaches a new page to the same progress and options, and retains cancelled results', async () => {
  let session: ScanSession = { id: 'scan-1', kind: 'large-files', status: 'running', parameters: { path: 'Movies', minSizeMB: 1 }, createdAt: Date.now(), startedAt: Date.now(), progress: { scanned: 50, path: '/fixture/Movies', measuredBytes: 100, snapshot: { success: true, matched: 2 } } }
  let cancelledId = ''
  const client = new ScanSessions((async (url, options) => {
    if (url === '/api/cancel-scan') {
      cancelledId = JSON.parse(String(options!.body)).id
      session = { ...session, status: 'cancelled', finishedAt: Date.now(), result: { ...session.progress.snapshot, success: true, cancelled: true } }
      return Response.json({ success: true, scan: session })
    }
    return Response.json({ success: true, scans: [session] })
  }) as typeof fetch)
  clients.push(client)
  let shown: ScanSession | undefined
  const detach = client.subscribe('large-files', value => { shown = value })
  await client.refresh()
  expect(shown).toMatchObject({ id: 'scan-1', progress: { scanned: 50 } })
  detach()
  session = { ...session, progress: { ...session.progress, scanned: 250 } }
  await client.refresh()
  client.subscribe('large-files', value => { shown = value })
  expect(shown).toMatchObject({ parameters: { path: 'Movies', minSizeMB: 1 }, progress: { scanned: 250 } })
  await client.cancel('large-files')
  expect(cancelledId).toBe('scan-1')
  expect(shown).toMatchObject({ status: 'cancelled', result: { matched: 2, cancelled: true } })
})
