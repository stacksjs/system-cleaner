/**
 * Bringing the VPN up and down, which needs root.
 *
 * Creating a network interface is privileged, so this follows the elevation
 * path the app already uses for system launch agents: one narrow command run
 * through `osascript ... with administrator privileges`, which puts macOS's
 * own authorization dialog in front of the user. No helper daemon is
 * installed, nothing runs as root between connections, and every connect is
 * individually authorized by the person at the keyboard.
 *
 * That is the same line `packages/uninstall` draws — elevate for a bounded,
 * legible operation, never for a broad one. Bulk deletion still refuses and
 * points at Terminal.
 *
 * ## Why the inputs are validated rather than escaped
 *
 * The command ends up inside two nested quotings: a shell string, itself
 * inside an AppleScript double-quoted literal. Escaping alone has to be
 * perfect twice. So every value is first checked against a strict pattern and
 * rejected outright if it does not match — a coordinator URL is a scheme, host
 * and optional port and nothing else, a key is base64 and nothing else — and
 * only then shell-quoted and AppleScript-escaped. An attacker-supplied value
 * has to survive all three to reach a shell.
 *
 * The CLI path is never taken from the caller. It comes from `readCore`,
 * which resolves it from PATH or `LOCALTUNNELS_BIN`.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { appleScriptEscape, exec, shellEscape } from '@system-cleaner/core'
import { readCore } from './status'

/** Where the privileged command records the tunnel's process id. */
export function pidFile(): string {
  return path.join(os.homedir(), 'Library', 'Application Support', 'SystemCleaner', 'vpn.pid')
}

/** Where the tunnel's output goes, so a failed connect can say why. */
export function logFile(): string {
  return path.join(os.homedir(), 'Library', 'Application Support', 'SystemCleaner', 'vpn.log')
}

export interface ConnectRequest {
  /** Coordinator WebSocket URL. */
  coordinatorUrl: string
  /** Shared secret, when the coordinator requires one. */
  authKey?: string
  /** Exit node: a base64 public key, or `auto`. */
  useExit?: string
}

/**
 * A coordinator URL: scheme, host, optional port. Nothing else.
 *
 * Deliberately narrower than a URL parser would accept — no path, query,
 * fragment or userinfo, because none of them mean anything to the coordinator
 * and each is somewhere for a payload to hide.
 */
const COORDINATOR_URL = /^wss?:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*(?::\d{1,5})?$/i

/** base64url, as `vpn:coordinator` mints auth keys. */
const AUTH_KEY = /^[\w-]{1,128}$/

/** A 32-byte key in standard base64, as every public key in this system is. */
const PUBLIC_KEY = /^[\w+/]{42}[\w+/=]=$/

export type Validated = { ok: true, request: Required<Pick<ConnectRequest, 'coordinatorUrl'>> & ConnectRequest } | { ok: false, error: string }

/** Check a connect request, rejecting anything that is not exactly in shape. */
export function validateConnectRequest(input: unknown): Validated {
  if (typeof input !== 'object' || input === null)
    return { ok: false, error: 'Expected a connection request' }
  const r = input as Record<string, unknown>

  if (typeof r.coordinatorUrl !== 'string' || !COORDINATOR_URL.test(r.coordinatorUrl))
    return { ok: false, error: 'Coordinator must be a ws:// or wss:// host, with an optional port' }

  if (r.authKey !== undefined && r.authKey !== '') {
    if (typeof r.authKey !== 'string' || !AUTH_KEY.test(r.authKey))
      return { ok: false, error: 'Auth key must be base64url text' }
  }

  if (r.useExit !== undefined && r.useExit !== '') {
    if (typeof r.useExit !== 'string')
      return { ok: false, error: 'Exit node must be a public key or "auto"' }
    if (r.useExit !== 'auto' && !PUBLIC_KEY.test(r.useExit))
      return { ok: false, error: 'Exit node must be a public key or "auto"' }
  }

  return {
    ok: true,
    request: {
      coordinatorUrl: r.coordinatorUrl,
      ...(r.authKey ? { authKey: r.authKey as string } : {}),
      ...(r.useExit ? { useExit: r.useExit as string } : {}),
    },
  }
}

/**
 * The shell command that brings the tunnel up.
 *
 * Backgrounded, because `do shell script` waits for what it runs and a tunnel
 * does not exit. The pid is written where {@link disconnect} can find it and
 * the output where a failed connect can be read from.
 *
 * Pure, so the exact string reaching the shell is covered by tests.
 */
export function buildConnectCommand(cli: string, req: ConnectRequest): string {
  const args = ['vpn:up', '--coordinator', req.coordinatorUrl]
  if (req.authKey)
    args.push('--auth-key', req.authKey)
  if (req.useExit)
    args.push('--use-exit', req.useExit)

  const quoted = [cli, ...args].map(shellEscape).join(' ')
  const log = shellEscape(logFile())
  const pid = shellEscape(pidFile())
  return `nohup ${quoted} > ${log} 2>&1 & echo $! > ${pid}`
}

