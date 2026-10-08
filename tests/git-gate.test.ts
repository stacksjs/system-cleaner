import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as os from 'node:os'
import { classifyByGit, refusesDeletion } from '@system-cleaner/core'
import { findProjectArtifacts } from '../packages/disk/src/analysis'

/**
 * The name of a directory is not evidence that it is build output.
 *
 * This app deletes by pattern: `dist`, `build`, `vendor`, `node_modules`,
 * `zig-out` and thirty more. On the machine it was written against, six of
 * those matches were directories git tracks — a committed GitHub Action
 * bundle whose removal breaks the action for everyone using it, a source
 * directory called `build`, and three vendored trees that are checked in on
 * purpose. One of them sat in "Select All Safe" under a dialog promising "a
 * build regenerates it; nothing else does".
 *
 * Deleting that class of directory by hand in one afternoon cost 285 tracked
 * files across two repositories. They came back only because they happened to
 * be committed and the repositories happened to have no other work in them.
 *
 * So git gets the last word, and these tests pin the three ways that gate can
 * silently stop working: the negation rule, the file-vs-directory predicate,
 * and the scanner forgetting to ask at all.
 */

let root = ''

function git(cwd: string, ...args: string[]): void {
  const proc = Bun.spawnSync(['git', '-C', cwd, ...args], {
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
    stdout: 'ignore',
    stderr: 'ignore',
  })
  if (!proc.success && args[0] !== 'add')
    throw new Error(`git ${args.join(' ')} failed in ${cwd}`)
}

function write(p: string, body: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, body)
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-git-gate-'))

  const repo = path.join(root, 'repo')
  fs.mkdirSync(repo, { recursive: true })
  git(repo, 'init', '-q')

  // `Pods/` then `!Pods/`: the last matching pattern wins, so Pods is NOT
  // ignored. A gate that reads any match as "ignored" deletes it.
  // `vendor/` is re-ignored after its own negation, which must still read as
  // ignored — the rule is last-match, not "a negation anywhere disqualifies".
  write(path.join(repo, '.gitignore'), 'dist/\nnode_modules/\nPods/\n!Pods/\nvendor/\n!vendor/\nvendor/\n')

  write(path.join(repo, 'dist/bundle.js'), 'built')
  write(path.join(repo, 'node_modules/dep/index.js'), 'dep')
  // A committed node_modules, the case that cost 285 files by hand. It needs
  // a project marker beside it or the scanner never looks: looksLikeProject()
  // already refuses to classify anything whose parent shows no sign of being
  // a project, which is why the app itself never offered bun's bare
  // test/fixtures/node_modules. A fixture package that carries its own
  // package.json does get reached, and that is the shape this pins.
  write(path.join(repo, 'test/fixture-pkg/package.json'), '{"name":"fixture"}')
  write(path.join(repo, 'test/fixture-pkg/node_modules/pkg/index.js'), 'committed fixture')
  write(path.join(repo, 'Pods/Thing.swift'), 'committed')
  write(path.join(repo, 'vendor/lib.c'), 'ignored again')
  write(path.join(repo, 'build/make.ts'), 'this build dir is source')
  write(path.join(repo, 'src/app.ts'), 'source')

  git(repo, 'add', '-f', '.gitignore', 'Pods', 'build', 'src', 'test')
  git(repo, 'commit', '-qm', 'init')

  // A directory matching a pattern, outside any repository.
  write(path.join(root, 'loose/dist/out.js'), 'no repo owns this')
})

afterAll(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true })
})

