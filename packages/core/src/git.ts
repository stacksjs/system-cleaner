import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * What version control says about a path this app is about to delete.
 *
 * `ignored` is the only answer that makes a directory safe to remove on a name
 * match alone. The project itself declared it disposable, which is a stronger
 * statement than anything this app can infer from a directory being called
 * `dist`.
 */
export type GitDisposition = 'ignored' | 'tracked' | 'unversioned'

/** Timeout per git call. A repository walk should be milliseconds. */
const GIT_TIMEOUT_MS = 10_000

/**
 * The repository that owns a path, or null when nothing does.
 *
 * Memoized per directory because the artifact scanner asks about hundreds of
 * siblings and they nearly all resolve to the same root.
 */
const repoRootCache = new Map<string, string | null>()

export function repoRootOf(target: string): string | null {
  let dir = fs.existsSync(target) && fs.statSync(target).isDirectory() ? target : path.dirname(target)

  const seen: string[] = []
  while (true) {
    const cached = repoRootCache.get(dir)
    if (cached !== undefined) {
      for (const d of seen) repoRootCache.set(d, cached)
      return cached
    }
    seen.push(dir)

    if (fs.existsSync(path.join(dir, '.git'))) {
      for (const d of seen) repoRootCache.set(d, dir)
      return dir
    }

    const parent = path.dirname(dir)
    if (parent === dir) {
      for (const d of seen) repoRootCache.set(d, null)
      return null
    }
    dir = parent
  }
}

async function git(root: string, args: string[], stdin: string): Promise<{ ok: boolean, stdout: string }> {
  try {
    const proc = Bun.spawn(['git', '-C', root, ...args], {
      stdin: new TextEncoder().encode(stdin),
      stdout: 'pipe',
      stderr: 'ignore',
    })
    const timer = setTimeout(() => proc.kill('SIGKILL'), GIT_TIMEOUT_MS)
    const stdout = await new Response(proc.stdout).text()
    const code = await proc.exited
    clearTimeout(timer)

    // Read the exit code before trusting a single byte of stdout. `git
    // check-ignore` emits well-formed records and *then* dies 128 on a
    // corrupt index or an unreadable .gitignore, so parsing first and
    // checking after reads a partial answer as a complete one — and the
    // paths missing from that partial answer are exactly the ones that
    // would be called disposable.
    if (code !== 0 && code !== 1)
      return { ok: false, stdout: '' }
    return { ok: true, stdout }
  }
  catch {
    return { ok: false, stdout: '' }
  }
}

/**
 * Ask git what it thinks of each candidate before anything deletes it.
 *
 * Name-based classification is not enough and this app has the scars. A
 * directory called `build` is source in two repositories on the machine this
 * was written against (`storage/framework/core/build`, `scripts/build`); a
 * `dist` is a committed GitHub Action bundle whose removal breaks the action
 * for everyone using it; and `node_modules` is committed test fixture data in
 * every language runtime that ships one. Deleting those cost 285 tracked files
 * in a single afternoon, and they came back only because they happened to be
 * committed and the repositories happened to be otherwise clean.
 *
 * Two calls per repository rather than two per path: `check-ignore` settles
 * most candidates, and only the leftovers need `ls-files`.
 */
export async function classifyByGit(candidates: string[]): Promise<Map<string, GitDisposition>> {
  const result = new Map<string, GitDisposition>()
  for (const c of candidates) result.set(c, 'unversioned')
  if (candidates.length === 0)
    return result

  const byRepo = new Map<string, string[]>()
  for (const c of candidates) {
    const root = repoRootOf(c)
    if (!root) continue
    const list = byRepo.get(root)
    if (list) list.push(c)
    else byRepo.set(root, [c])
  }

  for (const [root, paths] of byRepo) {
    // Compare realpaths, because /tmp is a symlink to /private/tmp on macOS
    // and a containment test across the two never matches.
    const realRoot = fs.realpathSync(root)
    const contained: { input: string, real: string }[] = []
    for (const p of paths) {
      let real: string
      try { real = fs.realpathSync(p) }
      catch { continue }
      if (real === realRoot || real.startsWith(realRoot + path.sep))
        contained.push({ input: p, real })
    }
    if (contained.length === 0)
      continue

    const check = await git(root, ['check-ignore', '-v', '--non-matching', '-z', '--stdin'],
      `${contained.map(c => c.real).join('\0')}\0`)
    if (!check.ok)
      continue

    // `-z` emits four NUL-terminated fields per record: source, line,
    // pattern, pathname.
    const fields = check.stdout.split('\0')
    const ignored = new Set<string>()
    for (let i = 0; i + 3 < fields.length; i += 4) {
      const pattern = fields[i + 2]
      const pathname = fields[i + 3]
      // An empty pattern means nothing matched. A `!`-prefixed one means the
      // last pattern to match was a negation — git is saying this path is
      // *not* ignored, and reading that as consent to delete would turn the
      // gate into a new way to lose data. A literal bang is written `\!` in
      // a .gitignore and git prints the backslash, so the test is exact.
      if (pattern && !pattern.startsWith('!'))
        ignored.add(pathname)
    }

    const leftovers = contained.filter(c => !ignored.has(c.real))
    for (const c of contained) {
      if (ignored.has(c.real))
        result.set(c.input, 'ignored')
    }
    if (leftovers.length === 0)
      continue

    const tracked = await git(root, ['ls-files', '-z', '--', ...leftovers.map(c => c.real)], '')
    if (!tracked.ok)
      continue

    for (const rel of tracked.stdout.split('\0')) {
      if (!rel) continue
      const abs = path.join(realRoot, rel)
      for (const c of leftovers) {
        // Equality as well as prefix: `/delete-path`, `/shred-paths` and
        // `/bulk-delete` are handed files, not only directories, and a file
        // is never a prefix of itself plus a separator.
        if (abs === c.real || abs.startsWith(c.real + path.sep))
          result.set(c.input, 'tracked')
      }
    }
  }

  return result
}

/**
 * True when deleting this path would destroy something git is tracking.
 *
 * The single-path form, for the routes that accept a path from the client.
 */
export async function isTrackedByGit(target: string): Promise<boolean> {
  const map = await classifyByGit([target])
  return map.get(target) === 'tracked'
}
