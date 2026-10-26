import { describe, expect, it } from 'bun:test'
import {
  buildConnectCommand,
  buildDisconnectCommand,
  buildElevatedCommand,
  formatOsaError,
  looksLikeTunnel,
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

  describe('buildConnectCommand', () => {
    it('quotes every argument and backgrounds the tunnel', () => {
      const cmd = buildConnectCommand(CLI, { coordinatorUrl: OK })
      expect(cmd).toContain(`'${CLI}' 'vpn:up' '--coordinator' '${OK}'`)
      expect(cmd).toStartWith('nohup ')
      // Without backgrounding, `do shell script` waits forever on a tunnel.
      expect(cmd).toContain('&')
      expect(cmd).toContain('echo $!')
    })

    it('includes the optional flags only when given', () => {
      const bare = buildConnectCommand(CLI, { coordinatorUrl: OK })
      expect(bare).not.toContain('--auth-key')
      expect(bare).not.toContain('--use-exit')

      const full = buildConnectCommand(CLI, { coordinatorUrl: OK, authKey: 'k-1', useExit: 'auto' })
      expect(full).toContain("'--auth-key' 'k-1'")
      expect(full).toContain("'--use-exit' 'auto'")
    })

    it('single-quotes a CLI path containing a space', () => {
      const cmd = buildConnectCommand('/Applications/My App/localtunnels', { coordinatorUrl: OK })
      expect(cmd).toContain("'/Applications/My App/localtunnels'")
    })
  })

  describe('buildElevatedCommand', () => {
    it('escapes the shell command for the AppleScript literal', () => {
      // Shell quoting leaves single quotes everywhere; those are harmless
      // inside "..." but the double quotes and backslashes are not.
      const elevated = buildElevatedCommand(`echo "hi" \\ there`)
      expect(elevated).toStartWith('osascript -e ')
      expect(elevated).toContain('with administrator privileges')
      expect(elevated).toContain('\\"hi\\"')
      expect(elevated).toContain('\\\\')
    })

    it('leaves no unescaped double quote to close the literal early', () => {
      const inner = buildConnectCommand(CLI, { coordinatorUrl: OK })
      const elevated = buildElevatedCommand(inner)
      // Everything between the outer single quotes is the AppleScript; the
      // only unescaped double quotes should be the two delimiting the literal.
      const script = elevated.slice(elevated.indexOf("'") + 1, elevated.lastIndexOf("'"))
      const unescaped = [...script.matchAll(/(?<!\\)"/g)].length
      expect(unescaped).toBe(2)
    })
  })

  describe('buildDisconnectCommand', () => {
    it('kills exactly the pid it was given', () => {
      expect(buildDisconnectCommand(4321)).toBe('kill 4321')
    })
  })

  describe('looksLikeTunnel', () => {
    it('matches the resolved CLI path running vpn:up', () => {
      expect(looksLikeTunnel(`${CLI} vpn:up --coordinator ws://x:1`, CLI)).toBe(true)
    })

    it('rejects a different binary even when it is running vpn:up', () => {
      expect(looksLikeTunnel('/tmp/evil vpn:up --coordinator ws://x:1', CLI)).toBe(false)
    })

    it('falls back to the known names when the path is unknown', () => {
      expect(looksLikeTunnel('/usr/local/bin/localtunnels vpn:up --coordinator ws://x:1')).toBe(true)
      expect(looksLikeTunnel('/opt/homebrew/bin/lt vpn:up --coordinator ws://x:1')).toBe(true)
    })

    it('does not match an unrelated process that inherited the pid', () => {
      // Why the pid file alone is not trusted: pids get reused, and a stale
      // one would otherwise be killed.
      for (const cmd of [
        '/usr/sbin/cupsd -l',
        '/usr/local/bin/localtunnels start --port 3000',
        '',
      ])
        expect(looksLikeTunnel(cmd)).toBe(false)
    })

    it('is not fooled by vpn:up appearing as an argument to something else', () => {
      // `lt` is a common enough word that the name fallback has to require
      // vpn:up as its own token, not merely somewhere on the line.
      expect(looksLikeTunnel('vim lt vpn:upgrade-notes')).toBe(false)
      expect(looksLikeTunnel('/usr/bin/grep vpn:up /var/log/system.log')).toBe(false)
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
