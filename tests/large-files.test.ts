import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { categoryPresentation, scanLargeFiles } from '@system-cleaner/disk'

const MB = 1024 * 1024

let root: string

function write(relative: string, megabytes: number): string {
  const full = path.join(root, relative)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, Buffer.alloc(Math.round(megabytes * MB)))
  return full
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'system-cleaner-large-'))

  write('Movies/holiday.mov', 12)
  write('Movies/short.mov', 1)
  write('Downloads/installer.dmg', 8)
  write('Downloads/notes.txt', 0.1)
  write('.hidden/cache.bin', 6)
  write('deep/a/b/c/d/e/f/buried.zip', 7)

  // A bundle: reported as one entry summing its contents, never as three.
  write('Apps/Demo.app/Contents/MacOS/binary', 3)
  write('Apps/Demo.app/Contents/Resources/assets.bin', 4)

  // Directories the scanner refuses to walk at all.
  write('.Trash/discarded.mov', 20)

  const link = path.join(root, 'Movies/link.mov')
  fs.symlinkSync(path.join(root, 'Movies/holiday.mov'), link)
})

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('scanLargeFiles', () => {
  it('returns items over the floor, largest first', () => {
    const result = scanLargeFiles({ roots: [root], minSizeBytes: 5 * MB })
    const names = result.files.map(f => f.name)

    expect(names[0]).toBe('holiday.mov')
    expect(names).toContain('installer.dmg')
    expect(names).toContain('buried.zip')

    const sizes = result.files.map(f => f.sizeBytes)
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a))
  })

  it('excludes anything under the floor', () => {
    const result = scanLargeFiles({ roots: [root], minSizeBytes: 5 * MB })
    const names = result.files.map(f => f.name)

    expect(names).not.toContain('short.mov')
    expect(names).not.toContain('notes.txt')
  })

  it('walks hidden directories, because large files hide in ~/Library', () => {
    const result = scanLargeFiles({ roots: [root], minSizeBytes: 5 * MB })
    expect(result.files.map(f => f.name)).toContain('cache.bin')
  })

  it('reports a bundle as one entry sized from its contents', () => {
    const result = scanLargeFiles({ roots: [root], minSizeBytes: 5 * MB })
    const bundle = result.files.find(f => f.name === 'Demo.app')

    expect(bundle).toBeDefined()
    expect(bundle!.isBundle).toBe(true)
    expect(bundle!.sizeBytes).toBe(7 * MB)
    // Its contents must not surface as separate rows.
    expect(result.files.map(f => f.name)).not.toContain('assets.bin')
  })

  it('never descends into the Trash or follows symlinks', () => {
    const result = scanLargeFiles({ roots: [root], minSizeBytes: 1 * MB })
    const names = result.files.map(f => f.name)

    expect(names).not.toContain('discarded.mov')
    expect(names).not.toContain('link.mov')
  })

  it('filters by category', () => {
    const result = scanLargeFiles({ roots: [root], minSizeBytes: 1 * MB, categories: ['video'] })

    expect(result.files.length).toBeGreaterThan(0)
    expect(result.files.every(f => f.category === 'video')).toBe(true)
  })

  it('caps the returned page but still totals every match', () => {
    const all = scanLargeFiles({ roots: [root], minSizeBytes: 5 * MB })
    const paged = scanLargeFiles({ roots: [root], minSizeBytes: 5 * MB, limit: 2 })

    expect(paged.files).toHaveLength(2)
    expect(paged.matched).toBe(all.matched)
    expect(paged.totalBytes).toBe(all.totalBytes)
    // The page is the two largest, not the first two encountered.
    expect(paged.files[0].sizeBytes).toBe(all.files[0].sizeBytes)
  })

  it('counts nested roots once rather than twice', () => {
    const single = scanLargeFiles({ roots: [root], minSizeBytes: 5 * MB })
    const overlapping = scanLargeFiles({
      roots: [root, path.join(root, 'Movies')],
      minSizeBytes: 5 * MB,
    })

    expect(overlapping.totalBytes).toBe(single.totalBytes)
    expect(overlapping.matched).toBe(single.matched)
  })

  it('reports a truncated walk instead of pretending it finished', () => {
    const result = scanLargeFiles({ roots: [root], minSizeBytes: 1, maxEntries: 2 })
    expect(result.truncated).toBe(true)
  })

  it('skips roots that do not exist', () => {
    const result = scanLargeFiles({ roots: [path.join(root, 'nope')], minSizeBytes: 1 })
    expect(result.files).toEqual([])
    expect(result.matched).toBe(0)
  })
})

describe('categoryPresentation', () => {
  it('resolves a known category', () => {
    expect(categoryPresentation('video').icon).toBe('i-f7-film-fill')
  })

  it('falls back for the uncategorised bucket', () => {
    const other = categoryPresentation('other')
    expect(other.label).toBe('Other Files')
    expect(other.icon).toBe('i-f7-folder-fill')
  })
})
