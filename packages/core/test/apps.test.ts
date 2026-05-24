import { describe, expect, it } from 'bun:test'
import { readAppVersion } from '../src/apps'

describe('readAppVersion', () => {
  it('returns ? for missing plist', () => {
    expect(readAppVersion('/nonexistent/Info.plist')).toBe('?')
  })
})
