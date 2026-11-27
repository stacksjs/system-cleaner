import type { TunnelInterface, VpnIdentity } from './status'
import * as fs from 'node:fs'
import * as path from 'node:path'
import process from 'node:process'
import { exec, isMacOS, shellEscape } from '@system-cleaner/core'
import { readCore, readTunnels, vpnDir } from './status'

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
const COORDINATOR_URL = /^wss?:\/\/(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*|\[[a-f0-9:.]+\])(?::([0-9]{1,5}))?$/i

/** base64url, as `vpn:coordinator` mints auth keys. */
const AUTH_KEY = /^[\w-]{1,128}$/

/** A 32-byte key in standard base64, as every public key in this system is. */
const PUBLIC_KEY = /^[a-z0-9+/]{43}=$/i

export type Validated = { ok: true, request: Required<Pick<ConnectRequest, 'coordinatorUrl'>> & ConnectRequest } | { ok: false, error: string }

/** Check a connect request, rejecting anything that is not exactly in shape. */
export function validateConnectRequest(input: unknown): Validated {
  if (typeof input !== 'object' || input === null)
    return { ok: false, error: 'Expected a connection request' }
  const r = input as Record<string, unknown>

  const coordinatorUrl = typeof r.coordinatorUrl === 'string' ? r.coordinatorUrl.trim() : ''
  const match = COORDINATOR_URL.exec(coordinatorUrl)
  if (!match || coordinatorUrl.length > 270 || (match[1] && Number(match[1]) === 0) || !URL.canParse(coordinatorUrl))
    return { ok: false, error: 'Enter a ws:// or wss:// coordinator address with a valid host and port.' }

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
      coordinatorUrl,
      ...(r.authKey ? { authKey: r.authKey as string } : {}),
      ...(r.useExit ? { useExit: r.useExit as string } : {}),
    },
  }
}

export interface ControlResult {
  success: boolean
  error?: string
}

export interface ManagedConnection {
  pid: number
  coordinatorUrl: string
  mode: 'mesh' | 'exit'
  tunnel: TunnelInterface | null
}