describe('git disposition', () => {
  it('calls an ignored directory ignored', async () => {
    const r = await classifyByGit([path.join(root, 'repo/dist'), path.join(root, 'repo/node_modules')])
    expect(r.get(path.join(root, 'repo/dist'))).toBe('ignored')
    expect(r.get(path.join(root, 'repo/node_modules'))).toBe('ignored')
  })

  /**
   * The clause that separates this gate from a new way to lose data.
   *
   * `git check-ignore -v` reports the last pattern that matched. When that is
   * a negation the path is NOT ignored, and git signals it either with an
   * empty pattern field or with a `!`-prefixed one depending on the rule that
   * won. Both must read as "do not delete".
   */
  it('does not call a negated path ignored', async () => {
    const pods = path.join(root, 'repo/Pods')
    const r = await classifyByGit([pods])
    expect(r.get(pods)).not.toBe('ignored')
    expect(r.get(pods)).toBe('tracked')
  })

  it('still calls a path ignored when a re-ignore follows the negation', async () => {
    const vendor = path.join(root, 'repo/vendor')
    expect((await classifyByGit([vendor])).get(vendor)).toBe('ignored')
  })

  it('calls a tracked directory tracked, whatever it is named', async () => {
    const build = path.join(root, 'repo/build')
    expect((await classifyByGit([build])).get(build)).toBe('tracked')
  })

  /**
   * `/delete-path`, `/shred-paths` and `/bulk-delete` are handed files, not
   * only directories. A containment test written as prefix-only never matches
   * a file against itself, so the gate would pass every single-file delete.
   */
  it('calls a tracked FILE tracked', async () => {
    const file = path.join(root, 'repo/src/app.ts')
    expect((await classifyByGit([file])).get(file)).toBe('tracked')
  })

  it('calls a path outside any repository unversioned', async () => {
    const loose = path.join(root, 'loose/dist')
    expect((await classifyByGit([loose])).get(loose)).toBe('unversioned')
  })

  it('answers for every input, including ones it could not resolve', async () => {
    const inputs = [path.join(root, 'repo/dist'), path.join(root, 'does/not/exist')]
    const r = await classifyByGit(inputs)
    for (const i of inputs) expect(r.has(i)).toBe(true)
  })
})

describe('the scanner asks git before offering anything', () => {
  it('marks a tracked match blocked rather than safe', async () => {
    const found = await findProjectArtifacts([path.join(root, 'repo')], 4, 0)

    const byName = (n: string) => found.find(a => path.basename(a.path) === n)

    // `build` here holds committed source. The pattern table calls it build
    // output; git overrules it.
    const build = byName('build')
    expect(build, 'the scanner found the build directory').toBeDefined()
    expect(build!.git).toBe('tracked')
    expect(build!.risk).toBe('blocked')

    // And the genuinely disposable one is still offered.
    const dist = byName('dist')
    expect(dist, 'the scanner found the dist directory').toBeDefined()
    expect(dist!.git).toBe('ignored')
    expect(dist!.risk).not.toBe('blocked')
  })

  it('never leaves a tracked artifact selectable', async () => {
    const found = await findProjectArtifacts([path.join(root, 'repo')], 4, 0)

    // The fixture commits a node_modules, which the pattern table rates
    // `safe` — so without the gate this assertion has nothing to catch.
    // path.join, not a literal '/': the scanner builds paths with the
    // platform separator, and this assertion passed on macOS while failing on
    // the Windows CI leg for no reason other than the slash.
    const needle = path.join('fixture-pkg', 'node_modules')
    const fixture = found.find(a => a.path.includes(needle))
    expect(fixture, 'the committed node_modules was scanned').toBeDefined()
    expect(fixture!.git).toBe('tracked')
    expect(fixture!.risk).toBe('blocked')

    const offered = found.filter(a => a.risk === 'safe' && a.git === 'tracked')
    expect(offered.map(a => a.path)).toEqual([])
  })
})

/**
 * A gate that cannot see must refuse, not wave things through.
 *
 * The first version of this had no way to say "git did not answer": every
 * failure produced `unversioned`, which is the permissive value, so the gate
 * silently ceased to exist and committed directories went back to being
 * offered as `safe` build output with no badge and no warning.
 *
 * It needed no contrived environment. A corrupt `.git/index` exits 128, and so
 * does a repository carrying an extension this git does not understand.
 */
describe('git refusing to answer', () => {
  it('is unknown, not unversioned, and unknown refuses deletion', async () => {
    const broken = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-git-broken-'))
    try {
      git(broken, 'init', '-q')
      write(path.join(broken, 'build/make.ts'), 'source')
      git(broken, 'add', '-f', '.')
      git(broken, 'commit', '-qm', 'init')

      const target = path.join(broken, 'build')
      expect((await classifyByGit([target])).get(target)).toBe('tracked')

      // Exactly what the review used to break it.
      fs.writeFileSync(path.join(broken, '.git', 'index'), 'garbage')

      const verdict = (await classifyByGit([target])).get(target)
      expect(verdict, 'a repo git cannot read is unknown, never unversioned').toBe('unknown')
      expect(refusesDeletion(verdict!), 'unknown must refuse').toBe(true)
    }
    finally {
      fs.rmSync(broken, { recursive: true, force: true })
    }
  })

  it('still calls a path with no repository at all unversioned', async () => {
    const loose = path.join(root, 'loose/dist')
    const verdict = (await classifyByGit([loose])).get(loose)
    // No repository is a real answer, and it must stay permissive - otherwise
    // ~/Library/Caches, which is the app's main job, stops being cleanable.
    expect(verdict).toBe('unversioned')
    expect(refusesDeletion(verdict!)).toBe(false)
  })
})
