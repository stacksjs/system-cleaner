import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { scanStaleDependencies } from '@system-cleaner/clean'

let root: string

const DAY = 86_400_000

function touch(target: string, ageDays: number): void {
  const when = new Date(Date.now() - ageDays * DAY)
  fs.utimesSync(target, when, when)
}

/** A project with sources of a given age and a dependency tree. */
function project(name: string, opts: {
  sourceAgeDays: number
  lockfile?: string
  treeAgeDays?: number
  manifest?: boolean
}): string {
  const dir = path.join(root, name)
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'node_modules/left-pad'), { recursive: true })

  if (opts.manifest !== false)
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"x"}')
  if (opts.lockfile)
    fs.writeFileSync(path.join(dir, opts.lockfile), 'lock')

  fs.writeFileSync(path.join(dir, 'src/index.ts'), 'export const a = 1')
  fs.writeFileSync(path.join(dir, 'node_modules/left-pad/index.js'), Buffer.alloc(8192))

  // The tree is written *after* sources, then both are backdated so the
  // install can be made to look newer than the code — the case that decides
  // whether activity is read from sources or from node_modules.
  touch(path.join(dir, 'src/index.ts'), opts.sourceAgeDays)
  touch(path.join(dir, 'src'), opts.sourceAgeDays)
  touch(path.join(dir, 'node_modules/left-pad/index.js'), opts.treeAgeDays ?? opts.sourceAgeDays)
  if (opts.manifest !== false)
    touch(path.join(dir, 'package.json'), opts.sourceAgeDays)
  // The lockfile counts as project activity — a changed lockfile means
  // somebody edited dependencies — so it has to be backdated with the rest
  // or every fixture reads as touched today.
  if (opts.lockfile)
    touch(path.join(dir, opts.lockfile), opts.sourceAgeDays)
  return dir
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'system-cleaner-sd-'))

  project('idle-with-lock', { sourceAgeDays: 200, lockfile: 'bun.lock' })
  project('idle-no-lock', { sourceAgeDays: 200 })
  project('active', { sourceAgeDays: 1, lockfile: 'bun.lock' })
  // Old code, freshly reinstalled dependencies.
  project('idle-fresh-install', { sourceAgeDays: 200, treeAgeDays: 0, lockfile: 'package-lock.json' })
  project('no-manifest', { sourceAgeDays: 200, manifest: false })
})

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('scanStaleDependencies', () => {
  it('reports a tree whose project has been idle past the threshold', async () => {
    const result = await scanStaleDependencies({ roots: [root], minIdleDays: 90 })
    const names = result.trees.map(t => t.project)
    expect(names).toContain('idle-with-lock')
  })

  it('leaves an actively worked-on project alone', async () => {
    const result = await scanStaleDependencies({ roots: [root], minIdleDays: 90 })
    expect(result.trees.map(t => t.project)).not.toContain('active')
  })

  it('reads activity from sources, not from the dependency tree', async () => {
    // A reinstall bumps node_modules without anyone touching the code. If
    // activity were read from the tree, the one project most safely
    // reclaimable would be the one permanently excluded.
    const result = await scanStaleDependencies({ roots: [root], minIdleDays: 90 })
    const tree = result.trees.find(t => t.project === 'idle-fresh-install')
    expect(tree).toBeDefined()
    expect(tree!.idleDays).toBeGreaterThanOrEqual(90)
  })

  it('maps each lockfile to the command that restores it', async () => {
    const result = await scanStaleDependencies({ roots: [root], minIdleDays: 90 })
    expect(result.trees.find(t => t.project === 'idle-with-lock')?.restoreCommand).toBe('bun install')
    expect(result.trees.find(t => t.project === 'idle-fresh-install')?.restoreCommand).toBe('npm ci')
  })

  it('flags a tree with no lockfile as not reproducible', async () => {
    const result = await scanStaleDependencies({ roots: [root], minIdleDays: 90 })
    const tree = result.trees.find(t => t.project === 'idle-no-lock')
    expect(tree?.reproducible).toBe(false)
    expect(tree?.restoreCommand).toBe('')
    expect(result.withoutLockfile).toBeGreaterThanOrEqual(1)
  })

  it('can exclude trees that have no lockfile', async () => {
    const result = await scanStaleDependencies({ roots: [root], minIdleDays: 90, includeWithoutLockfile: false })
    expect(result.trees.map(t => t.project)).not.toContain('idle-no-lock')
    expect(result.withoutLockfile).toBe(0)
  })

  it('ignores a directory with no package.json', async () => {
    const result = await scanStaleDependencies({ roots: [root], minIdleDays: 90 })
    expect(result.trees.map(t => t.project)).not.toContain('no-manifest')
  })

  it('reports each tree once', async () => {
    const result = await scanStaleDependencies({ roots: [root], minIdleDays: 90 })
    const paths = result.trees.map(t => t.path)
    expect(new Set(paths).size).toBe(paths.length)
  })
})
