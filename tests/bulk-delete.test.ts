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
let history: typeof import('../app/Support/Cleanup/history')

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
  history = await import('../app/Support/Cleanup/history')
})

afterAll(() => {
  // Windows refuses to unlink a directory while anything still holds a handle
  // inside it, and SQLite drops its file lock a moment after close() returns -
  // so the first attempt failed EBUSY on the runner and took the whole suite
  // down from an afterAll. Retry briefly, then give up: this is a temp
  // directory, and failing to tidy it is not a test result.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.rmSync(root, { recursive: true, force: true })
      return
    }
    catch {
      Bun.sleepSync(100)
    }
  }
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
    // A real file outside the profile, chosen per platform: /etc/hosts does
    // not exist on Windows, so the final assertion failed there even though
    // the refusal itself worked. The test is about the refusal, not about
    // which operating system ships which file.
    const outside = process.platform === 'win32'
      ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts')
      : '/etc/hosts'

    const result = await bulk.bulkDelete([outside], 'permanent', 'large-files')

    expect(result.succeeded).toEqual([])
    expect(result.skipped).toHaveLength(1)
    expect(fs.existsSync(outside), 'the file must still be there').toBe(true)
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

  it('reports lifetime and local calendar-year totals without counting moved-to-Trash bytes as permanent', async () => {
    const before = await history.cleanupStats()
    await history.recordCleanupRun({ source: 'ai-worktrees', mode: 'permanent', itemCount: 2, failedCount: 1, freedBytes: 4 * MB })
    await history.recordCleanupRun({ source: 'disk', mode: 'trash', itemCount: 1, failedCount: 0, freedBytes: 6 * MB })
    const now = new Date()
    const priorYear = now.getFullYear() - 1
    const db = new Database(dbPath)
    db.run(
      'INSERT INTO cleanup_runs (source, mode, item_count, freed_bytes, created_at) VALUES (?, ?, ?, ?, ?)',
      ['disk', 'permanent', 1, 2 * MB, new Date(priorYear, 11, 31, 12).toISOString()],
    )
    db.close()

    const after = await history.cleanupStats()
    const current = after.years.find(period => period.year === now.getFullYear())
    expect(after.lifetime.permanentBytes).toBe(before.lifetime.permanentBytes + 6 * MB)
    expect(after.lifetime.trashedBytes).toBe(before.lifetime.trashedBytes + 6 * MB)
    expect(after.lifetime.worktrees).toBe(before.lifetime.worktrees + 2)
    expect(current?.sources.find(source => source.source === 'ai-worktrees')?.permanentBytes).toBe(4 * MB)
    expect(after.years.find(period => period.year === priorYear)?.permanentBytes).toBe(2 * MB)
  })

  it('records nothing when every path was refused', async () => {
    const before = await bulk.cleanupHistory()
    await bulk.bulkDelete(['/etc/hosts'], 'permanent', 'large-files')
    const after = await bulk.cleanupHistory()

    expect(after.runCount).toBe(before.runCount)
  })
})

/**
 * "Keep a cleanup history" in Settings. The switch lives in the database, not
 * in the window's localStorage, because the agent writes the history and the
 * scheduled clean writes it with no window open at all.
 */
describe('Keep a cleanup history', () => {
  it('is on before anyone has touched it', async () => {
    expect(await history.historyEnabled()).toBe(true)
  })

  it('stops writing cleans down once it is off, and the clean still happens', async () => {
    expect(await history.setHistoryEnabled(false)).toBe(false)
    try {
      const before = await bulk.cleanupHistory()
      const target = write('history-off/item.bin', 3)

      const result = await bulk.bulkDelete([target], 'permanent', 'large-files')

      expect(result.succeeded).toEqual([target])
      expect(fs.existsSync(target)).toBe(false)
      const after = await bulk.cleanupHistory()
      expect(after.runCount).toBe(before.runCount)
      expect(after.lifetimeFreedBytes).toBe(before.lifetimeFreedBytes)
    }
    finally {
      await history.setHistoryEnabled(true)
    }
  })

  it('writes them again once it is back on', async () => {
    expect(await history.setHistoryEnabled(true)).toBe(true)
    const before = await bulk.cleanupHistory()
    await bulk.bulkDelete([write('history-on/item.bin', 1)], 'permanent', 'large-files')
    expect((await bulk.cleanupHistory()).runCount).toBe(before.runCount + 1)
  })

  it('is the only way a clean reaches the history', async () => {
    // A new endpoint that copied an old `CleanupRun.create` would write
    // history with the switch off, and nothing else would notice.
    const offenders: string[] = []
    for (const file of ['routes/api.ts', ...new Bun.Glob('app/**/*.ts').scanSync('.')]) {
      if (file.replaceAll('\\', '/').endsWith('app/Support/Cleanup/history.ts'))
        continue
      if ((await Bun.file(file).text()).includes('CleanupRun.create('))
        offenders.push(file)
    }
    expect(offenders).toEqual([])
  })
})


