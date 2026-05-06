import { describe, expect, it } from 'bun:test'
import { exec, execLines, execOr, execSync, execSyncResult, shellEscape } from '../src/exec'

describe('exec', () => {
  it('returns ok=true and stdout on success', async () => {
    const r = await exec('echo hello')
    expect(r.ok).toBe(true)
    expect(r.stdout).toBe('hello')
    expect(r.exitCode).toBe(0)
  })

  it('returns ok=false on non-zero exit', async () => {
    const r = await exec('false')
    expect(r.ok).toBe(false)
    expect(r.exitCode).not.toBe(0)
  })

  it('captures stderr', async () => {
    const r = await exec('echo to-stderr 1>&2')
    expect(r.stderr).toBe('to-stderr')
  })

  it('honors timeout', async () => {
    const r = await exec('sleep 5', { timeout: 200 })
    expect(r.ok).toBe(false)
  })

  it('passes env vars to the command', async () => {
    const r = await exec('echo "$MY_VAR"', { env: { MY_VAR: 'system-cleaner-test' } })
    expect(r.stdout).toBe('system-cleaner-test')
  })
})

describe('execSync', () => {
  it('returns stdout on success', () => {
    expect(execSync('echo hello')).toBe('hello')
  })

  it('returns empty string on failure (legacy behaviour)', () => {
    expect(execSync('exit 1')).toBe('')
  })
})

describe('execSyncResult', () => {
  it('returns ok=true with stdout on success', () => {
    const r = execSyncResult('echo abc')
    expect(r.ok).toBe(true)
    expect(r.stdout).toBe('abc')
  })

  it('returns ok=false on failure — fixes the silent-fallback bug', () => {
    // Regression: previously every caller used execSync and got '' on both
    // failure and empty success. Now they can branch on `.ok`.
    const r = execSyncResult('exit 5')
    expect(r.ok).toBe(false)
    expect(r.stdout).toBe('')
  })

  it('captures stderr on failure', () => {
    const r = execSyncResult('echo woops 1>&2; exit 1')
    expect(r.ok).toBe(false)
    expect(r.stderr.length).toBeGreaterThan(0)
  })
})

describe('execLines', () => {
  it('splits stdout into non-empty lines', async () => {
    const lines = await execLines('printf "a\\nb\\n\\nc\\n"')
    expect(lines).toEqual(['a', 'b', 'c'])
  })

  it('returns [] on failure', async () => {
    expect(await execLines('false')).toEqual([])
  })
})

describe('execOr', () => {
  it('returns the parsed value on success', async () => {
    const v = await execOr('echo 42', 0, s => Number.parseInt(s, 10))
    expect(v).toBe(42)
  })

  it('returns the fallback on failure', async () => {
    const v = await execOr('false', 99, s => Number.parseInt(s, 10))
    expect(v).toBe(99)
  })

  it('returns the fallback when parse throws', async () => {
    const v = await execOr('echo not-a-number', 7, (s) => {
      const n = Number.parseInt(s, 10)
      if (Number.isNaN(n))
        throw new Error('NaN')
      return n
    })
    expect(v).toBe(7)
  })
})

describe('shellEscape', () => {
  it('wraps simple values in single quotes', () => {
    expect(shellEscape('hello')).toBe("'hello'")
  })

  it('escapes embedded single quotes (POSIX `\'\\\'\\\'\'` trick)', () => {
    expect(shellEscape("it's")).toBe(`'it'\\''s'`)
  })

  it('protects values that look like shell metacharacters', async () => {
    const evil = `; rm -rf /tmp/should-not-happen ;`
    const r = await exec(`echo ${shellEscape(evil)}`)
    expect(r.stdout).toBe(evil)
  })
})
