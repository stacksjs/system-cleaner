import { describe, expect, it } from 'bun:test'
import { parseIfconfig, readIdentity, vpnDir } from '../app/Support/Vpn/status'

/**
 * The VPN panel's read-only status.
 *
 * `parseIfconfig` is tested against fixed output because a developer Mac is a
 * poor fixture: it carries a row of `utun` devices for iCloud Private Relay
 * and whatever VPN is installed, none of which have an IPv4 address, so a live
 * run exercises almost none of this.
 */

// A real `ifconfig -a` excerpt: system utuns with only link-local v6, a
// localtunnels tunnel on a coordinator-assigned address, an unrelated VPN on
// an address of its own, and a non-tunnel interface that must be ignored.
const IFCONFIG = `lo0: flags=8049<UP,LOOPBACK,RUNNING,MULTICAST> mtu 16384
	inet 127.0.0.1 netmask 0xff000000
en0: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500
	inet 192.168.1.42 netmask 0xffffff00 broadcast 192.168.1.255
utun0: flags=8051<UP,POINTOPOINT,RUNNING,MULTICAST> mtu 1380
	inet6 fe80::f464:fb95:2c56:ce19%utun0 prefixlen 64 scopeid 0x10
	nd6 options=201<PERFORMNUD,DAD>
utun3: flags=8051<UP,POINTOPOINT,RUNNING,MULTICAST> mtu 1400
	inet 10.99.0.6 --> 10.99.0.1 netmask 0xffffff00
utun4: flags=8051<UP,POINTOPOINT,RUNNING,MULTICAST> mtu 1420
	inet6 fe80::8a62:4e66:7555:c952%utun4 prefixlen 64 scopeid 0x16
	inet 100.100.0.2 --> 100.100.0.1 netmask 0xffff0000
	nd6 options=201<PERFORMNUD,DAD>
`

describe('vpn/status', () => {
  describe('parseIfconfig', () => {
    const tunnels = parseIfconfig(IFCONFIG)

    it('finds only tunnel interfaces that carry an IPv4 address', () => {
      expect(tunnels.map(t => t.name).sort()).toEqual(['utun3', 'utun4'])
    })

    it('ignores loopback and ethernet, which also have inet lines', () => {
      expect(tunnels.some(t => t.name === 'lo0' || t.name === 'en0')).toBe(false)
    })

    it('ignores a utun that only has link-local IPv6', () => {
      expect(tunnels.some(t => t.name === 'utun0')).toBe(false)
    })

    it('reads the address, point-to-point remote and MTU', () => {
      const ours = tunnels.find(t => t.name === 'utun4')!
      expect(ours.address).toBe('100.100.0.2')
      expect(ours.peer).toBe('100.100.0.1')
      expect(ours.mtu).toBe(1420)
    })

    it('recognises a coordinator-assigned address as a localtunnels range', () => {
      expect(tunnels.find(t => t.name === 'utun4')!.localtunnelsRange).toBe(true)
    })

    it('does not claim an unrelated VPN on a different range', () => {
      expect(tunnels.find(t => t.name === 'utun3')!.localtunnelsRange).toBe(false)
    })

    it('sorts localtunnels-range interfaces first', () => {
      expect(tunnels[0].name).toBe('utun4')
    })

    it('recognises the deploy default range too', () => {
      const parsed = parseIfconfig(`utun7: flags=8051<UP,POINTOPOINT,RUNNING> mtu 1420\n\tinet 10.8.0.2 --> 10.8.0.1 netmask 0xffffff00\n`)
      expect(parsed[0].localtunnelsRange).toBe(true)
    })

    it('treats a near-miss of the CGNAT block as not ours', () => {
      // 100.128.0.0 is just past 100.64.0.0/10.
      const parsed = parseIfconfig(`utun7: flags=8051<UP,POINTOPOINT,RUNNING> mtu 1420\n\tinet 100.128.0.2 --> 100.128.0.1 netmask 0xffff0000\n`)
      expect(parsed[0].localtunnelsRange).toBe(false)
    })

    it('survives empty and junk input', () => {
      expect(parseIfconfig('')).toEqual([])
      expect(parseIfconfig('not ifconfig output at all')).toEqual([])
    })
  })

  describe('identity', () => {
    it('points at the directory the CLI uses', () => {
      expect(vpnDir()).toMatch(/\.localtunnels\/vpn$/)
    })

    it('reads a public key, or reports none, without ever creating one', () => {
      const before = Bun.file(`${vpnDir()}/privatekey`).size
      const identity = readIdentity()
      // Reading status must never mint a keypair as a side effect.
      expect(Bun.file(`${vpnDir()}/privatekey`).size).toBe(before)
      if (identity !== null) {
        expect(identity.publicKey.length).toBeGreaterThan(0)
        expect(identity.publicKeyPath).toMatch(/publickey$/)
      }
    })
  })
})
