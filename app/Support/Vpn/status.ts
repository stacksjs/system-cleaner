/**
 * Read-only view of the localtunnels VPN on this Mac.
 *
 * Everything here observes and nothing acts: no interface is created, no key
 * is generated, nothing is asked for a password. That is the whole point of
 * this first pass — the panel can tell you what is true right now without the
 * privileged helper that bringing a tunnel *up* will need.
 *
 * Two consequences worth knowing when reading the output:
 *
 *  - Identity is **read, never created**. `lt vpn:keygen` would mint a keypair
 *    on first use, which is the right behaviour for a command someone typed
 *    and the wrong behaviour for a screen they happened to open. A machine
 *    with no identity reports none.
 *  - A tunnel interface cannot be attributed to this app. The kernel does not
 *    record which process asked for a `utun`, and macOS hands them out to
 *    iCloud Private Relay and every other VPN as well. So an interface is
 *    reported as *falling in a range localtunnels assigns*, which is a strong
 *    hint and not proof.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import process from 'node:process'
import { execSyncResult, isMacOS, TtlCache } from '@system-cleaner/core'

/** The CLI, if one could be found and made to answer. */
export interface VpnCore {
  available: boolean
  /** Path of the CLI that answered. */
  cliPath: string | null
  /** Version it reported. */
  version: string | null
  /**
   * Whether `vpn:selftest` passed: the native `libltvpn` loaded and a
   * handshake, an encrypted roundtrip and replay rejection all worked. Null
   * when there was no CLI to ask.
   */
  healthy: boolean | null
  /** Why the core is unavailable, when it is. */
  detail: string | null
}

export interface VpnIdentity {
  /** base64 X25519 public key — shareable, and what peers authorize. */
  publicKey: string
  publicKeyPath: string
}

export interface TunnelInterface {
  name: string
  address: string
  /** Point-to-point remote, which macOS utun interfaces carry. */
  peer: string | null
  mtu: number | null
  /**
   * The address falls in a range localtunnels assigns. A hint, not proof —
   * see the note at the top of this file.
   */
  localtunnelsRange: boolean
}

export interface VpnStatus {
  core: VpnCore
  identity: VpnIdentity | null
  tunnels: TunnelInterface[]
  /** At least one interface is up in a range localtunnels assigns. */
  connected: boolean
  /** Whether this platform can host a localtunnels tunnel at all. */
  supported: boolean
}

/**
 * Ranges localtunnels hands out, used to guess which `utun` is a localtunnels
 * tunnel rather than someone else's.
 *
 * `100.64.0.0/10` is the carrier-grade NAT block from RFC 6598, which the
 * coordinator allocates from (its default `100.100.0.0/16` sits inside it) —
 * the same choice Tailscale made, and for the same reason: it is routable
 * space nobody uses on a LAN. `10.8.0.0/24` is what the VPN deploy configures.
 */
const TUNNEL_RANGES: { cidr: string, base: number, mask: number }[] = [
  '100.64.0.0/10',
  '10.8.0.0/24',
].map((cidr) => {
  const [addr, prefix] = cidr.split('/')
  const bits = Number.parseInt(prefix)
  const mask = bits === 0 ? 0 : (0xFFFFFFFF << (32 - bits)) >>> 0
  return { cidr, base: (ipToInt(addr) & mask) >>> 0, mask }
})

/**
 * Finding and interrogating the CLI costs a process spawn and, for the
 * selftest, about a second of crypto. Neither answer changes while the app is
 * open unless someone installs or removes it.
 */
const coreCache = new TtlCache<VpnCore>(60_000)

/** `~/.localtunnels/vpn`, honouring the same override the CLI reads. */
export function vpnDir(): string {
  const base = process.env.LOCALTUNNELS_HOME || path.join(os.homedir(), '.localtunnels')
  return path.join(base, 'vpn')
}

/**
 * This machine's VPN identity, or null when it has none.
 *
 * Only the public half is read. The private key sits next to it at 0600 and
 * this app has no reason to open it.
 */
export function readIdentity(): VpnIdentity | null {
  const publicKeyPath = path.join(vpnDir(), 'publickey')
  try {
    const publicKey = fs.readFileSync(publicKeyPath, 'utf8').trim()
    return publicKey ? { publicKey, publicKeyPath } : null
  }
  catch {
    return null
  }
}

/**
 * Locate the localtunnels CLI.
 *
 * `LOCALTUNNELS_BIN` wins, so a checkout can be pointed at without installing
 * anything. Otherwise both names it ships under are looked up on PATH.
 */
function findCli(): string | null {
  const explicit = process.env.LOCALTUNNELS_BIN
  if (explicit) {
    try {
      fs.accessSync(explicit, fs.constants.X_OK)
      return explicit
    }
    catch {
      return null
    }
  }
  for (const name of ['localtunnels', 'lt']) {
    const found = execSyncResult(`command -v ${name}`, { timeout: 2000 })
    if (found.ok && found.stdout)
      return found.stdout.split('\n')[0].trim()
  }
  return null
}

