import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { HOME } from '@system-cleaner/core'
import { CLEAN_TARGETS } from '../src/categories'
import { cleanAll, cleanDirectory } from '../src/cleaner'
import type { PreserveRule } from '../src/preserve'
import { PRESERVE_RULES, preservedFor, removeContents } from '../src/preserve'

// A Quick Clean of "Claude Code Session History" on 2026-11-23 removed every
// project's memory/ folder along with the transcripts. These tests rebuild that
// layout in a scratch folder - never the real ~/.claude - and clean it through
// the same entry points the app and the CLI use.
//
// The scratch folder sits under the home directory, as in
// tests/held-open-accounting.test.ts, because that is the one place isCleanable
// allows on every CI runner: os.tmpdir() is /private/var/folders on macOS and
// /tmp on Linux, both refused, so every clean there would be a no-op and every
// assertion that something survived would pass vacuously. The third test below
// is the control that proves cleans really delete here.

const SCRATCH_PREFIX = '.sc-preserve-test-'
let ROOT: string
let PROJECTS: string
let RULES: PreserveRule[]

function write(rel: string, body = 'x'): void {
  const p = path.join(PROJECTS, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, body)
}

const exists = (rel: string) => fs.existsSync(path.join(PROJECTS, rel))

beforeEach(() => {
  ROOT = fs.mkdtempSync(path.join(os.homedir(), SCRATCH_PREFIX))
  PROJECTS = path.join(ROOT, '.claude', 'projects')
  RULES = [{ root: PROJECTS, pattern: ['*', 'memory'], why: 'test' }]
  write('-Users-a-app/1111.jsonl')
  write('-Users-a-app/1111/subagents/agent.jsonl')
  write('-Users-a-app/memory/MEMORY.md', '- [note](note.md)')
  write('-Users-a-app/memory/note.md', 'kept')
  write('-Users-b-lib/2222.jsonl')
  write('-Users-c-empty/memory/MEMORY.md')
})

afterEach(() => {
  const resolved = fs.realpathSync(ROOT)
  if (path.dirname(resolved) !== fs.realpathSync(os.homedir()) || !path.basename(resolved).startsWith(SCRATCH_PREFIX))
    throw new Error(`refusing to rm anything but this test's scratch folder: ${resolved}`)
  fs.rmSync(resolved, { recursive: true, force: true })
})

describe('the rule list', () => {
  it('covers Claude Code memory under the session-history target, on every platform table', () => {
    const target = CLEAN_TARGETS.find(t => t.id === 'claude-code-projects')
    expect(target).toBeDefined()
    const rule = PRESERVE_RULES.find(r => r.root === target!.path)
    expect(rule?.pattern).toEqual(['*', 'memory'])
    expect(rule?.root).toBe(path.join(HOME, '.claude', 'projects'))
  })

  it('says on the row that memory is kept', () => {
    const target = CLEAN_TARGETS.find(t => t.id === 'claude-code-projects')!
    expect(target.description).toContain('memory folder is kept')
  })
})

describe('cleaning the session history folder', () => {
  it('removes transcripts and keeps every memory folder', async () => {
    const r = await cleanDirectory(PROJECTS, RULES)
    expect(r.errors).toEqual([])
    expect(exists('-Users-a-app/1111.jsonl')).toBe(false)
    expect(exists('-Users-a-app/1111')).toBe(false)
    expect(exists('-Users-b-lib')).toBe(false)
    expect(fs.readFileSync(path.join(PROJECTS, '-Users-a-app/memory/note.md'), 'utf8')).toBe('kept')
    expect(exists('-Users-a-app/memory/MEMORY.md')).toBe(true)
    expect(exists('-Users-c-empty/memory/MEMORY.md')).toBe(true)
    expect(r.kept.length).toBe(2)
  })

  it('holds when the clean starts above the target, at ~/.claude', async () => {
    await cleanDirectory(path.join(ROOT, '.claude'), RULES)
    expect(exists('-Users-a-app/1111.jsonl')).toBe(false)
    expect(exists('-Users-a-app/memory/note.md')).toBe(true)
  })

  it('holds when the clean starts inside, at one project or its memory folder', async () => {
    await cleanDirectory(path.join(PROJECTS, '-Users-a-app'), RULES)
    expect(exists('-Users-a-app/1111.jsonl')).toBe(false)
    expect(exists('-Users-a-app/memory/note.md')).toBe(true)

    await cleanDirectory(path.join(PROJECTS, '-Users-a-app', 'memory'), RULES)
    expect(exists('-Users-a-app/memory/note.md')).toBe(true)
  })

  it('without a rule, the same clean removes everything (the old behaviour)', async () => {
    await cleanDirectory(PROJECTS, [])
    expect(fs.readdirSync(PROJECTS)).toEqual([])
  })
})

describe('preservedFor', () => {
  it('names only folders that exist and that the clean could reach', () => {
    const kept = preservedFor(PROJECTS, RULES).map(p => path.relative(fs.realpathSync(PROJECTS), p)).sort()
    expect(kept).toEqual([path.join('-Users-a-app', 'memory'), path.join('-Users-c-empty', 'memory')])
    expect(preservedFor(path.join(ROOT, 'elsewhere'), RULES)).toEqual([])
  })

  it('still applies top-level skip patterns', () => {
    const out = { errors: [] as string[], kept: [] as string[] }
    removeContents(PROJECTS, preservedFor(PROJECTS, RULES), out, [/^-Users-b-/])
    expect(exists('-Users-b-lib/2222.jsonl')).toBe(true)
    expect(exists('-Users-a-app/1111.jsonl')).toBe(false)
  })
})

describe('cleanAll', () => {
  it('leaves caution targets out unless asked', async () => {
    const caution = CLEAN_TARGETS.filter(t => t.risk === 'caution').map(t => t.id)
    expect(caution).toContain('claude-code-projects')
    // A dry run reports what it would clean without touching anything.
    const { results } = await cleanAll({ dryRun: true, categories: ['developer'] })
    for (const id of caution)
      expect(results.some(r => r.targetId === id)).toBe(false)
  }, 120_000)
})
