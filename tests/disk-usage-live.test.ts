import { expect, test } from 'bun:test'
import * as fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DiskChanges } from '../app/Support/Cleanup/disk-changes'
import { DAY_MS, discoverAIWorktrees, removeAIWorktree } from '../app/Support/Cleanup/disk-worktrees'

test('detects nested removals and advances the revision across a watch gap', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'disk-changes-test-'))
  const changes = new DiskChanges(root)
  try {
    const target = path.join(root, 'folder', 'file')
    fs.mkdirSync(path.dirname(target))
    fs.writeFileSync(target, 'temporary')
    const initial = changes.read(0)
    expect(initial.watching).toBe(true)
    // Native watch backends may arm asynchronously.
    await Bun.sleep(150)
    fs.unlinkSync(target)
    let current = changes.read(initial.revision)
    for (let attempt = 0; !current.removed.includes(target) && attempt < 50; attempt++) {
      await Bun.sleep(50)
      current = changes.read(initial.revision)
    }
    expect(current.removed).toContain(target)
    expect(current.revision).toBeGreaterThan(initial.revision)
    expect(changes.read(current.revision).removed).toEqual([])
    changes.close()
    expect(changes.read(current.revision).revision).toBeGreaterThan(current.revision)
  }
  finally {
    changes.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

function git(root: string, args: string[]): string {
  const result = Bun.spawnSync(['git', '-C', root, ...args])
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
  return result.stdout.toString().trim()
}

function ageTree(root: string, when: Date): void {
  if (fs.lstatSync(root).isDirectory())
    for (const name of fs.readdirSync(root)) ageTree(path.join(root, name), when)
  fs.utimesSync(root, when, when)
}

test('finds both Codex layouts and only removes clean old checkouts with retained commits', async () => {
  const root = fs.mkdtempSync(path.join(os.homedir(), '.disk-worktrees-test-'))
  const old = new Date(Date.now() - 4 * DAY_MS)
  const cutoff = Date.now() - 2 * DAY_MS
  const protectedPaths = new Set<string>()
  try {
    const repo = path.join(root, 'repo')
    fs.mkdirSync(repo)
    git(repo, ['init'])
    git(repo, ['config', 'user.name', 'Fixture'])
    git(repo, ['config', 'user.email', 'fixture@example.com'])
    git(repo, ['config', 'commit.gpgsign', 'false'])
    fs.mkdirSync(path.join(repo, 'nested'))
    fs.writeFileSync(path.join(repo, 'nested', 'example'), 'tracked')
    git(repo, ['add', '.'])
    git(repo, ['commit', '-m', 'initial'])

    function checkout(name: string): string {
      const target = path.join(root, '.codex', 'worktrees', name)
      git(repo, ['worktree', 'add', '--detach', target])
      return target
    }
    const clean = checkout('run-one/repo')
    const recent = checkout('run-two')
    const dirty = checkout('run-three')
    const detached = checkout('run-four')
    const locked = checkout('run-five')
    git(repo, ['worktree', 'lock', locked])
    fs.writeFileSync(path.join(dirty, 'nested', 'untracked'), 'local changes')
    git(detached, ['commit', '--allow-empty', '-m', 'unique'])
    for (const target of [clean, recent, dirty, detached, locked]) ageTree(target, old)
    ageTree(path.join(repo, '.git', 'worktrees'), old)
    // A file can change in place without updating the directory timestamp.
    const now = new Date()
    fs.utimesSync(path.join(recent, 'nested', 'example'), now, now)

    const worktrees = discoverAIWorktrees(protectedPaths, root, [])
    expect(worktrees.map(item => item.path).sort()).toEqual([clean, recent, dirty, detached, locked].sort())
    expect(worktrees.find(item => item.path === locked)?.blocked).toBe('Locked in Git')
    expect((await removeAIWorktree(recent, cutoff, protectedPaths, root)).skipped).toContain('modified')
    expect((await removeAIWorktree(dirty, cutoff, protectedPaths, root)).failed).toBeDefined()
    expect((await removeAIWorktree(detached, cutoff, protectedPaths, root)).skipped).toContain('Detached HEAD')
    expect((await removeAIWorktree(locked, cutoff, protectedPaths, root)).skipped).toContain('Locked')
    const protectedFile = new Set([path.join(clean, 'nested', 'example')])
    expect((await removeAIWorktree(clean, cutoff, protectedFile, root)).skipped).toContain('Protected')
    const removed = await removeAIWorktree(clean, cutoff, protectedPaths, root)
    expect(removed.removed).toBe(true)
    expect(removed.removedBytes).toBeGreaterThan(0)
    expect(git(repo, ['worktree', 'list', '--porcelain'])).not.toContain('run-one')
    for (const target of [recent, dirty, detached, locked]) expect(fs.existsSync(target)).toBe(true)
  }
  finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
