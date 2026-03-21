import { execSync as nodeExecSync } from 'node:child_process'
import type { ExecOptions, ExecResult } from './types'

const DEFAULT_TIMEOUT = 10_000

/**
 * Execute a shell command asynchronously using Bun.spawn.
 * Timer is always cleared via try/finally to prevent leaks.
 */
export async function exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    const proc = Bun.spawn(['sh', '-c', command], {
      stdout: 'pipe',
      stderr: 'pipe',
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : undefined,
    })

    timer = setTimeout(() => proc.kill(), timeout)

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    const exitCode = await proc.exited

    return {
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      exitCode,
      ok: exitCode === 0,
    }
  }
  catch (err) {
    return {
      stdout: '',
      stderr: err instanceof Error ? err.message : String(err),
      exitCode: 1,
      ok: false,
    }
  }
  finally {
    if (timer)
      clearTimeout(timer)
  }
}

/**
 * Execute a shell command synchronously
 */
export function execSync(command: string, options: ExecOptions = {}): string {
  try {
    return nodeExecSync(command, {
      encoding: (options.encoding ?? 'utf8') as BufferEncoding,
      timeout: options.timeout ?? DEFAULT_TIMEOUT,
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  }
  catch {
    return ''
  }
}

/**
 * Execute a command and return parsed lines
 */
export async function execLines(command: string, options: ExecOptions = {}): Promise<string[]> {
  const result = await exec(command, options)
  if (!result.ok || !result.stdout)
    return []
  return result.stdout.split('\n').filter(Boolean)
}

/**
 * Execute a command, returning a fallback value on failure
 */
export async function execOr<T>(command: string, fallback: T, parse: (stdout: string) => T, options: ExecOptions = {}): Promise<T> {
  const result = await exec(command, options)
  if (!result.ok || !result.stdout)
    return fallback
  try {
    return parse(result.stdout)
  }
  catch {
    return fallback
  }
}

/**
 * Sanitize a string for safe use in shell commands (prevents injection).
 * Wraps in single quotes and escapes any embedded single quotes.
 */
export function shellEscape(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

/**
 * Check if a command exists on the system
 */
export async function commandExists(name: string): Promise<boolean> {
  const result = await exec(`command -v ${shellEscape(name)}`)
  return result.ok
}