/** Find the CLI and ask it whether its native core is healthy. */
export function readCore(): VpnCore {
  const cached = coreCache.get('core')
  if (cached)
    return cached

  const cliPath = findCli()
  if (!cliPath) {
    const core: VpnCore = {
      available: false,
      cliPath: null,
      version: null,
      healthy: null,
      detail: 'No localtunnels CLI on PATH. Install it, or set LOCALTUNNELS_BIN to a built binary.',
    }
    coreCache.set('core', core)
    return core
  }

  // Probed from a neutral directory. The CLI is a compiled Bun binary, and Bun
  // reads `bunfig.toml` from the working directory — so probing it from inside
  // this project made it inherit *this* app's preload and fail with
  // `preload not found "@stacksjs/env/plugin.js"`. The health of someone
  // else's binary must not depend on where this app happens to be running.
  const at = { cwd: os.tmpdir() }
  const version = execSyncResult(`${quote(cliPath)} --version`, { ...at, timeout: 5000 })
  // `vpn:selftest` needs no root: it runs entirely in-process.
  const selftest = execSyncResult(`${quote(cliPath)} vpn:selftest`, { ...at, timeout: 20_000 })
  const healthy = selftest.ok && /VPN core is healthy/i.test(selftest.stdout)

  const core: VpnCore = {
    available: true,
    cliPath,
    version: version.ok ? version.stdout.split('\n')[0].trim() || null : null,
    healthy,
    detail: healthy
      ? null
      : (selftest.stderr || selftest.stdout || '').split('\n').filter(Boolean).slice(-1)[0]
        || 'vpn:selftest did not report a healthy core.',
  }
  coreCache.set('core', core)
  return core
}

/**
 * Tunnel-shaped interfaces currently up, newest-looking first.
 *
 * Read from `ifconfig`, which needs no privileges. Only point-to-point `utun`
 * and `tun` devices with an IPv4 address are considered; everything else on
 * the machine is somebody else's business.
 */
export function readTunnels(): TunnelInterface[] {
  if (!isMacOS) {
    // `ip -o addr` on Linux; not reachable from the desktop bundle today, so
    // left unimplemented rather than guessed at.
    return []
  }
  const out = execSyncResult('ifconfig -a', { timeout: 5000 })
  return out.ok ? parseIfconfig(out.stdout) : []
}

/**
 * Pull tunnel interfaces out of `ifconfig -a` output.
 *
 * Split from the command so the parsing is testable against fixed output:
 * a developer Mac has a row of `utun` devices belonging to iCloud Private
 * Relay and whatever VPN is installed, none of which carry an IPv4 address,
 * so running this live proves very little.
 *
 * Only IPv4 is considered. A localtunnels tunnel in coordinator mode is
 * assigned a v4 address, and the link-local `inet6 fe80::` every utun carries
 * says nothing about whether the interface is in use.
 */
export function parseIfconfig(output: string): TunnelInterface[] {
  const tunnels: TunnelInterface[] = []
  let name: string | null = null
  let mtu: number | null = null

  for (const line of output.split('\n')) {
    const header = line.match(/^([a-z0-9]+):\s.*?mtu\s+(\d+)/i)
    if (header) {
      name = header[1]
      mtu = Number.parseInt(header[2])
      continue
    }
    if (!name || !/^(?:utun|tun)\d+$/.test(name))
      continue
    // `inet 100.100.0.2 --> 100.100.0.1 netmask 0xffff0000`
    const inet = line.match(/^\s*inet\s+(\d+\.\d+\.\d+\.\d+)(?:\s+-->\s+(\d+\.\d+\.\d+\.\d+))?/)
    if (!inet)
      continue
    tunnels.push({
      name,
      address: inet[1],
      peer: inet[2] ?? null,
      mtu,
      localtunnelsRange: inTunnelRange(inet[1]),
    })
  }

  // Ours first, so a panel showing one line shows the relevant one.
  return tunnels.sort((a, b) => Number(b.localtunnelsRange) - Number(a.localtunnelsRange))
}

/** The whole read-only picture. */
export function readVpnStatus(): VpnStatus {
  const tunnels = readTunnels()
  return {
    core: readCore(),
    identity: readIdentity(),
    tunnels,
    connected: tunnels.some(t => t.localtunnelsRange),
    supported: isMacOS,
  }
}

/** Drop the cached CLI probe, for an explicit refresh. */
export function invalidateVpnCache(): void {
  coreCache.clear()
}

function inTunnelRange(address: string): boolean {
  const value = ipToInt(address)
  return TUNNEL_RANGES.some(r => ((value & r.mask) >>> 0) === r.base)
}

function ipToInt(ip: string): number {
  const o = ip.split('.').map(Number)
  if (o.length !== 4 || o.some(n => Number.isNaN(n) || n < 0 || n > 255))
    return -1
  return (((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0)
}

/** Shell-quote a path so a space in it cannot split the command. */
function quote(p: string): string {
  return `'${p.replace(/'/g, `'\\''`)}'`
}
