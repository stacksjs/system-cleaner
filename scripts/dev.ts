#!/usr/bin/env bun
// Dev wrapper that frees ports + kills stale `stx dev` runs before handing off.
//
// Why: a previous run that didn't shut down cleanly (terminal closed,
// SIGKILL, crash) will keep holding ports — including broadcasting on 6001,
// where stx silently degrades to a warning if its port is busy. We identify
// stale stx runs by command line (this workspace's pantry symlink) and kill
// them first, then sweep the named ports + poll until they're bindable on
// both IPv4 and IPv6 so the freshly-spawned stx finds them clean.

import * as net from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

const PORT = 3456
const BROADCAST_PORT = 6001
const CWD = process.cwd()
const STX_MARKER = path.join(CWD, 'pantry/@stacksjs/stx')

interface Holder { pid: number, command: string }

function findStaleDevProcesses(): Holder[] {
  const r = spawnSync('ps', ['-ax', '-o', 'pid=,command='], { encoding: 'utf8' })
  if (r.status !== 0 || !r.stdout) return []
  const out: Holder[] = []
  const self = process.pid
  for (const line of r.stdout.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(.+)$/)
    if (!m) continue
    const pid = Number.parseInt(m[1], 10)
    const command = m[2]
    if (pid === self) continue
    if (command.includes(STX_MARKER) && /\bdev\b/.test(command)) {
      out.push({ pid, command })
    }
  }
  return out
}

function findPortHolders(port: number): Holder[] {
  const r = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpc'], { encoding: 'utf8' })
  if (r.status !== 0 || !r.stdout) return []
  const out: Holder[] = []
  let pid = 0
  for (const line of r.stdout.split('\n').filter(Boolean)) {
    if (line.startsWith('p')) pid = Number.parseInt(line.slice(1), 10) || 0
    else if (line.startsWith('c') && pid) out.push({ pid, command: line.slice(1) })
  }
  return out
}

function isOursByCmd(cmd: string): boolean {
  return /^(stx|bun|node)$/i.test(cmd)
}

function killAll(holders: Holder[], label: string): void {
  for (const h of holders) {
    console.warn(`[dev] killing ${label} ${h.command} (pid ${h.pid})`)
    try { process.kill(h.pid, 'SIGTERM') } catch {}
  }
}

// 1. Kill stale STX dev runs from this workspace, regardless of which port
//    they ended up listening on.
const stale = findStaleDevProcesses()
if (stale.length > 0) {
  killAll(stale, 'stale stx dev')
  await Bun.sleep(300)
  const survivors = findStaleDevProcesses()
  for (const h of survivors) {
    try { process.kill(h.pid, 'SIGKILL') } catch {}
  }
  if (survivors.length > 0) await Bun.sleep(200)
}

// 2. Sweep the named ports as a safety net (covers non-STX-pantry STX or
//    other tools holding our ports).
for (const port of [PORT, BROADCAST_PORT]) {
  const holders = findPortHolders(port)
  if (holders.length === 0) continue
  const ours = holders.filter(h => isOursByCmd(h.command))
  const theirs = holders.filter(h => !isOursByCmd(h.command))
  if (theirs.length > 0) {
    console.error(`[dev] port ${port} is in use by:`)
    for (const t of theirs) console.error(`        pid=${t.pid} cmd=${t.command}`)
    console.error(`[dev] free it before running \`bun run dev\``)
    process.exit(1)
  }
  killAll(ours, `port-${port} holder`)
  await Bun.sleep(300)
  for (const h of findPortHolders(port)) {
    try { process.kill(h.pid, 'SIGKILL') } catch {}
  }
}

// 3. Wait until each named port is bindable on both IPv4 and IPv6 — STX's
//    own check fails if either family is busy, and kernel socket release can
//    lag behind process exit. Fixed sleeps were flaky; poll instead.
async function isBindable(port: number, host: string): Promise<boolean> {
  return await new Promise<boolean>(resolve => {
    const srv = net.createServer()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => srv.close(() => resolve(true)))
    srv.listen(port, host)
  })
}

async function waitForFree(port: number, deadlineMs: number): Promise<boolean> {
  const end = Date.now() + deadlineMs
  while (Date.now() < end) {
    if (await isBindable(port, '0.0.0.0') && await isBindable(port, '::'))
      return true
    await Bun.sleep(100)
  }
  return false
}

for (const port of [PORT, BROADCAST_PORT]) {
  if (!await waitForFree(port, 5000)) {
    console.error(`[dev] port ${port} did not free up after kill — aborting`)
    process.exit(1)
  }
}

// Clear STX cache (preserves prior behavior)
try { fs.rmSync('.stx', { recursive: true, force: true }) } catch {}

// Locate the stx CLI. The pantry symlink (`pantry/.bin/stx`) is the
// fast path on this machine, but `pantry/` is gitignored so a fresh
// clone won't have it. Fall back to the bun-hoisted node_modules copy
// before giving up. Last resort: trust PATH.
function resolveStxCommand(): { cmd: string, args: string[] } {
  const candidates = [
    path.join(CWD, 'pantry/@stacksjs/stx/dist/cli.js'),
    path.join(CWD, 'node_modules/.bun/node_modules/@stacksjs/stx/dist/cli.js'),
    path.join(CWD, 'node_modules/@stacksjs/stx/dist/cli.js'),
  ]
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isFile()) return { cmd: 'bun', args: [c] }
    }
    catch {}
  }
  return { cmd: 'stx', args: [] }
}

const stx = resolveStxCommand()
const child = spawn(stx.cmd, [...stx.args, 'dev', '--port', String(PORT)], { stdio: 'inherit' })
child.on('exit', code => process.exit(code ?? 0))
