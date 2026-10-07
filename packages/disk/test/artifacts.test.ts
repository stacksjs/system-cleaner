import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { findProjectArtifacts } from '../src/analysis'
import { getProjectArtifactPatterns, isProjectArtifact } from '../src/categories'

const TMP_ROOT = fs.realpathSync(os.tmpdir())
let ROOT: string

function safeCleanup(p: string): void {
  const resolved = fs.realpathSync(p)
  if (!resolved.startsWith(`${TMP_ROOT}${path.sep}`))
    throw new Error(`refusing to rm outside tmpdir: ${resolved}`)
  fs.rmSync(resolved, { recursive: true, force: true })
}

/** Write a directory with a single file of `bytes` so it has a real size. */
function artifactDir(parent: string, name: string, bytes: number): string {
  const dir = path.join(parent, name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'blob.bin'), Buffer.alloc(bytes))
  return dir
}

beforeAll(() => {
  ROOT = fs.mkdtempSync(path.join(TMP_ROOT, 'system-cleaner-artifacts-'))

  const alpha = path.join(ROOT, 'alpha')
  fs.mkdirSync(alpha, { recursive: true })
  artifactDir(alpha, 'node_modules', 4_000_000)
  artifactDir(alpha, 'pantry', 3_000_000)
  artifactDir(alpha, 'dist', 2_000_000)
  // Under the 1 MB floor, so it should not reach the caller.
  artifactDir(alpha, '.turbo', 1_000)
  // Not an artifact at all; must never be offered.
  artifactDir(alpha, 'src', 5_000_000)

  const beta = path.join(ROOT, 'beta')
  fs.mkdirSync(beta, { recursive: true })
  artifactDir(beta, '.zig-cache', 6_000_000)
})

afterAll(() => {
  safeCleanup(ROOT)
})

describe('project artifact patterns', () => {
  it('knows pantry, which held more than any other kind on a real machine', () => {
    expect(isProjectArtifact('pantry').isArtifact).toBe(true)
  })

  it('gives every pattern a risk, so Select All can exclude the dangerous ones', () => {
    for (const p of getProjectArtifactPatterns())
      expect(['safe', 'caution']).toContain(p.risk)
  })

  /**
   * These four look like build output and are the ones most likely to hold
   * something nothing regenerates: a release may have been cut from `dist` or
   * `build` with nothing proving it reproduces, `vendor` is exactly what an
   * offline Go or PHP build needs, and a virtualenv can carry compiled
   * extensions. Select All must leave them alone.
   */
  it('holds dist, build, vendor and virtualenvs back from Select All', () => {
    const byName = new Map(getProjectArtifactPatterns().map(p => [p.dirName, p.risk]))
    expect(byName.get('dist')).toBe('caution')
    expect(byName.get('build')).toBe('caution')
    expect(byName.get('vendor')).toBe('caution')
    expect(byName.get('.venv')).toBe('caution')
  })

  it('treats a dependency tree as safe, because a reinstall rebuilds it', () => {
    const byName = new Map(getProjectArtifactPatterns().map(p => [p.dirName, p.risk]))
    expect(byName.get('node_modules')).toBe('safe')
    expect(byName.get('.zig-cache')).toBe('safe')
  })

  it('does not offer .git, which is the repository rather than its output', () => {
    expect(isProjectArtifact('.git').isArtifact).toBe(false)
  })
})

describe('findProjectArtifacts', () => {
  it('finds artifacts across projects and names the project each belongs to', async () => {
    const found = await findProjectArtifacts([ROOT], 4, 0)
    const names = found.map(a => path.basename(a.path)).sort()
    expect(names).toContain('node_modules')
    expect(names).toContain('pantry')
    expect(names).toContain('.zig-cache')

    const zig = found.find(a => path.basename(a.path) === '.zig-cache')!
    expect(zig.projectName).toBe('beta')
    expect(zig.risk).toBe('safe')
    expect(zig.label).toBeTruthy()
  })

  it('never offers a directory that is not a known artifact', async () => {
    const found = await findProjectArtifacts([ROOT], 4, 0)
    expect(found.map(a => path.basename(a.path))).not.toContain('src')
  })

  /**
   * 1803 `dist` directories came to 2.9 GB on a real machine and 82% were
   * under a megabyte. Returning them produces a list nobody reads, which hides
   * the dozen entries actually worth acting on.
   */
  it('drops artifacts below the size floor', async () => {
    const all = await findProjectArtifacts([ROOT], 4, 0)
    expect(all.map(a => path.basename(a.path))).toContain('.turbo')

    const filtered = await findProjectArtifacts([ROOT], 4, 1_000_000)
    expect(filtered.map(a => path.basename(a.path))).not.toContain('.turbo')
  })

  it('returns largest first, so the list opens on what is worth acting on', async () => {
    const found = await findProjectArtifacts([ROOT], 4, 0)
    const sizes = found.map(a => a.sizeBytes)
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a))
  })

  it('does not descend into an artifact it already matched', async () => {
    const nested = path.join(ROOT, 'alpha', 'node_modules', 'dist')
    fs.mkdirSync(nested, { recursive: true })
    fs.writeFileSync(path.join(nested, 'blob.bin'), Buffer.alloc(2_000_000))

    const found = await findProjectArtifacts([ROOT], 4, 0)
    expect(found.some(a => a.path === nested)).toBe(false)
  })

  it('skips a root that does not exist rather than throwing', async () => {
    const found = await findProjectArtifacts([path.join(ROOT, 'nope')], 4, 0)
    expect(found).toEqual([])
  })
})
