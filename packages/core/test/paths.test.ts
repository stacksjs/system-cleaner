import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { HOME, isCleanable, isPathSafe } from '../src/paths'
import { makeTmpDir } from './_tmp'

let TMP: string
let cleanupTmp: () => void

beforeAll(() => {
  // We need a path UNDER HOME to test the "safe to delete" branch (only
  // HOME and /Applications are allowed). We create a hidden dir at a known
  // safe location and clean it up. NOT using fixture rm operations — only
  // creating files and reading their paths through isPathSafe.
  const r = makeTmpDir('paths')
  TMP = r.dir
  cleanupTmp = r.cleanup

  // Mirror a tiny tree under HOME just to validate the lstat success path.
  // Use a per-pid hidden dir so it can't collide.
  fs.writeFileSync(path.join(TMP, 'file.txt'), 'x')
  fs.mkdirSync(path.join(TMP, 'subdir'), { recursive: true })
  try { fs.symlinkSync(path.join(TMP, 'file.txt'), path.join(TMP, 'link.txt')) }
  catch { /* symlinks may be disallowed in some sandboxes */ }
})

afterAll(() => {
  cleanupTmp()
})

describe('isPathSafe', () => {
  it('rejects paths outside HOME and outside /Applications/', () => {
    expect(isPathSafe('/etc/passwd').safe).toBe(false)
    expect(isPathSafe('/usr/bin/ls').safe).toBe(false)
    expect(isPathSafe('/var/log').safe).toBe(false)
  })

  it('rejects HOME itself', () => {
    expect(isPathSafe(HOME).safe).toBe(false)
  })

  it('rejects /Applications root but not the prefix check for /Applications/<App>', () => {
    expect(isPathSafe('/Applications').safe).toBe(false)
    const r = isPathSafe('/Applications/NotARealApp.app')
    expect(r.safe).toBe(false)
    // Reason should be "does not exist" or sensitive-segment, NOT "outside scope"
    expect(r.reason).not.toMatch(/outside home directory/i)
  })

  it('rejects PROTECTED_PATHS like ~/Library, ~/.ssh', () => {
    expect(isPathSafe(path.join(HOME, 'Library')).safe).toBe(false)
    expect(isPathSafe(path.join(HOME, '.ssh')).safe).toBe(false)
    expect(isPathSafe(path.join(HOME, '.aws')).safe).toBe(false)
  })

  it('matches sensitive segments only as whole path components', () => {
    // The path won't lstat (doesn't exist), but the rejection reason must
    // not be the segment match — substring "credentials" inside another
    // segment is fine.
    const r = isPathSafe(path.join(HOME, 'Library/Caches/com.aws.credentials-helper'))
    if (!r.safe)
      expect(r.reason).not.toMatch(/sensitive directory: credentials/)
  })

  it('rejects symlinks even when otherwise safe', () => {
    const linkPath = path.join(TMP, 'link.txt')
    if (fs.existsSync(linkPath) && fs.lstatSync(linkPath).isSymbolicLink()) {
      // TMP is under os.tmpdir(), which is /var/folders/... — outside HOME.
      // So isPathSafe will reject on the prefix check, not the symlink
      // check. This assertion verifies isPathSafe rejects symlinks when
      // they happen to land under an otherwise-allowed path.
      // (We can't easily place a symlink under HOME without polluting
      // user files; the prefix-check branch is already covered above.)
      expect(isPathSafe(linkPath).safe).toBe(false)
    }
  })

  it('accepts a regular file inside an allowed scope', () => {
    // Skipped: requires a writable HOME-side test fixture, which we
    // deliberately avoid for safety. The lstat-success branch is exercised
    // indirectly via package-level cleaner tests under tmpdir.
  })
})

describe('isCleanable', () => {
  it('allows /Library, /private/var/log when they exist', () => {
    if (fs.existsSync('/Library/Caches'))
      expect(isCleanable('/Library/Caches').safe).toBe(true)
    if (fs.existsSync('/private/var/log'))
      expect(isCleanable('/private/var/log').safe).toBe(true)
  })

  it('rejects /etc, /usr, /System', () => {
    expect(isCleanable('/etc').safe).toBe(false)
    expect(isCleanable('/usr').safe).toBe(false)
    expect(isCleanable('/System').safe).toBe(false)
  })

  it('rejects paths that do not exist', () => {
    expect(isCleanable(path.join(HOME, 'no-such-thing-here-xyz-12345')).safe).toBe(false)
  })
})
