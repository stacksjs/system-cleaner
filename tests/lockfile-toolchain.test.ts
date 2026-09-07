import { describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * `bun.lock` is in the format the Bun this project declares actually writes.
 *
 * `deps.yaml` pins `bun.sh` and pantry installs it to `pantry/.bin/bun`, which
 * `./buddy` puts ahead of any Bun on PATH. A plain `bun install` typed in a
 * shell that has not activated that environment uses whatever Bun is on PATH
 * instead, and an older one writes an older lockfile format. Nothing complains:
 * the install succeeds, the app runs, the tests pass, and the wrong-format
 * lockfile gets committed.
 *
 * It surfaces at the worst moment. A release regenerates the lockfile with the
 * declared toolchain and refuses to commit one whose format differs from the
 * file already in the repository — correctly, because a release must not
 * quietly change the format the rest of the team and CI install from. So the
 * release aborts, and it aborts on the state of a commit that landed days
 * earlier. That is how v0.3.0 failed: `bun.lock` said lockfileVersion 1,
 * written by a 1.3 on PATH, while `deps.yaml` had declared `^1.4.1` for weeks.
 *
 * The mapping from Bun version to lockfile format is derived here rather than
 * written down, because hardcoding it just moves the staleness somewhere the
 * next Bun release can break.
 */

const root = join(import.meta.dir, '..')

/** The `bun.sh` range `deps.yaml` declares, e.g. `^1.4.1`. */
function declaredBunRange(): string | null {
  const deps = readFileSync(join(root, 'deps.yaml'), 'utf8')
  return deps.match(/^\s*bun\.sh:\s*(\S+)\s*$/m)?.[1] ?? null
}

function lockfileVersion(contents: string): number | null {
  const match = contents.match(/"lockfileVersion"\s*:\s*(\d+)/)
  return match ? Number(match[1]) : null
}

/**
 * The lockfile format this Bun writes, asked rather than assumed.
 *
 * The probe declares a workspace member and no dependencies, so it resolves
 * nothing and needs neither network nor cache. The member is what makes Bun
 * write the file at all — with nothing to record it writes no lockfile, and
 * the probe has nothing to read.
 */
function lockfileVersionThisBunWrites(): number | null {
  const dir = mkdtempSync(join(tmpdir(), 'system-cleaner-lockfmt-'))

  try {
    mkdirSync(join(dir, 'member'))
    writeFileSync(join(dir, 'package.json'), '{"name":"lockfmt-probe","version":"0.0.0","workspaces":["member"]}\n')
    writeFileSync(join(dir, 'member', 'package.json'), '{"name":"lockfmt-member","version":"0.0.0"}\n')
    Bun.spawnSync([process.execPath, 'install', '--lockfile-only'], { cwd: dir, stdout: 'pipe', stderr: 'pipe' })

    return lockfileVersion(readFileSync(join(dir, 'bun.lock'), 'utf8'))
  }
  catch {
    return null
  }
  finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('bun.lock', () => {
  const range = declaredBunRange()

  it('is the format the declared Bun writes', () => {
    expect(range).not.toBeNull()

    // Only the declared toolchain gets a vote. CI installs `bun-version:
    // latest` and a contributor may have anything on PATH; asking either of
    // those to agree with the committed format would fail this the day Bun
    // changes it, on a lockfile that is perfectly correct for the Bun this
    // project pins. Under `./buddy test` the pantry Bun is the one running, so
    // the check is live exactly where the bad lockfile would be authored.
    if (!Bun.semver.satisfies(Bun.version, range!)) {
      console.warn(
        `Skipped: running Bun ${Bun.version} does not satisfy the declared ${range}. `
        + 'Run this through `./buddy test` to check the lockfile format.',
      )
      return
    }

    const committed = lockfileVersion(readFileSync(join(root, 'bun.lock'), 'utf8'))
    const expected = lockfileVersionThisBunWrites()

    expect(expected).not.toBeNull()
    expect({ committed, writtenBy: `bun@${Bun.version}` }).toEqual({ committed: expected, writtenBy: `bun@${Bun.version}` })
  })
})