const ROOT = `/private/var/db/org.stacksjs.system-cleaner.vpn.${process.getuid?.()}`
const SESSION = path.join(ROOT, 'session')
const LOG = path.join(ROOT, 'tunnel.log')
const READY = path.join(ROOT, 'ready')
const PUBLIC = path.join(ROOT, 'publickey')
const IDENTITY = path.join(ROOT, 'vpn')
const RESTORE = path.join(IDENTITY, 'restore.json')
const PS = 'LC_ALL=C /bin/ps -o uid=,lstart= -p'
const FULL_TUNNEL_READY = 'full tunnel: default route and DNS via '
const INTERFACE_LINE = /^\s*Interface:\s+(utun\d+) \(([\d.]+)\/\d+,/m

/**
 * The elevated shell owns the process record and logs. The live process must
 * still have the recorded UID and start time when the shell sends a signal.
 */
function sessionScript(): string[] {
  return [
    `state=${shellEscape(ROOT)}`,
    `session=${shellEscape(SESSION)}`,
    `check_session() { { IFS= read -r pid; IFS= read -r started; } 2>/dev/null < "$session" || return 1; case "$pid" in ""|*[!0-9]*) return 1;; esac; [ "$pid" -gt 1 ] && [ "$(${PS} "$pid" 2>/dev/null)" = "$started" ]; }`,
    'same_session() { check_session && [ "$pid" = "$expected" ]; }',
    'wait_for_exit() { attempt=0; while same_session && [ "$attempt" -lt "$1" ]; do /bin/sleep 0.25; attempt=$((attempt + 1)); done; }',
    'stop_session() { if same_session; then /bin/kill -TERM "$pid"; wait_for_exit 32; fi; if same_session; then /bin/kill -KILL "$pid"; wait_for_exit 8; fi; if same_session; then echo "The VPN process could not be stopped." >&2; return 1; fi; }',
  ]
}

function vpnCommand(cli: string, args: string[], authKey?: string): string {
  const env = [
    'PATH=/usr/bin:/bin:/usr/sbin:/sbin',
    `HOME=${ROOT}`,
    `LOCALTUNNELS_HOME=${ROOT}`,
  ]
  if (authKey)
    env.push(`LOCALTUNNELS_AUTH_KEY=${authKey}`)
  if (process.env.LTVPN_LIB)
    env.push(`LTVPN_LIB=${path.resolve(process.env.LTVPN_LIB)}`)
  return `/usr/bin/env -i ${[...env, cli, ...args].map(shellEscape).join(' ')}`
}

function restoreNetwork(cli?: string | null): string {
  const restore = cli
    ? `cd "$state" && ${vpnCommand(cli, ['vpn:down'])} >> "${LOG}" 2>&1`
    : 'false'
  return `if [ -f ${shellEscape(RESTORE)} ]; then ${restore} || { echo "The previous VPN network settings could not be restored." >&2; exit 1; }; fi`
}

export function buildConnectCommand(cli: string, request: ConnectRequest): string {
  const args = ['vpn:up', '--coordinator', request.coordinatorUrl]
  if (request.useExit)
    args.push('--use-exit', request.useExit, '--full-tunnel')

  const key = path.join(IDENTITY, 'privatekey')
  const userKey = path.join(vpnDir(), 'privatekey')
  const readAsUser = `/usr/bin/sudo -n -u ${shellEscape(`#${process.getuid?.()}`)} /bin/cat ${shellEscape(userKey)}`
  return [
    'umask 077',
    ...sessionScript(),
    '/bin/mkdir -p -m 755 "$state"',
    '[ "$( /usr/bin/stat -f %u "$state" )" = 0 ] && [ ! -L "$state" ] || exit 1',
    '/bin/mkdir "$state/starting" || exit 1',
    'trap \'/bin/rmdir "$state/starting"\' EXIT',
    'if check_session; then echo "A VPN session is already running." >&2; exit 1; fi',
    'cd "$state" || exit 1',
    restoreNetwork(cli),
    `/bin/mkdir -p -m 711 ${shellEscape(IDENTITY)}`,
    // Import the existing key as the signed-in user, while keeping the root
    // client's network-restore files in its own directory.
    `if [ ! -f ${shellEscape(key)} ] && key=$(${readAsUser} 2>/dev/null); then if printf '%s' "$key" | /usr/bin/grep -Eq '^[A-Za-z0-9+/]{43}=$'; then printf '%s\n' "$key" > ${shellEscape(key)}; fi; fi`,
    `log=${shellEscape(LOG)}`,
    `ready=${shellEscape(READY)}`,
    `public=${shellEscape(PUBLIC)}`,
    '/bin/rm -f "$ready"',
    ': > "$log" && /bin/chmod 644 "$log" || exit 1',
    // macOS nohup tries to detach from a console that the authorization
    // service does not have. Ignore SIGHUP and close its IO in the child.
    `(trap '' HUP; exec ${vpnCommand(cli, args, request.authKey)}) < /dev/null > "$log" 2>&1 & pid=$!`,
    'expected=$pid',
    `started=$(${PS} "$pid")`,
    `printf '%s\n' "$pid" "$started" ${shellEscape(request.coordinatorUrl)} ${request.useExit ? 'exit' : 'mesh'} > "$session.new" && /bin/chmod 644 "$session.new" && /bin/mv -f "$session.new" "$session" || { kill "$pid"; exit 1; }`,
    'attempt=0',
    `while check_session && [ "$attempt" -lt 48 ]; do if /usr/bin/grep -q '^ *Interface: *utun' "$log"${request.useExit ? ` && /usr/bin/grep -Fq ${shellEscape(FULL_TUNNEL_READY)} "$log"` : ''}; then /usr/bin/grep -m 1 '^ *Interface: *utun' "$log" > "$ready" && /bin/chmod 644 "$ready" || exit 1; /usr/bin/awk '/^ *Public key: +[A-Za-z0-9+\\/]+=$/ {print $NF; exit}' "$log" > "$public" && /bin/chmod 644 "$public"; exit 0; fi; /bin/sleep 0.5; attempt=$((attempt + 1)); done`,
    'stop_session || exit 1',
    restoreNetwork(cli),
    'exit 1',
  ].join('; ')
}

export function buildDisconnectCommand(expectedPid: number | null, cli?: string | null): string {
  return [
    'umask 077',
    ...sessionScript(),
    '/bin/mkdir "$state/starting" || exit 1',
    'trap \'/bin/rmdir "$state/starting"\' EXIT',
    `expected=${expectedPid ?? 0}`,
    'if check_session && [ "$pid" != "$expected" ]; then echo "The VPN session changed. Refresh its status and try again." >&2; exit 1; fi',
    'stop_session || exit 1',
    restoreNetwork(cli),
  ].join('; ')
}

export function buildAuthorizationScript(command: string): string {
  const escaped = command.replace(/[\\"]/g, character => `\\${character}`).replace(/\n/g, '\\n')
  return `do shell script "${escaped}" with administrator privileges`
}

async function authorize(command: string): Promise<ControlResult> {
  const child = Bun.spawn(['/usr/bin/osascript', '-'], {
    stdin: new Blob([buildAuthorizationScript(command)]),
    stdout: 'ignore',
    stderr: 'pipe',
  })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    child.kill()
  }, 150_000)
  try {
    const stderr = await new Response(child.stderr).text()
    const exitCode = await child.exited
    if (timedOut)
      return { success: false, error: 'VPN authorization timed out. Try again when you can respond to the macOS prompt.' }
    return exitCode === 0 ? { success: true } : formatOsaError(stderr)
  }
  finally {
    clearTimeout(timer)
  }
}

function readRootFile(file: string, maxBytes: number): string {
  try {
    const directory = fs.lstatSync(ROOT)
    if (directory.uid !== 0 || !directory.isDirectory())
      return ''
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
    try {
      const stat = fs.fstatSync(fd)
      if (stat.uid !== 0 || !stat.isFile())
        return ''
      const contents = Buffer.alloc(Math.min(stat.size, maxBytes))
      const bytes = fs.readSync(fd, contents, 0, contents.length, Math.max(0, stat.size - maxBytes))
      return contents.toString('utf8', 0, bytes)
    }
    finally {
      fs.closeSync(fd)
    }
  }
  catch {
    return ''
  }
}

export async function readManagedConnection(tunnels?: TunnelInterface[]): Promise<ManagedConnection | null> {
  const [pidText, started, coordinatorUrl, mode] = readRootFile(SESSION, 1024).trimEnd().split('\n')
  const pid = Number(pidText)
  if (!/^\d{1,10}$/.test(pidText) || pid <= 1)
    return null
  if (!started?.trimStart().startsWith('0 ') || (mode !== 'mesh' && mode !== 'exit'))
    return null
  const live = await exec(`${PS} ${pid}`, { timeout: 3000 })
  if (!live.ok || live.stdout !== started.trim())
    return null

  const [, device, address] = readRootFile(READY, 200).match(INTERFACE_LINE) || []
  const tunnel = address && device ? (tunnels ?? await readTunnels()).find(t => t.name === device && t.address === address) || null : null
  return { pid, coordinatorUrl, mode, tunnel }
}

export function hasPendingVpnRestore(): boolean {
  try {
    const file = fs.lstatSync(RESTORE)
    return file.uid === 0 && file.isFile()
  }
  catch {
    return false
  }
}

export function readManagedIdentity(): VpnIdentity | null {
  const publicKey = readRootFile(PUBLIC, 100).trim()
  return PUBLIC_KEY.test(publicKey) ? { publicKey, publicKeyPath: PUBLIC } : null
}

let operation: 'connect' | 'disconnect' | 'install' | null = null

export function vpnOperation(): typeof operation {
  return operation
}

export async function runVpnOperation(kind: NonNullable<typeof operation>, run: () => Promise<ControlResult>): Promise<ControlResult> {
  if (!isMacOS)
    return { success: false, error: 'VPN control is available on macOS.' }
  if (operation)
    return { success: false, error: 'Another VPN operation is already in progress.' }

  operation = kind
  try {
    return await run()
  }
  finally {
    operation = null
  }
}

export async function connect(input: unknown): Promise<ControlResult> {
  const checked = validateConnectRequest(input)
  if (!checked.ok)
    return { success: false, error: checked.error }

  return runVpnOperation('connect', async () => {
    if (await readManagedConnection())
      return { success: false, error: 'Disconnect the current VPN session before connecting again.' }

    const core = await readCore()
    if (!core.healthy || !core.cliPath)
      return { success: false, error: core.detail || 'The Localtunnels core is unavailable.' }

    const previousLog = readRootFile(LOG, 64 * 1024)
    const result = await authorize(buildConnectCommand(core.cliPath, checked.request))
    if (!result.success && result.error === 'Cancelled')
      return result
    if ((await readManagedConnection())?.tunnel)
      return { success: true }

    const log = readRootFile(LOG, 64 * 1024)
    const failure = log !== previousLog && log.split('\n').find(line => /vpn up failed:|full tunnel failed|^.*(?:Permission denied|No such file or directory)$/i.test(line))
    if (failure) {
      const key = checked.request.authKey
      return { success: false, error: (key ? failure.replaceAll(key, '[redacted]') : failure).trim().slice(0, 240) }
    }

    const error = log !== previousLog
      ? checked.request.useExit
        ? 'The exit node did not become ready. Check that a trusted exit is online and reachable.'
        : 'The VPN interface did not come up. Check the coordinator address and auth key.'
      : result.error
    return { success: false, error: error || 'The VPN interface did not come up.' }
  })
}

export async function disconnect(): Promise<ControlResult> {
  return runVpnOperation('disconnect', async () => {
    const session = await readManagedConnection()
    if (!session && !hasPendingVpnRestore())
      return { success: true }

    const cli = session?.mode === 'exit' || hasPendingVpnRestore() ? (await readCore()).cliPath : null
    const result = await authorize(buildDisconnectCommand(session?.pid ?? null, cli))
    if (!result.success)
      return result
    return await readManagedConnection()
      ? { success: false, error: 'The VPN is still shutting down. Try again in a moment.' }
      : { success: true }
  })
}

export function formatOsaError(message: string): ControlResult {
  if (/user cancel[el]*d|-128\b/i.test(message))
    return { success: false, error: 'Cancelled' }
  for (const detail of [
    'The VPN process could not be stopped.',
    'The VPN session changed. Refresh its status and try again.',
    'The previous VPN network settings could not be restored.',
  ]) {
    if (message.includes(detail))
      return { success: false, error: detail }
  }
  if (/authorization/i.test(message))
    return { success: false, error: 'Authorization failed' }
  return { success: false, error: 'macOS could not complete the VPN operation.' }
}
