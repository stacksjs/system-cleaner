import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

/**
 * Allocate an isolated temp directory for a test file. Uses `os.tmpdir()`
 * (the system temp directory, not the user's HOME), so a misbehaving
 * cleanup or rmSync can't escape into the user's real files.
 *
 * Every call returns a fresh directory under a per-test prefix; pass the
 * unique slug from the calling test (e.g. file basename) so concurrent
 * tests don't collide.
 *
 * The returned object exposes `cleanup()` which guards against any rm
 * outside the system tmp root before deleting.
 */
export function makeTmpDir(slug: string): { dir: string, cleanup: () => void } {
  const tmpRoot = fs.realpathSync(os.tmpdir())
  const dir = fs.mkdtempSync(path.join(tmpRoot, `system-cleaner-${slug}-`))

  const cleanup = () => {
    const resolved = fs.realpathSync(dir)
    // Defence in depth: never rm anything outside the system temp root.
    if (!resolved.startsWith(`${tmpRoot}${path.sep}`) && resolved !== tmpRoot)
      throw new Error(`refusing to rm outside tmpdir: ${resolved}`)
    if (resolved === tmpRoot)
      throw new Error(`refusing to rm tmpdir root itself`)
    fs.rmSync(resolved, { recursive: true, force: true })
  }

  return { dir, cleanup }
}
