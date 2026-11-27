import { execFile } from 'node:child_process'
import * as fs from 'node:fs'
import { lstat, readdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { getDirSize, HOME, isPathSafe, isWithin } from '@system-cleaner/core'
import { DEFAULT_PROJECT_ROOTS } from '@system-cleaner/disk'

const run = promisify(execFile)
export const DAY_MS = 86_400_000
export const WORKTREE_BATCH = 8

type Tool = 'Codex' | 'Claude Code' | 'Cursor'
export interface AIWorktree {
  path: string
  name: string
  tool: Tool
  project: string
  modifiedAt: number
  blocked: string
}

function directories(root: string): string[] {
  try {
    if (!fs.lstatSync(root).isDirectory()) return []
    return fs.readdirSync(root, { withFileTypes: true })
      .filter(item => item.isDirectory())
      .map(item => path.join(root, item.name))
  }
  catch { return [] }
}

function worktreeTool(target: string, home: string): Tool | undefined {
  if (!isWithin(target, home)) return
  const parts = path.relative(home, target).split(path.sep)
  if (parts[1] === 'worktrees' && (parts.length === 3 || parts.length === 4)) {
    if (parts[0] === '.codex') return 'Codex'
    if (parts[0] === '.cursor') return 'Cursor'
  }
  if (parts.at(-3) === '.claude' && parts.at(-2) === 'worktrees') return 'Claude Code'
}

function readPointer(file: string): string {
  const stat = fs.lstatSync(file)
  if (!stat.isFile() || stat.size > 8192) throw new Error('Invalid Git worktree pointer')
  return fs.readFileSync(file, 'utf8').trim()
}

/** Check the reciprocal .git and gitdir pointers before trusting a checkout. */
function registration(target: string) {
  const dotGit = path.join(target, '.git')
  const pointer = readPointer(dotGit)
  if (!pointer.startsWith('gitdir: ')) throw new Error('Not a linked Git worktree')
  const admin = fs.realpathSync(path.resolve(target, pointer.slice(8)))
  const common = fs.realpathSync(path.resolve(admin, readPointer(path.join(admin, 'commondir'))))
  if (isWithin(common, target) || path.dirname(admin) !== path.join(common, 'worktrees')
    || fs.realpathSync(path.resolve(admin, readPointer(path.join(admin, 'gitdir')))) !== fs.realpathSync(dotGit))
    throw new Error('Git registration does not match this folder')
  return { admin, common }
}

function mtime(target: string): number {
  return fs.lstatSync(target, { throwIfNoEntry: false })?.mtimeMs ?? 0
}

function activity(target: string, admin: string): number {
  return Math.max(mtime(target), mtime(path.join(admin, 'HEAD')), mtime(path.join(admin, 'logs', 'HEAD')), mtime(path.join(admin, 'index')))
}

export function overlapsProtectedPath(target: string, protectedPaths: ReadonlySet<string>): boolean {
  return [...protectedPaths].some(protectedPath => isWithin(target, protectedPath) || isWithin(protectedPath, target))
}

export function discoverAIWorktrees(
  protectedPaths: ReadonlySet<string>,
  home = HOME,
  projectRoots: string[] = DEFAULT_PROJECT_ROOTS,
  scannedClaudeRoots: string[] = [],
): AIWorktree[] {
  const paths = new Set<string>()
  for (const tool of ['.codex', '.cursor']) {
    const parent = path.join(home, tool)
    for (const group of directories(path.join(parent, 'worktrees'))) {
      if (fs.existsSync(path.join(group, '.git'))) paths.add(group)
      else for (const checkout of directories(group)) paths.add(checkout)
    }
  }

  function gatherClaude(root: string, depth: number): void {
    const managed = path.join(root, '.claude', 'worktrees')
    for (const checkout of directories(managed)) paths.add(checkout)
    if (depth <= 0 || fs.existsSync(path.join(root, '.git'))) return
    for (const child of directories(root)) {
      const name = path.basename(child)
      if (!name.startsWith('.') && !['node_modules', 'vendor', 'Library'].includes(name))
        gatherClaude(child, depth - 1)
    }
  }
  for (const checkout of directories(path.join(home, '.claude', 'worktrees'))) paths.add(checkout)
  for (const root of projectRoots) gatherClaude(root, 3)
  for (const root of scannedClaudeRoots) for (const checkout of directories(root)) paths.add(checkout)

  const realHome = fs.realpathSync(home)
  const result: AIWorktree[] = []
  for (const target of paths) {
    const tool = worktreeTool(target, home)
    if (!tool) continue
    try {
      if (fs.realpathSync(target) !== path.join(realHome, path.relative(home, target))) continue
      if (!fs.lstatSync(path.join(target, '.git'), { throwIfNoEntry: false })?.isFile()) continue
      const item: AIWorktree = { path: target, name: path.basename(target), tool, project: path.basename(target), modifiedAt: mtime(target), blocked: '' }
      try {
        const { admin, common } = registration(target)
        item.project = path.basename(common) === '.git' ? path.basename(path.dirname(common)) : path.basename(common, '.git')
        item.modifiedAt = activity(target, admin)
        if (fs.existsSync(path.join(admin, 'locked'))) item.blocked = 'Locked in Git'
      }
      catch { item.blocked = 'Git registration is missing or invalid' }
      if (overlapsProtectedPath(target, protectedPaths)) item.blocked = 'Protected in SystemCleaner'
      result.push(item)
    }
    catch { /* A worktree can disappear while discovery is running. */ }
  }
  return result
}

async function hasRecentChanges(target: string, cutoff: number): Promise<boolean> {
  if (process.platform !== 'win32') {
    // Native find short-circuits on the first match and never follows symlinks.
    const date = new Date(Math.floor(cutoff / 1000) * 1000).toISOString().replace('T', ' ').replace('.000Z', ' +0000')
    const { stdout } = await run('/usr/bin/find', [target, '-newermt', date, '-print', '-quit'], { timeout: 30_000 })
    return !!stdout
  }
  const deadline = Date.now() + 30_000
  const pending = [target]
  while (pending.length) {
    if (Date.now() > deadline) throw new Error('Timed out checking file modification dates')
    const current = pending.pop()!
    const stat = await lstat(current)
    if (stat.mtimeMs > cutoff) return true
    if (stat.isDirectory()) {
      for (const name of await readdir(current)) pending.push(path.join(current, name))
    }
  }
  return false
}

const cleanups = new Set<string>()

/** Remove only a verified, old linked checkout using Git's non-forced remove. */
export async function removeAIWorktree(target: string, cutoff: number, protectedPaths: ReadonlySet<string>, home = HOME) {
  if (!path.isAbsolute(target) || path.resolve(target) !== target || !worktreeTool(target, home))
    return { skipped: 'Outside supported AI worktree locations' }
  if (cleanups.has(target)) return { skipped: 'Another cleanup is checking this worktree' }
  cleanups.add(target)
  try {
    const safety = isPathSafe(target)
    if (!safety.safe) return { skipped: safety.reason || 'Path is unavailable' }
    const realHome = fs.realpathSync(home)
    if (fs.realpathSync(target) !== path.join(realHome, path.relative(home, target)))
      return { skipped: 'The folder is reached through a symbolic link' }
    if (overlapsProtectedPath(target, protectedPaths)) return { skipped: 'Protected in SystemCleaner' }
    if (isWithin(process.cwd(), target)) return { skipped: 'The current workspace is in this worktree' }

    const { admin, common } = registration(target)
    if (fs.existsSync(path.join(admin, 'locked'))) return { skipped: 'Locked in Git' }
    if (['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer', 'BISECT_START'].some(name => fs.existsSync(path.join(admin, name))))
      return { skipped: 'A Git operation is in progress' }
    if (activity(target, admin) > cutoff || await hasRecentChanges(target, cutoff))
      return { skipped: 'Files were modified inside the selected age window' }

    const head = readPointer(path.join(admin, 'HEAD'))
    if (!head.startsWith('ref: refs/heads/')) {
      if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(head)) return { skipped: 'Git HEAD could not be verified' }
      const { stdout } = await run('git', ['--git-dir', common, 'for-each-ref', '--count=1', `--contains=${head}`, '--format=%(refname)', 'refs/heads', 'refs/remotes', 'refs/tags'], { timeout: 15_000 })
      if (!stdout.trim()) return { skipped: 'Detached HEAD has commits without a branch or tag' }
    }

    const removedBytes = await getDirSize(target)

    // A concurrent checkout invalidates the earlier HEAD and date checks.
    if (readPointer(path.join(admin, 'HEAD')) !== head || activity(target, admin) > cutoff)
      return { skipped: 'The worktree changed during cleanup' }
    await run('git', ['--git-dir', common, 'worktree', 'remove', '--', target], { timeout: 30_000 })
    return { removed: true, removedBytes }
  }
  catch (error) {
    const detail = error as Error & { stderr?: string }
    return { failed: detail.stderr?.trim().split('\n')[0] || detail.message || 'Could not remove worktree' }
  }
  finally {
    cleanups.delete(target)
  }
}
