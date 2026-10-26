import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { findProjectArtifacts } from '@system-cleaner/disk'

/**
 * `node_modules` is classified `safe` because it comes back from a command
 * and a network round-trip. That reasoning depends on a lockfile existing to
 * come back to — without one, the restored tree is whatever the registry
 * resolves today, which need not be what was deleted.
 *
 * Select All takes everything marked `safe`, so the distinction decides
 * whether one click can sweep an unreproducible dependency tree.
 */

const MB = 1024 * 1024
let root: string

function project(name: string, lockfile?: string): void {
  const dir = path.join(root, name)
  fs.mkdirSync(path.join(dir, 'node_modules/left-pad'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"x"}')
  if (lockfile)
    fs.writeFileSync(path.join(dir, lockfile), 'lock')
  // Over the scanner's 1 MB noise floor, or it is filtered before risk matters.
  fs.writeFileSync(path.join(dir, 'node_modules/left-pad/index.js'), Buffer.alloc(2 * MB))
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'system-cleaner-lock-'))
  project('with-bun-lock', 'bun.lock')
  project('with-npm-lock', 'package-lock.json')
  project('no-lock')
})

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('node_modules risk depends on a lockfile', () => {
  it('stays safe when the install is reproducible', async () => {
    const found = await findProjectArtifacts([root])
    for (const name of ['with-bun-lock', 'with-npm-lock']) {
      const tree = found.find(a => a.projectName === name)
      expect(tree).toBeDefined()
      expect(tree!.risk).toBe('safe')
      expect(tree!.label).toBe('Node.js dependencies')
    }
  }, 60_000)

  it('drops to caution when no lockfile pins the tree', async () => {
    const found = await findProjectArtifacts([root])
    const tree = found.find(a => a.projectName === 'no-lock')
    expect(tree).toBeDefined()
    expect(tree!.risk).toBe('caution')
  }, 60_000)

  it('says why, so the row is not unexplained', async () => {
    const found = await findProjectArtifacts([root])
    const tree = found.find(a => a.projectName === 'no-lock')
    expect(tree!.label).toContain('no lockfile')
  }, 60_000)

  it('keeps an unreproducible tree out of a Select All sweep', async () => {
    const found = await findProjectArtifacts([root])
    // Select All is `risk === 'safe'`; see the developer screen.
    const swept = found.filter(a => a.risk === 'safe').map(a => a.projectName)
    expect(swept).not.toContain('no-lock')
  }, 60_000)
})
