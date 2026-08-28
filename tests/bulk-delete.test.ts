import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import process from 'node:process'

/**
 * Bulk deletion is the one place in this app where a bug destroys the user's
 * data, so the guard rails get a test rather than a manual pass.
 *
 * Two setup details matter:
 *
 *   - The tree lives under `$HOME`, not `/tmp`. `isPathSafe` refuses anything
 *     outside the home directory, so a `/tmp` fixture would make every case
 *     pass for the wrong reason.
 *   - The module is imported *after* `DB_DATABASE_PATH` is redirected at a
 *     throwaway file. `config/database.ts` reads the variable when it is first
 *     loaded, so a static import would bind the developer's real database and
 *     these tests would write cleanup history into it.
 */

const MB = 1024 * 1024
const MIGRATIONS = path.join(import.meta.dir, '../database/migrations')

let root: string
let dbPath: string
let bulk: typeof import('../app/Support/Cleanup/bulk-delete')

function write(relative: string, megabytes: number): string {
  const full = path.join(root, relative)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, Buffer.alloc(Math.round(megabytes * MB)))
  return full
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.homedir(), '.system-cleaner-test-'))
  dbPath = path.join(root, 'test.sqlite')

  // Apply the generated migrations straight to the throwaway file. The tables
  // are all this needs; the ledger the migrator maintains is not.
  const db = new Database(dbPath)
  for (const file of fs.readdirSync(MIGRATIONS).sort())
    db.run(fs.readFileSync(path.join(MIGRATIONS, file), 'utf8'))
  db.close()

  process.env.DB_CONNECTION = 'sqlite'
  process.env.DB_DATABASE_PATH = dbPath

  bulk = await import('../app/Support/Cleanup/bulk-delete')
})

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('bulkDelete', () => {
  it('deletes what it is given and reports the bytes it freed', async () => {
    const a = write('run1/a.bin', 2)
    const b = write('run1/b.bin', 3)

    const result = await bulk.bulkDelete([a, b], 'permanent', 'large-files')

    expect(result.succeeded.sort()).toEqual([a, b].sort())
    expect(result.failed).toEqual([])
    expect(result.freedBytes).toBe(5 * MB)
    expect(fs.existsSync(a)).toBe(false)
    expect(fs.existsSync(b)).toBe(false)
  })

  it('refuses protected paths without touching them', async () => {
    const keep = write('run2/keep.bin', 2)
    const go = write('run2/go.bin', 2)

    await bulk.protectPath(keep, 'test')
    const result = await bulk.bulkDelete([keep, go], 'permanent', 'large-files')

    expect(result.succeeded).toEqual([go])
    expect(result.skipped.map(s => s.path)).toEqual([keep])
    expect(fs.existsSync(keep)).toBe(true)

    await bulk.unprotectPath(keep)
  })

  it('refuses paths outside the home directory', async () => {
    const result = await bulk.bulkDelete(['/etc/hosts'], 'permanent', 'large-files')

    expect(result.succeeded).toEqual([])
    expect(result.skipped).toHaveLength(1)
    expect(fs.existsSync('/etc/hosts')).toBe(true)
  })

  it('refuses paths inside sensitive directories', async () => {
    const result = await bulk.bulkDelete(
      [path.join(os.homedir(), '.ssh/id_rsa')],
      'permanent',
      'large-files',
    )

    expect(result.succeeded).toEqual([])
    expect(result.skipped[0].reason).toContain('.ssh')
  })

  it('separates refused-before-trying from tried-and-failed', async () => {
    const missing = path.join(root, 'run3/never-existed.bin')
    const result = await bulk.bulkDelete([missing], 'permanent', 'large-files')

    // A path that does not exist is refused by the safety check, so it is a
    // skip. Reporting it as a failure would read as an app bug.
    expect(result.skipped).toHaveLength(1)
    expect(result.failed).toEqual([])
  })

  it('counts a duplicated path once', async () => {
    const dup = write('run4/dup.bin', 4)
    const result = await bulk.bulkDelete([dup, dup], 'permanent', 'large-files')

    expect(result.succeeded).toEqual([dup])
    expect(result.freedBytes).toBe(4 * MB)
  })

  it('sizes directories before removing them', async () => {
    write('run5/tree/one.bin', 2)
    write('run5/tree/nested/two.bin', 3)
    const dir = path.join(root, 'run5/tree')

    const result = await bulk.bulkDelete([dir], 'permanent', 'large-files')

    expect(result.succeeded).toEqual([dir])
    expect(result.freedBytes).toBeGreaterThanOrEqual(5 * MB)
    expect(fs.existsSync(dir)).toBe(false)
  })
})

describe('protected paths', () => {
  it('is idempotent and reversible', async () => {
    const target = path.join(root, 'protected/item.bin')

    await bulk.protectPath(target, 'first')
    await bulk.protectPath(target, 'second')

    const listed = await bulk.listProtectedPaths()
    expect(listed.filter(p => p.path === target)).toHaveLength(1)
    expect((await bulk.protectedPathSet()).has(target)).toBe(true)

    expect(await bulk.unprotectPath(target)).toEqual({ removed: true })
    expect(await bulk.unprotectPath(target)).toEqual({ removed: false })
  })
})

describe('cleanupHistory', () => {
  it('accumulates the bytes freed across runs', async () => {
    const before = await bulk.cleanupHistory()

    const target = write('history/item.bin', 6)
    await bulk.bulkDelete([target], 'permanent', 'large-files')

    const after = await bulk.cleanupHistory()
    expect(after.runCount).toBe(before.runCount + 1)
    expect(after.lifetimeFreedBytes).toBe(before.lifetimeFreedBytes + 6 * MB)
    expect(after.runs[0].mode).toBe('permanent')
    expect(after.runs[0].source).toBe('large-files')
  })

  it('records nothing when every path was refused', async () => {
    const before = await bulk.cleanupHistory()
    await bulk.bulkDelete(['/etc/hosts'], 'permanent', 'large-files')
    const after = await bulk.cleanupHistory()

    expect(after.runCount).toBe(before.runCount)
  })
})
