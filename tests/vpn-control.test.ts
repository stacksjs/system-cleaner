import { describe, expect, it } from 'bun:test'
import {
  buildConnectCommand,
  buildDisconnectCommand,
  buildAuthorizationScript,
  formatOsaError,
  validateConnectRequest,
} from '../app/Support/Vpn/control'

/**
 * Bringing the VPN up runs a command as root through macOS's authorization
 * prompt, so the value of these tests is almost entirely in what gets
 * *rejected*. The command ends up inside a shell string inside an AppleScript
 * literal; anything that survives validation has two quotings left to defeat.
 */

const CLI = '/usr/local/bin/localtunnels'
const OK = 'ws://coordinator.example:51821'

describe('vpn/control', () => {
  describe('validateConnectRequest', () => {
    it('accepts a plain coordinator URL', () => {
      expect(validateConnectRequest({ coordinatorUrl: OK }).ok).toBe(true)
      expect(validateConnectRequest({ coordinatorUrl: 'wss://vpn.example.com' }).ok).toBe(true)
      expect(validateConnectRequest({ coordinatorUrl: 'ws://127.0.0.1:51821' }).ok).toBe(true)
    })

    it('rejects anything that is not a bare scheme, host and port', () => {
      for (const url of [
        'ws://host/path',
        'ws://host?q=1',
        'ws://host#frag',
        'ws://host:0',
        'ws://host:65536',
        'ws://user:pass@host',
        'http://host',
        'host:51821',
        'ws://',
        '',
      ])
        expect(validateConnectRequest({ coordinatorUrl: url }).ok).toBe(false)
    })

    it('rejects a URL carrying shell or AppleScript metacharacters', () => {
      // Each of these would be an injection if the value were only escaped.
      for (const url of [
        'ws://host;rm -rf /',
        'ws://host$(whoami)',
        'ws://host`id`',
        'ws://host|cat',
        'ws://host&&id',
        'ws://host"',
        'ws://host\\"',
        "ws://host'",
        'ws://host\nid',
      ])
        expect(validateConnectRequest({ coordinatorUrl: url }).ok).toBe(false)
    })

    it('accepts a base64url auth key and rejects anything else', () => {
      expect(validateConnectRequest({ coordinatorUrl: OK, authKey: 'aB3-_xyz' }).ok).toBe(true)
      for (const key of ['has space', 'has"quote', 'has;semi', 'has$(sub)', 'a'.repeat(129)])
        expect(validateConnectRequest({ coordinatorUrl: OK, authKey: key }).ok).toBe(false)
    })

    it('accepts "auto" or a public key for the exit node', () => {
      const key = `${'A'.repeat(42)}0=`
      expect(validateConnectRequest({ coordinatorUrl: OK, useExit: 'auto' }).ok).toBe(true)
      expect(validateConnectRequest({ coordinatorUrl: OK, useExit: key }).ok).toBe(true)
      for (const bad of ['AUTO', 'auto;id', 'nope', `${'A'.repeat(60)}=`])
        expect(validateConnectRequest({ coordinatorUrl: OK, useExit: bad }).ok).toBe(false)
    })

    it('treats empty optional fields as absent rather than invalid', () => {
      const r = validateConnectRequest({ coordinatorUrl: OK, authKey: '', useExit: '' })
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.request.authKey).toBeUndefined()
        expect(r.request.useExit).toBeUndefined()
      }
    })

    it('rejects non-objects outright', () => {
      for (const input of [null, undefined, 'string', 42, []])
        expect(validateConnectRequest(input).ok).toBe(false)
    })
  })

  describe('VPN commands', () => {
    it('quotes executable paths, detaches the tunnel, and waits for the interface', () => {
      const command = buildConnectCommand('/Applications/My App/localtunnels', { coordinatorUrl: OK })
      expect(command).toContain(`'/Applications/My App/localtunnels' 'vpn:up' '--coordinator' '${OK}'`)
      expect(command).toContain("(trap '' HUP; exec /usr/bin/env -i")
      expect(command).toContain('< /dev/null > "$log" 2>&1 &')
      expect(command).toContain('pid=$!')
      expect(command).toContain("'--listen' '0'")
      expect(command).toContain('Interface: *utun')
      expect(command).not.toContain('--full-tunnel')
    })

    it('waits for traffic routing when an exit node is requested', () => {
      const command = buildConnectCommand(CLI, { coordinatorUrl: OK, authKey: 'k-1', useExit: 'auto' })
      expect(command).toContain("'LOCALTUNNELS_AUTH_KEY=k-1'")
      expect(command).toContain("'--use-exit' 'auto' '--full-tunnel'")
      expect(command).toContain('full tunnel: default route and DNS via ')
    })

    it('round-trips the shell command through an AppleScript string', () => {
      const command = buildConnectCommand("/Applications/Alice's Mac/localtunnels", { coordinatorUrl: OK })
      const script = buildAuthorizationScript(command)
      const literal = script.slice('do shell script '.length, -' with administrator privileges'.length)
      expect(JSON.parse(literal)).toBe(command)
      if (process.platform !== 'win32')
        expect(Bun.spawnSync(['/bin/sh', '-n'], { stdin: Buffer.from(command) }).exitCode).toBe(0)
    })

    it('signals the requested process only after rechecking the root-owned session', () => {
      const command = buildDisconnectCommand(4321, CLI)
      expect(command).toContain('expected=4321')
      expect(command).toContain('same_session() { check_session && [ "$pid" = "$expected" ]; }')
      expect(command).toContain('if same_session; then /bin/kill -TERM "$pid"')
      expect(command).toContain('if same_session; then /bin/kill -KILL "$pid"')
      expect(command).toContain(`'${CLI}' 'vpn:down'`)
    })
  })

  describe('formatOsaError', () => {
    it('reports a cancelled prompt as cancelled, not as a failure', () => {
      expect(formatOsaError('User canceled.').error).toBe('Cancelled')
      expect(formatOsaError('error -128').error).toBe('Cancelled')
    })

    it('names an authorization failure', () => {
      expect(formatOsaError('authorization failed').error).toBe('Authorization failed')
    })

    it('truncates anything else rather than dumping it into the UI', () => {
      expect(formatOsaError('x'.repeat(500)).error!.length).toBeLessThanOrEqual(160)
    })
  })
})
