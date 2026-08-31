import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { buildKeepClause } from '../packages/clean/src/privacy'

/**
 * The cookie keep-list, against a real database with a real Chromium-shaped
 * `cookies` table.
 *
 * This is the piece of the privacy clean where a bug is expensive in both
 * directions. Too loose and a clear leaves the tracking cookies behind; too
 * tight and it signs the user out of the sites they explicitly named — which
 * is the exact failure the keep-list exists to prevent, so a silent regression
 * here would take the feature's whole value with it.
 */

const TMP_ROOT = fs.realpathSync(os.tmpdir())
let ROOT: string

const HOSTS = [
  'github.com',
  '.github.com',
  '.gist.github.com',
  'notgithub.com',
  '.evilgithub.com',
  'example.com',
  '.ads.tracker.net',
  'mail.google.com',
]

function makeCookieDb(): string {
  const file = path.join(ROOT, `cookies-${Math.floor(Math.random() * 1e9)}.db`)
  const db = new Database(file, { create: true })
  db.run('CREATE TABLE cookies (host_key TEXT, name TEXT)')
  for (const host of HOSTS)
    db.run('INSERT INTO cookies (host_key, name) VALUES (?, ?)', [host, 'session'])
  db.close()
  return file
}

function survivors(file: string, domains: string[]): string[] {
  const db = new Database(file, { readwrite: true })
  try {
    const { clause, params } = buildKeepClause('host_key', domains)
    db.run(`DELETE FROM cookies WHERE NOT (${clause})`, params)
    return (db.query('SELECT host_key FROM cookies ORDER BY host_key').all() as Array<{ host_key: string }>)
      .map(row => row.host_key)
  }
  finally {
    db.close()
  }
}

beforeAll(() => {
  ROOT = fs.mkdtempSync(path.join(TMP_ROOT, 'system-cleaner-keeplist-'))
})

afterAll(() => {
  const resolved = fs.realpathSync(ROOT)
  if (!resolved.startsWith(`${TMP_ROOT}${path.sep}`))
    throw new Error(`refusing to rm outside tmpdir: ${resolved}`)
  fs.rmSync(resolved, { recursive: true, force: true })
})

describe('cookie keep-list', () => {
  it('keeps the domain in both of the forms browsers store it', () => {
    expect(survivors(makeCookieDb(), ['github.com'])).toContain('github.com')
    expect(survivors(makeCookieDb(), ['github.com'])).toContain('.github.com')
  })

  it('keeps subdomains of a kept domain', () => {
    expect(survivors(makeCookieDb(), ['github.com'])).toContain('.gist.github.com')
  })

  // The failure a naive `LIKE '%github.com'` would produce: `evilgithub.com`
  // ends with the kept string but is a different site.
  it('does not keep a domain that merely ends with the same characters', () => {
    const kept = survivors(makeCookieDb(), ['github.com'])
    expect(kept).not.toContain('notgithub.com')
    expect(kept).not.toContain('.evilgithub.com')
  })

  it('removes everything unrelated', () => {
    const kept = survivors(makeCookieDb(), ['github.com'])
    expect(kept).not.toContain('example.com')
    expect(kept).not.toContain('.ads.tracker.net')
    expect(kept).not.toContain('mail.google.com')
  })

  it('keeps every listed domain when several are given', () => {
    const kept = survivors(makeCookieDb(), ['github.com', 'google.com'])
    expect(kept).toContain('github.com')
    expect(kept).toContain('mail.google.com')
    expect(kept).not.toContain('example.com')
  })

  it('keeps only the exact site when a subdomain is listed', () => {
    const kept = survivors(makeCookieDb(), ['gist.github.com'])
    expect(kept).toEqual(['.gist.github.com'])
  })
})
