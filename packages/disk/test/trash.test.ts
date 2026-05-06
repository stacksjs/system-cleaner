import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { moveToTrash } from '../src/trash'

const TMP_ROOT = fs.realpathSync(os.tmpdir())
let ROOT: string

function safeCleanup(p: string): void {
  const resolved = fs.realpathSync(p)
  if (!resolved.startsWith(`${TMP_ROOT}${path.sep}`))
    throw new Error(`refusing to rm outside tmpdir: ${resolved}`)
  fs.rmSync(resolved, { recursive: true, force: true })
}

beforeAll(() => {
  ROOT = fs.mkdtempSync(path.join(TMP_ROOT, 'system-cleaner-trash-'))
})

afterAll(() => {
  safeCleanup(ROOT)
})

describe('moveToTrash', () => {
  it('rejects empty input', async () => {
    const r = await moveToTrash('')
    expect(r.success).toBe(false)
  })

  it('rejects null-byte injected paths', async () => {
    const r = await moveToTrash('foo\0bar')
    expect(r.success).toBe(false)
  })

  it('rejects path traversal sequences', async () => {
    const r = await moveToTrash('../etc/passwd')
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/traversal/i)
  })

  it('does NOT silently fall back to permanent rm when osascript fails', async () => {
    // Regression for audit C4: previously, when AppleScript failed for any
    // reason (file missing, headless session, etc.), the function ran
    // `fs.rmSync` and reported success. That violated the "recoverable"
    // contract. With the fix, missing-file → success: false, no rm.
    const r = await moveToTrash(path.join(ROOT, 'no-such-file'))
    expect(r.success).toBe(false)
    expect(r.permanentlyDeleted).toBeUndefined()
  })

  it('opt-in permanent flag deletes the file when osascript fails', async () => {
    const file = path.join(ROOT, 'goner.txt')
    fs.writeFileSync(file, 'bye')
    const r = await moveToTrash(file, { permanent: true })
    expect(r.success).toBe(true)
    expect(fs.existsSync(file)).toBe(false)
  })
})
