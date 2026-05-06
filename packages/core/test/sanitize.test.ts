import { describe, expect, it } from 'bun:test'
import { appleScriptEscape, sanitizePackageName, sanitizePid, sanitizeStringArray } from '../src/sanitize'

describe('sanitizePackageName', () => {
  it('accepts standard formula and cask tokens', () => {
    expect(sanitizePackageName('node')).toBe('node')
    expect(sanitizePackageName('node@20')).toBe('node@20')
    expect(sanitizePackageName('visual-studio-code')).toBe('visual-studio-code')
    expect(sanitizePackageName('lib_ssl')).toBe('lib_ssl')
    expect(sanitizePackageName('pkg.123')).toBe('pkg.123')
    expect(sanitizePackageName('a+')).toBe('a+')
  })

  it('rejects shell-meta and quoting characters', () => {
    expect(sanitizePackageName('foo; rm -rf ~')).toBeNull()
    expect(sanitizePackageName('foo$(whoami)')).toBeNull()
    expect(sanitizePackageName('foo`whoami`')).toBeNull()
    expect(sanitizePackageName('foo|bar')).toBeNull()
    expect(sanitizePackageName('foo&bar')).toBeNull()
    expect(sanitizePackageName('foo bar')).toBeNull()
    expect(sanitizePackageName('foo>out')).toBeNull()
    expect(sanitizePackageName("foo'evil'")).toBeNull()
    expect(sanitizePackageName('foo"evil"')).toBeNull()
    expect(sanitizePackageName('foo\nbar')).toBeNull()
  })

  it('rejects path traversal-flavoured tokens', () => {
    expect(sanitizePackageName('../etc/passwd')).toBeNull()
    expect(sanitizePackageName('foo/bar')).toBeNull()
    expect(sanitizePackageName('foo\\bar')).toBeNull()
  })

  it('rejects empty / over-long / non-string', () => {
    expect(sanitizePackageName('')).toBeNull()
    expect(sanitizePackageName('a'.repeat(129))).toBeNull()
    expect(sanitizePackageName(null)).toBeNull()
    expect(sanitizePackageName(undefined)).toBeNull()
    expect(sanitizePackageName(42)).toBeNull()
    expect(sanitizePackageName({})).toBeNull()
  })
})

describe('sanitizePid', () => {
  it('accepts positive integers', () => {
    expect(sanitizePid(1)).toBe(1)
    expect(sanitizePid(12345)).toBe(12345)
    expect(sanitizePid(0x7FFF_FFFE)).toBe(0x7FFF_FFFE)
  })

  it('rejects 0, negatives, floats, NaN, Infinity', () => {
    expect(sanitizePid(0)).toBeNull()
    expect(sanitizePid(-1)).toBeNull()
    expect(sanitizePid(1.5)).toBeNull()
    expect(sanitizePid(Number.NaN)).toBeNull()
    expect(sanitizePid(Number.POSITIVE_INFINITY)).toBeNull()
    expect(sanitizePid(0x8000_0000)).toBeNull()
  })

  it('rejects non-numbers', () => {
    expect(sanitizePid('123')).toBeNull()
    expect(sanitizePid(null)).toBeNull()
    expect(sanitizePid(undefined)).toBeNull()
    expect(sanitizePid({})).toBeNull()
  })
})

describe('sanitizeStringArray', () => {
  it('accepts arrays of non-empty strings', () => {
    expect(sanitizeStringArray(['a', 'b'])).toEqual(['a', 'b'])
  })

  it('rejects empty arrays', () => {
    expect(sanitizeStringArray([])).toBeNull()
  })

  it('respects the length cap', () => {
    const big = Array.from({ length: 2000 }, (_, i) => String(i))
    expect(sanitizeStringArray(big, 1024)).toBeNull()
    expect(sanitizeStringArray(big.slice(0, 100), 1024)).not.toBeNull()
  })

  it('rejects non-string entries', () => {
    expect(sanitizeStringArray(['a', 1])).toBeNull()
    expect(sanitizeStringArray(['a', null])).toBeNull()
  })

  it('rejects per-string overlength entries', () => {
    expect(sanitizeStringArray(['x'.repeat(5000)])).toBeNull()
  })

  it('rejects empty strings inside the array', () => {
    expect(sanitizeStringArray(['a', ''])).toBeNull()
  })

  it('rejects non-arrays', () => {
    expect(sanitizeStringArray('a,b')).toBeNull()
    expect(sanitizeStringArray(null)).toBeNull()
  })
})

describe('appleScriptEscape', () => {
  it('escapes double quotes', () => {
    expect(appleScriptEscape('foo"bar')).toBe('foo\\"bar')
  })

  it('escapes backslashes BEFORE double quotes (so a backslash-injection cannot smuggle a quote)', () => {
    expect(appleScriptEscape('foo\\bar')).toBe('foo\\\\bar')
    expect(appleScriptEscape('foo\\"bar')).toBe('foo\\\\\\"bar')
  })

  it('passes safe strings unchanged', () => {
    expect(appleScriptEscape('hello world')).toBe('hello world')
    expect(appleScriptEscape('/Library/LaunchAgents/com.foo.plist')).toBe('/Library/LaunchAgents/com.foo.plist')
  })
})
