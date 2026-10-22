import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { PROJECT_CACHE_PATTERNS, scanProjectCaches } from '@system-cleaner/clean'

let root: string

/** Write a file, creating parents, and backdate the whole chain. */
function seed(relative: string, bytes = 4096, ageDays = 30): string {
  const full = path.join(root, relative)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, Buffer.alloc(bytes))
  const when = new Date(Date.now() - ageDays * 86_400_000)
  let dir = path.dirname(full)
  while (dir.startsWith(root)) {
    fs.utimesSync(dir, when, when)
    dir = path.dirname(dir)
  }
  return full
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'system-cleaner-pc-'))

  // A project with a git marker and a safe cache.
  fs.mkdirSync(path.join(root, 'alpha/.git'), { recursive: true })
  seed('alpha/.zig-cache/o/abc/blob')
  seed('alpha/packages/core/.zig-cache/o/def/blob')

  // Vendored dependencies: their dist is the package's shipped artifact, not
  // this project's build output, even though the root gitignores `dist`.
  fs.writeFileSync(path.join(root, 'alpha/.gitignore'), 'dist\nzig-out\n')
  seed('alpha/node_modules/left-pad/dist/index.js')
  seed('alpha/pantry/pako/dist/pako.js')
  seed('alpha/vendor/thing/dist/thing.js')

  // A project whose `dist` is tracked — no gitignore entry, so not build output.
  fs.mkdirSync(path.join(root, 'beta/.git'), { recursive: true })
  seed('beta/dist/bundle.js')

  // Recently touched: below the age floor.
  fs.mkdirSync(path.join(root, 'gamma/.git'), { recursive: true })
  seed('gamma/.zig-cache/o/fresh/blob', 4096, 0)
})

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('PROJECT_CACHE_PATTERNS', () => {
  it('excludes node_modules, which is not restorable from local sources alone', () => {
    expect(PROJECT_CACHE_PATTERNS.some(p => p.name === 'node_modules')).toBe(false)
  })

  it('marks ambiguous build-output names as caution and gates them on gitignore', () => {
    for (const name of ['dist', 'build', 'target']) {
      const pattern = PROJECT_CACHE_PATTERNS.find(p => p.name === name)
      expect(pattern?.risk).toBe('caution')
      expect(pattern?.requiresGitignore).toBe(true)
    }
  })

  it('marks toolchain caches as safe and names what rebuilds them', () => {
    for (const name of ['.zig-cache', 'zig-out', '.turbo', '__pycache__']) {
      const pattern = PROJECT_CACHE_PATTERNS.find(p => p.name === name)
      expect(pattern?.risk).toBe('safe')
      expect(pattern?.rebuild.length).toBeGreaterThan(0)
    }
  })
})

describe('scanProjectCaches', () => {
  it('finds project-local caches and groups them by the outermost project', async () => {
    const result = await scanProjectCaches({ roots: [root], minAgeDays: 7 })
    const alpha = result.groups.find(g => g.project === 'alpha')

    expect(alpha).toBeDefined()
    // Both caches belong to one repository, so they are one decision, not two.
    expect(alpha!.entries).toHaveLength(2)
    expect(alpha!.entries.every(e => e.pattern === '.zig-cache')).toBe(true)
  })

  it('never reports a cache inside a vendored dependency directory', async () => {
    const result = await scanProjectCaches({ roots: [root], minAgeDays: 7 })
    const paths = result.groups.flatMap(g => g.entries.map(e => e.path))

    for (const vendor of ['node_modules', 'pantry', 'vendor'])
      expect(paths.some(p => p.includes(`/${vendor}/`))).toBe(false)
  })

  it('skips an ambiguous directory the project does not ignore', async () => {
    const result = await scanProjectCaches({ roots: [root], minAgeDays: 7 })
    // beta/dist is tracked, so it may be the artifact the project ships.
    expect(result.groups.some(g => g.project === 'beta')).toBe(false)
  })

  it('skips caches modified more recently than the age floor', async () => {
    const result = await scanProjectCaches({ roots: [root], minAgeDays: 7 })
    expect(result.groups.some(g => g.project === 'gamma')).toBe(false)
  })

  it('counts a directory once when two roots reach it', async () => {
    const link = fs.mkdtempSync(path.join(os.tmpdir(), 'system-cleaner-pc-link-'))
    try {
      fs.symlinkSync(path.join(root, 'alpha'), path.join(link, 'alpha-mirror'))
      const result = await scanProjectCaches({ roots: [root, link], minAgeDays: 7 })
      const resolved = result.groups.flatMap(g => g.entries.map(e => fs.realpathSync(e.path)))
      expect(new Set(resolved).size).toBe(resolved.length)
    }
    finally {
      fs.rmSync(link, { recursive: true, force: true })
    }
  })

  it('honours the depth limit', async () => {
    const shallow = await scanProjectCaches({ roots: [root], minAgeDays: 7, maxDepth: 1 })
    // alpha/packages/core/.zig-cache sits deeper than one level below the root.
    expect(shallow.groups.flatMap(g => g.entries).length).toBeLessThan(2)
  })

  it('reports only the patterns asked for', async () => {
    const result = await scanProjectCaches({ roots: [root], minAgeDays: 7, patterns: ['zig-out'] })
    expect(result.entryCount).toBe(0)
  })

  it('never scans $HOME wholesale by default', async () => {
    const { DEFAULT_SCAN_ROOTS } = await import('@system-cleaner/clean')
    expect(DEFAULT_SCAN_ROOTS).not.toContain(os.homedir())
  })
})
