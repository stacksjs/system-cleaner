import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import process from 'node:process'

/**
 * The agent runs in a process of its own here, as it does in the app.
 *
 * Importing `app/Desktop/server.ts` into the test process would load the
 * database module on the developer's default database before the suites that
 * redirect `DB_DATABASE_PATH` get to it; on a fresh CI runner that database
 * has no tables, and every cleanup test failed with "no such table".
 */
interface Agent { port: number, stop: () => void }

async function startAgent(webRoot: string): Promise<Agent> {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-data-'))
  const child = Bun.spawn(['bun', path.join(import.meta.dir, '../app/Desktop/server.ts')], {
    cwd: path.join(import.meta.dir, '..'),
    stdout: 'pipe',
    stderr: 'ignore',
    env: {
      ...process.env,
      SYSTEM_CLEANER_AGENT: '1',
      SYSTEM_CLEANER_WEB_ROOT: webRoot,
      SYSTEM_CLEANER_PORT: '0',
      DB_CONNECTION: 'sqlite',
      DB_DATABASE_PATH: path.join(data, 'agent.sqlite'),
    },
  })
  const decoder = new TextDecoder()
  let output = ''
  for await (const chunk of child.stdout as ReadableStream<Uint8Array>) {
    output += decoder.decode(chunk, { stream: true })
    const match = output.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/)
    if (match) {
      return {
        port: Number(match[1]),
        stop: () => {
          child.kill()
          fs.rmSync(data, { recursive: true, force: true })
        },
      }
    }
  }
  throw new Error(`The agent exited before listening: ${output}`)
}

/**
 * The agent answered its first missing file with a 404 and every one after
 * that with a 500, because a single Response instance was returned for all of
 * them and a body can only be sent once. The page asks for `/favicon.ico` on
 * every navigation, so the packaged app logged a server error per click.
 */
describe('agent static files', () => {
  let webRoot: string
  let agent: Agent

  beforeAll(async () => {
    webRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-web-'))
    fs.writeFileSync(path.join(webRoot, 'index.html'), '<!doctype html><title>ok</title>')
    agent = await startAgent(webRoot)
  }, 30_000)

  afterAll(() => {
    agent.stop()
    fs.rmSync(webRoot, { recursive: true, force: true })
  })

  it('answers every missing file with a 404, not only the first', async () => {
    const base = `http://127.0.0.1:${agent.port}`
    const statuses: number[] = []
    for (let i = 0; i < 3; i++)
      statuses.push((await fetch(`${base}/favicon.ico`)).status)

    expect(statuses).toEqual([404, 404, 404])
  })

  it('still serves files that exist', async () => {
    const response = await fetch(`http://127.0.0.1:${agent.port}/`)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('<title>ok</title>')
  })

  // Craft's App Store host opens `/?session=<token>`; the window belongs in the app.
  it('sends the session address on to the app', async () => {
    const response = await fetch(`http://127.0.0.1:${agent.port}/?session=abc-123`, { redirect: 'manual' })
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(`http://127.0.0.1:${agent.port}/app`)
  })
})
