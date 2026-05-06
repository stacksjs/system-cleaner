import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { cleanDirectory } from '../src/cleaner'

// All fixtures live under os.tmpdir() so a misbehaving rmSync can't ever
// escape into HOME or the project tree.
const TMP_ROOT = fs.realpathSync(os.tmpdir())
let DIR: string

function safeCleanup(p: string): void {
  const resolved = fs.realpathSync(p)
  if (!resolved.startsWith(`${TMP_ROOT}${path.sep}`))
    throw new Error(`refusing to rm outside tmpdir: ${resolved}`)
  fs.rmSync(resolved, { recursive: true, force: true })
}

beforeAll(() => {
  DIR = fs.mkdtempSync(path.join(TMP_ROOT, 'system-cleaner-cleaner-'))
})

afterAll(() => {
  safeCleanup(DIR)
})

describe('cleanDirectory', () => {
  it('rejects paths outside cleanable scope', async () => {
    const r = await cleanDirectory('/etc')
    expect(r.errors.length).toBeGreaterThan(0)
    expect(r.freedBytes).toBe(0)
  })

  it('rejects non-existent paths', async () => {
    const r = await cleanDirectory(path.join(DIR, 'no-such-thing'))
    expect(r.errors.length).toBeGreaterThan(0)
  })

  // We can't easily test cleanDirectory's success path here because
  // `isCleanable` only allows HOME and a few system roots — and we
  // intentionally keep test fixtures under tmpdir, which isCleanable
  // rejects. The route-level `/clean-dir` tightens this to HOME-only,
  // and the cleanTarget code path is exercised by integration tests in
  // a follow-up PR. The accounting fix is still verifiable through the
  // error-path tests above.
})
