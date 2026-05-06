#!/usr/bin/env bun
// Dev wrapper that frees port 3456 before handing off to `stx dev`.
//
// Why: `stx dev` silently rolls to a different port (3456 → 34560) when 3456
// is busy. That breaks anything pointed at the documented URL — including the
// /api/* routes the broadcasting/WebSocket clients hard-code in `channels.ts`.
// This wrapper detects the conflict, identifies the holder, and either kills a
// stale `stx` process on the same port or refuses to start so the user can
// take action.

import { spawn, spawnSync } from 'node:child_process'
import * as fs from 'node:fs'

const PORT = 3456

function findHolders(): { pid: number, command: string }[] {
  const r = spawnSync('lsof', ['-nP', `-iTCP:${PORT}`, '-sTCP:LISTEN', '-Fpc'], { encoding: 'utf8' })
  if (r.status !== 0 || !r.stdout) return []
  const lines = r.stdout.split('\n').filter(Boolean)
  const out: { pid: number, command: string }[] = []
  let pid = 0
  for (const line of lines) {
    if (line.startsWith('p')) pid = Number.parseInt(line.slice(1), 10) || 0
    else if (line.startsWith('c') && pid) out.push({ pid, command: line.slice(1) })
  }
  return out
}

function isOurStaleStx(cmd: string): boolean {
  // Treat any prior `stx`/`bun`/`node` running our dev server as stale. Refuse
  // to kill anything else so the user notices another tool is using the port.
  return /^(stx|bun|node)$/i.test(cmd)
}

const holders = findHolders()
if (holders.length > 0) {
  const ours = holders.filter(h => isOurStaleStx(h.command))
  const theirs = holders.filter(h => !isOurStaleStx(h.command))
  if (theirs.length > 0) {
    console.error(`[dev] port ${PORT} is in use by:`)
    for (const t of theirs) console.error(`        pid=${t.pid} cmd=${t.command}`)
    console.error(`[dev] free it before running \`bun run dev\``)
    process.exit(1)
  }
  for (const h of ours) {
    console.warn(`[dev] killing stale ${h.command} (pid ${h.pid}) on port ${PORT}`)
    try { process.kill(h.pid, 'SIGTERM') } catch {}
  }
  // Give the OS a beat to release the socket
  await Bun.sleep(300)
  if (findHolders().length > 0) {
    for (const h of findHolders()) {
      try { process.kill(h.pid, 'SIGKILL') } catch {}
    }
    await Bun.sleep(200)
  }
}

// Clear STX cache (preserves prior behavior)
try { fs.rmSync('.stx', { recursive: true, force: true }) } catch {}

const child = spawn('stx', ['dev', '--port', String(PORT)], { stdio: 'inherit' })
child.on('exit', code => process.exit(code ?? 0))
