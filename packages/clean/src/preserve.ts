import * as fs from 'node:fs'
import * as path from 'node:path'
import { HOME, isWithin } from '@system-cleaner/core'

/**
 * Folders that survive a clean even when a target or a raw path covers them.
 *
 * `~/.claude/projects` holds two different things. Each project folder has its
 * session transcripts, which "Claude Code Session History" exists to remove,
 * and a `memory/` folder: the notes Claude Code keeps about the user and the
 * project across sessions. Nothing rebuilds those, and nothing about the row
 * said they would go. On 2026-11-23 one Quick Clean of that row took every
 * project's memory with the transcripts.
 *
 * A rule here is enforced wherever deletion happens - `cleanTarget`,
 * `cleanDirectory` and so `/clean-dir` - so it holds whichever path a clean
 * starts from: the target, `~/.claude`, or a single project folder.
 */
export interface PreserveRule {
  /** Absolute folder the pattern is relative to. */
  root: string
  /** Path segments below `root`; `*` matches any one entry. */
  pattern: string[]
  /** Why it is kept, for the next person reading this list. */
  why: string
}

export const PRESERVE_RULES: PreserveRule[] = [
  {
    root: path.join(HOME, '.claude', 'projects'),
    pattern: ['*', 'memory'],
    why: 'Claude Code memory: notes kept across sessions that nothing rebuilds',
  },
]

function real(p: string): string {
  try {
    return fs.realpathSync(p)
  }
  catch {
    return path.resolve(p)
  }
}

/** Every existing folder a rule names, as real paths. */
function expand(rule: PreserveRule): string[] {
  let found = [real(rule.root)]
  for (const segment of rule.pattern) {
    const next: string[] = []
    for (const dir of found) {
      if (segment === '*') {
        let entries: fs.Dirent[] = []
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true })
        }
        catch {
          continue
        }
        for (const e of entries) {
          if (e.isDirectory())
            next.push(path.join(dir, e.name))
        }
      }
      else if (fs.existsSync(path.join(dir, segment))) {
        next.push(path.join(dir, segment))
      }
    }
    found = next
  }
  return found
}

/**
 * The preserved folders a clean of `dir` could reach: those inside it, and the
 * one it sits in when `dir` is itself inside a preserved folder.
 */
export function preservedFor(dir: string, rules: PreserveRule[] = PRESERVE_RULES): string[] {
  const target = real(dir)
  return rules
    .flatMap(expand)
    .filter(kept => isWithin(kept, target) || isWithin(target, kept))
}

/**
 * Remove everything inside `dir` except the `keep` folders.
 *
 * An entry that holds a kept folder is opened and cleaned one level down
 * instead of removed, so the transcripts beside a `memory/` folder still go.
 * Entries matching `skip` (a target's skipPatterns) are left alone at the top
 * level, as before.
 */
export function removeContents(
  dir: string,
  keep: string[],
  out: { errors: string[], kept: string[] },
  skip: RegExp[] = [],
): void {
  const base = real(dir)
  for (const entry of fs.readdirSync(dir)) {
    if (skip.some(r => r.test(entry))) {
      out.kept.push(entry)
      continue
    }
    const entryPath = path.join(dir, entry)
    const realEntry = path.join(base, entry)
    if (keep.some(kept => isWithin(realEntry, kept))) {
      out.kept.push(realEntry)
      continue
    }
    if (keep.some(kept => isWithin(kept, realEntry))) {
      try {
        removeContents(entryPath, keep, out)
      }
      catch (err) {
        out.errors.push(`${entry}: ${err instanceof Error ? err.message : String(err)}`)
      }
      continue
    }
    try {
      fs.rmSync(entryPath, { recursive: true, force: true })
    }
    catch (err) {
      out.errors.push(`${entry}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}
