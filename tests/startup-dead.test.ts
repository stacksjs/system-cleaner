import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { isTargetMissing, removeStartupItems } from '../packages/uninstall/src/discover'

/**
 * A launch agent whose program is gone.
 *
 * This is the only state on the Startup Items screen that can be acted on
 * without knowing what the entry does — launchd cannot execute a path that
 * does not exist, so removing it changes nothing about what runs. That makes
 * it the one row the screen is allowed to sweep in bulk, which puts the whole
 * weight of the feature on this predicate being conservative.
 *
 * The direction of the error matters. A missed dead entry leaves junk in a
 * list; a live entry called dead gets swept into a batch delete and takes a
 * working daemon with it. So everything the predicate cannot answer has to
 * come back `false`, and that is most of what these tests pin down.
 *
 * Found by hand on the development machine: three Homebrew daemons still
 * pointing at `php-fpm` for formulae that had been uninstalled, and a Google
 * updater agent whose bundle was gone. All four sat in the list looking
 * exactly like the twenty-nine live ones.
 */

let root: string

/**
 * This suite runs on Windows too, where two of these cases do not apply.
 *
 * Creating a symlink there needs a privilege the runner does not have, and
 * `access()` on a dangling one answers for the reparse point rather than
 * following it, so a broken link reads as present. Neither matters to the
 * code: launchd is macOS-only, and the Windows scanner has its own existence
 * check in `startup-windows.ts`. The case is skipped rather than weakened,
 * because on macOS it is the behaviour the sweep depends on.
 */
const POSIX = process.platform !== 'win32'

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'system-cleaner-dead-'))
  fs.writeFileSync(path.join(root, 'real-binary'), '#!/bin/sh\n')
  if (POSIX)
    fs.symlinkSync(path.join(root, 'no-such-target'), path.join(root, 'broken-link'))
})

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('detecting a startup entry whose program is gone', () => {
  it('flags an absolute path that is not there', () => {
    expect(isTargetMissing(path.join(root, 'nope/php-fpm'))).toBe(true)
  })

  it.skipIf(!POSIX)('flags a symlink with nothing on the other end', () => {
    // launchd resolves the link and fails, so a dangling link is as dead as
    // a missing file. `access()` follows symlinks, which is what gets this.
    expect(isTargetMissing(path.join(root, 'broken-link'))).toBe(true)
  })

  it('leaves a program that exists alone', () => {
    expect(isTargetMissing(path.join(root, 'real-binary'))).toBe(false)
  })

  it('treats a missing Program key as unknown, not dead', () => {
    // launchd also accepts `BundleProgram`, and an on-demand agent may carry
    // only `MachServices`. `parsePlist` reports '' for all of them.
    expect(isTargetMissing('')).toBe(false)
  })

  it('treats a bare command as unknown, not dead', () => {
    // Resolved through launchd's own PATH, which this cannot reconstruct.
    expect(isTargetMissing('php-fpm')).toBe(false)
    expect(isTargetMissing('./relative/thing')).toBe(false)
  })
})

describe('removing dead entries in bulk', () => {
  it('refuses a path outside the launchd directories', async () => {
    const outside = path.join(root, 'real-binary')
    const result = await removeStartupItems([outside])

    expect(result.succeeded).toEqual([])
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0].error).toBe('Invalid launch agent path')
    // The point of the guard: it did not touch the file on the way to saying no.
    expect(fs.existsSync(outside)).toBe(true)
  })

  it('refuses a traversal that lands outside them', async () => {
    const agents = path.join(os.homedir(), 'Library/LaunchAgents')
    const sentinel = path.join(root, 'sentinel.plist')
    fs.writeFileSync(sentinel, 'x')

    // A `..` chain starting inside the allowed directory and resolving onto a
    // file this test owns, so the guard can actually be caught deleting it.
    // `/etc/hosts` played that part and does not exist on Windows, where this
    // suite also runs.
    // On a Windows runner whose temp directory is on another drive,
    // `path.relative` gives back an absolute path with no `..` in it. That is
    // still a path outside the allowed roots, which is the thing being
    // refused, so the case holds either way rather than failing on where the
    // runner happens to put its temp files.
    const traversal = `${agents}${path.sep}${path.relative(agents, sentinel)}`

    const result = await removeStartupItems([traversal])

    expect(result.succeeded).toEqual([])
    expect(result.failed[0].error).toBe('Invalid launch agent path')
    expect(fs.existsSync(sentinel)).toBe(true)
  })

  it('reports every rejected path rather than stopping at the first', async () => {
    const result = await removeStartupItems(['relative.plist', '/tmp/x.plist'])

    expect(result.succeeded).toEqual([])
    expect(result.failed).toHaveLength(2)
  })

  it('removes a user agent without a password prompt', async () => {
    // User agents are unlinked directly; only system ones go through
    // osascript. Writing into the real LaunchAgents directory is the only way
    // to exercise that split, so the file is uniquely named and the test owns
    // it start to finish.
    const dir = path.join(os.homedir(), 'Library/LaunchAgents')
    if (!fs.existsSync(dir)) return

    const plist = path.join(dir, `com.system-cleaner.test-${process.pid}.plist`)
    fs.writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>Label</key><string>com.system-cleaner.test</string>
  <key>Program</key><string>${path.join(root, 'nope/never')}</string>
</dict></plist>
`)

    try {
      const result = await removeStartupItems([plist])
      expect(result.failed).toEqual([])
      expect(result.succeeded).toEqual([plist])
      expect(fs.existsSync(plist)).toBe(false)
    }
    finally {
      fs.rmSync(plist, { force: true })
    }
  }, 15_000)
})