describe('Activity history', () => {
  it('records lifecycle, screen visits, action outcomes, and restores history across reports', async () => {
    const activity = await import('../app/Support/Activity/history')
    const year = new Date().getFullYear()
    const before = await activity.activityReport(year, 'all', 1)
    const sessionId = await activity.startDesktopActivity()
    expect(sessionId).toBeGreaterThan(0)
    expect(await activity.recordScreenVisit('/app/activity', true)).toBe(true)
    expect(await activity.recordScreenVisit('/personal/file.txt', false)).toBe(false)

    const operation = activity.trackActivity('disk-remove-worktrees', () => Response.json({
      success: true, outcomes: [{ removed: true }, { skipped: 'Locked' }],
    }))
    await operation(new Request('http://localhost/api/disk-remove-worktrees', {
      method: 'POST', body: JSON.stringify({ paths: ['/personal/file.txt'] }),
    }))
    const blocked = activity.trackActivity('delete-path', () => Response.json({ success: false }, { status: 403 }))
    await blocked(new Request('http://localhost/api/delete-path', { method: 'POST' }))
    await activity.closeDesktopActivity(sessionId)

    const after = await activity.activityReport(year, 'all', 1)
    expect(after.lifetime.launches).toBe(before.lifetime.launches + 1)
    expect(after.lifetime.exits).toBe(before.lifetime.exits + 1)
    expect(after.period.actions).toBe(before.period.actions + 2)
    expect(after.period.windows).toBe(before.period.windows + 1)
    expect(after.timeline.slice(0, 4).map(event => event.status)).toEqual(['blocked', 'partial', 'completed', 'completed'])
    expect(JSON.stringify(after)).not.toContain('/personal/file.txt')
    expect((await activity.activityReport(year, 'session', 1)).timeline.every(event => event.kind === 'session')).toBe(true)
  })

  it('counts an exit in the year it happened when a session spans New Year', async () => {
    const activity = await import('../app/Support/Activity/history')
    const year = new Date().getFullYear()
    const before = await activity.activityReport(year, 'session', 1)
    const db = new Database(dbPath)
    const started = new Date(year - 1, 11, 31, 23, 58).getTime()
    const exited = new Date(year, 0, 1, 0, 2).getTime()
    db.run(
      "INSERT INTO activity_events (kind,action,source,status,started_at,finished_at,owner_pid) VALUES ('session','app','desktop','completed',?,?,0)",
      [started, exited],
    )
    db.close()
    const after = await activity.activityReport(year, 'session', 1)
    expect(after.period.launches).toBe(before.period.launches)
    expect(after.period.exits).toBe(before.period.exits + 1)
    expect(after.timeline.some(event => event.startedAt === started && event.finishedAt === exited)).toBe(true)
  })

  it('recovers abandoned events and honors the recording preference', async () => {
    const activity = await import('../app/Support/Activity/history')
    const db = new Database(dbPath)
    db.run("INSERT INTO activity_events (kind,action,source,status,started_at,owner_pid) VALUES ('session','app','desktop','running',?,2147483647)", [Date.now()])
    db.close()
    await activity.recoverInterruptedActivity()
    const year = new Date().getFullYear()
    const before = await activity.activityReport(year, 'all', 1)
    expect(before.timeline[0].status).toBe('interrupted')
    expect(before.timeline[0].finishedAt).toBeNull()

    await history.setHistoryEnabled(false)
    try {
      expect(await activity.startDesktopActivity()).toBeUndefined()
      await activity.recordScreenVisit('/app', true)
      const operation = activity.trackActivity('delete-path', () => Response.json({ success: true }))
      expect((await operation(new Request('http://localhost/api/delete-path', { method: 'POST' }))).ok).toBe(true)
      const after = await activity.activityReport(year, 'all', 1)
      expect(after.recording).toBe(false)
      expect(after.lifetime).toEqual(before.lifetime)
    }
    finally {
      await history.setHistoryEnabled(true)
    }
  })
})
