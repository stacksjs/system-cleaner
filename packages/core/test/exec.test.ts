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

  /**
   * Asserting only `ok === false` let a broken timeout pass: the command ran
   * its full five seconds and then reported failure, which is the same answer
   * for the wrong reason. It took running this on Linux, where it blew bun's
   * own 5s per-test limit, for anyone to notice. So assert the clock.
   */
  it('honors timeout, and returns within it', async () => {
    const started = Date.now()
    const r = await exec('sleep 5', { timeout: 200 })
    expect(r.ok).toBe(false)
    expect(Date.now() - started).toBeLessThan(2000)
  })

  /**
   * `sh -c` execs a lone simple command away, so killing the shell killed it
   * and the case above passed even while the timeout did nothing. Give the
   * shell something it has to fork for and the grandchild keeps the pipes
   * open, which is what actually hung the caller.
   */
  it.each([
    ['a pipeline', 'sleep 5 | cat'],
    ['two statements', 'sleep 5; echo done'],
    ['a subshell', '(sleep 5)'],
  ])('honors timeout for %s, which the shell cannot exec away', async (_name, command) => {
    const started = Date.now()
    const r = await exec(command, { timeout: 200 })
    expect(r.ok).toBe(false)
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('reports why it gave up, rather than looking like an empty success', async () => {
    const r = await exec('sleep 5 | cat', { timeout: 150 })
    expect(r.ok).toBe(false)
    expect(r.exitCode).toBe(-1)
    expect(r.stderr).toContain('timed out')
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
    // A command that does not exist, rather than `echo woops 1>&2; exit 1`.
    // That was POSIX shell syntax, and node's execSync runs cmd.exe on
    // Windows, where `;` is not a separator - so the failure under test never
    // happened and the assertion failed for the wrong reason. A missing
    // binary fails the same way on every platform, which is the contract this
    // is actually about: a non-zero exit must surface as ok:false with the
    // reason preserved.
    const r = execSyncResult('system-cleaner-no-such-command-9f3a')
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