/** The shell command that takes it down again. */
export function buildDisconnectCommand(pid: number): string {
  return `kill ${pid}`
}

/** Wrap a shell command in the macOS authorization prompt. */
export function buildElevatedCommand(shellCommand: string): string {
  return `osascript -e 'do shell script "${appleScriptEscape(shellCommand)}" with administrator privileges'`
}

export interface ControlResult {
  success: boolean
  error?: string
}

/** Bring the tunnel up, prompting for authorization. */
export async function connect(input: unknown): Promise<ControlResult> {
  const checked = validateConnectRequest(input)
  if (!checked.ok)
    return { success: false, error: checked.error }

  const core = readCore()
  if (!core.available || !core.cliPath)
    return { success: false, error: core.detail || 'No localtunnels CLI found' }

  const running = await connectionPid()
  if (running !== null)
    return { success: false, error: `A tunnel is already running (pid ${running})` }

  fs.mkdirSync(path.dirname(pidFile()), { recursive: true })
  const command = buildElevatedCommand(buildConnectCommand(core.cliPath, checked.request))

  const result = await exec(command, { timeout: 120_000 })
  if (!result.ok)
    return formatOsaError(result.stderr || 'Could not start the tunnel')

  // The interface takes a moment; report what the log says if it died at once.
  await new Promise(r => setTimeout(r, 1200))
  const pid = await connectionPid()
  if (pid === null)
    return { success: false, error: lastLogLine() || 'The tunnel exited immediately' }

  return { success: true }
}

/** Take the tunnel down, prompting for authorization. */
export async function disconnect(): Promise<ControlResult> {
  const pid = await connectionPid()
  if (pid === null) {
    clearPidFile()
    return { success: true }
  }

  const result = await exec(buildElevatedCommand(buildDisconnectCommand(pid)), { timeout: 60_000 })
  if (!result.ok)
    return formatOsaError(result.stderr || 'Could not stop the tunnel')

  clearPidFile()
  return { success: true }
}

/**
 * The pid of the tunnel this app started, or null.
 *
 * A recorded pid is not trusted on its own: pids are reused, and killing a
 * stale one would kill whatever inherited the number. The process is confirmed
 * to still be the localtunnels CLI before it counts as running, which is also
 * what makes a crashed tunnel report as disconnected rather than as running.
 */
export async function connectionPid(): Promise<number | null> {
  let raw: string
  try {
    raw = fs.readFileSync(pidFile(), 'utf8').trim()
  }
  catch {
    return null
  }
  if (!/^\d{1,10}$/.test(raw))
    return null

  const pid = Number(raw)
  if (pid <= 1)
    return null

  const ps = await exec(`ps -o command= -p ${pid}`, { timeout: 5000 })
  if (!ps.ok || !ps.stdout.trim())
    return null
  return looksLikeTunnel(ps.stdout, readCore().cliPath) ? pid : null
}

/**
 * Whether a `ps` command line is the tunnel this app started.
 *
 * Matched against the resolved CLI path rather than its name. The CLI ships as
 * both `localtunnels` and `lt`, and `lt` is far too common a word to accept on
 * its own — `looksLikeTunnel('vim lt vpn:up')` has no business being true.
 * When the path is unknown the basename is accepted, but `vpn:up` is always
 * required, so no ordinary `localtunnels start` is ever mistaken for a tunnel.
 */
export function looksLikeTunnel(commandLine: string, cliPath?: string | null): boolean {
  if (!/(?:^|\s)vpn:up(?:\s|$)/.test(commandLine))
    return false
  if (cliPath)
    return commandLine.includes(cliPath)
  return /(?:^|[\s/])(?:localtunnels|lt)(?:\s|$)/.test(commandLine)
}

function clearPidFile(): void {
  try {
    fs.unlinkSync(pidFile())
  }
  catch {
    // Already gone, or never written.
  }
}

/** The last non-empty line of the tunnel log, for a failure message. */
export function lastLogLine(): string | null {
  try {
    const lines = fs.readFileSync(logFile(), 'utf8').split('\n').map(l => l.trim()).filter(Boolean)
    return lines.length > 0 ? lines[lines.length - 1].slice(0, 200) : null
  }
  catch {
    return null
  }
}

/** Turn an osascript failure into something worth showing someone. */
export function formatOsaError(message: string): ControlResult {
  if (message.includes('User canceled') || message.includes('-128'))
    return { success: false, error: 'Cancelled' }
  if (message.includes('authorization'))
    return { success: false, error: 'Authorization failed' }
  return { success: false, error: message.slice(0, 160) || 'Operation failed' }
}
