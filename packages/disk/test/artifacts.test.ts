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

  // Both fixtures carry a manifest: since the safety gates landed, a directory
  // only counts as build output when its parent shows some sign of being a
  // project. A bare folder of the right name is exactly what must NOT match.
  const alpha = path.join(ROOT, 'alpha')
  fs.mkdirSync(alpha, { recursive: true })
  fs.writeFileSync(path.join(alpha, 'package.json'), '{"name":"alpha"}')
  artifactDir(alpha, 'node_modules', 4_000_000)
  artifactDir(alpha, 'pantry', 3_000_000)
  artifactDir(alpha, 'dist', 2_000_000)
  // Under the 1 MB floor, so it should not reach the caller.
  artifactDir(alpha, '.turbo', 1_000)
  // Not an artifact at all; must never be offered.
  artifactDir(alpha, 'src', 5_000_000)

  const beta = path.join(ROOT, 'beta')
  fs.mkdirSync(beta, { recursive: true })
  fs.writeFileSync(path.join(beta, 'build.zig'), '// marker')
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

/**
 * These two gates exist because the scanner matched on directory name alone,
 * and on a real machine that offered a 665 MB clone of pantry-pm/pantry as
 * `safe` — one click on Select All from losing the repository and anything
 * unpushed in it, since nothing here goes through the Trash. A synthetic
 * non-developer tree produced `Insurance/2024/coverage` and `Music/Pods` the
 * same way. `coverage`, `Pods`, `build`, `dist`, `vendor` and `target` are
 * ordinary words before they are build output.
 */
describe('findProjectArtifacts safety gates', () => {
  let GATE: string

  beforeAll(() => {
    GATE = fs.mkdtempSync(path.join(TMP_ROOT, 'system-cleaner-gates-'))

    // A folder of documents that happens to use build-output words.
    artifactDir(path.join(GATE, 'Insurance', '2024'), 'coverage', 3_000_000)
    artifactDir(path.join(GATE, 'Music'), 'Pods', 3_000_000)

    // A checkout whose own name is a pattern.
    const clone = path.join(GATE, 'checkout', 'pantry')
    fs.mkdirSync(path.join(clone, '.git'), { recursive: true })
    fs.writeFileSync(path.join(clone, '.git', 'config'), '[remote "origin"]\n')
    fs.writeFileSync(path.join(clone, 'blob.bin'), Buffer.alloc(3_000_000))
    // ...and make its parent look like a project, so only the checkout gate saves it.
    fs.writeFileSync(path.join(GATE, 'checkout', 'package.json'), '{"name":"parent"}')

    // A genuine project.
    const proj = path.join(GATE, 'realproj')
    fs.mkdirSync(proj, { recursive: true })
    fs.writeFileSync(path.join(proj, 'package.json'), '{"name":"realproj"}')
    artifactDir(proj, 'node_modules', 3_000_000)
    artifactDir(proj, 'pantry', 3_000_000)
  })

  afterAll(() => {
    safeCleanup(GATE)
  })

  it('does not offer a directory whose parent shows no sign of being a project', async () => {
    const found = await findProjectArtifacts([GATE], 5, 0)
    const paths = found.map(a => a.path)
    expect(paths.some(p => p.includes(`Insurance${path.sep}2024${path.sep}coverage`))).toBe(false)
    expect(paths.some(p => p.endsWith(`Music${path.sep}Pods`))).toBe(false)
  })

  it('never offers a git checkout, whatever its directory is called', async () => {
    const found = await findProjectArtifacts([GATE], 5, 0)
    const clone = path.join(GATE, 'checkout', 'pantry')
    expect(found.some(a => a.path === clone)).toBe(false)
  })

  it('still offers build output that sits beside a project manifest', async () => {
    const found = await findProjectArtifacts([GATE], 5, 0)
    const names = found
      .filter(a => a.path.includes(`${path.sep}realproj${path.sep}`))
      .map(a => path.basename(a.path))
      .sort()
    expect(names).toEqual(['node_modules', 'pantry'])
  })

  it('treats a .git directory as a project marker, so a repo\'s own output still counts', async () => {
    const repo = path.join(GATE, 'gitproj')
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true })
    artifactDir(repo, 'node_modules', 3_000_000)

    const found = await findProjectArtifacts([GATE], 5, 0)
    expect(found.some(a => a.path === path.join(repo, 'node_modules'))).toBe(true)
  })
})
