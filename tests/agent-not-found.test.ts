import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { startAgentServer } from '../app/Desktop/server'

/**
 * The agent answered its first missing file with a 404 and every one after
 * that with a 500, because a single Response instance was returned for all of
 * them and a body can only be sent once. The page asks for `/favicon.ico` on
 * every navigation, so the packaged app logged a server error per click.
 */
describe('agent static files', () => {
  let webRoot: string
  let server: Awaited<ReturnType<typeof startAgentServer>>

  beforeAll(async () => {
    webRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-web-'))
    fs.writeFileSync(path.join(webRoot, 'index.html'), '<!doctype html><title>ok</title>')
    server = await startAgentServer({ webRoot, port: 0 })
  })

  afterAll(() => {
    server.stop(true)
    fs.rmSync(webRoot, { recursive: true, force: true })
  })

  it('answers every missing file with a 404, not only the first', async () => {
    const base = `http://127.0.0.1:${server.port}`
    const statuses: number[] = []
    for (let i = 0; i < 3; i++)
      statuses.push((await fetch(`${base}/favicon.ico`)).status)

    expect(statuses).toEqual([404, 404, 404])
  })

  it('still serves files that exist', async () => {
    const response = await fetch(`http://127.0.0.1:${server.port}/`)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('<title>ok</title>')
  })
})
