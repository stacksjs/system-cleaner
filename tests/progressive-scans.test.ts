import { afterEach, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { scanDirectory, scanLargeFiles, findDuplicates } from '@system-cleaner/disk'
import { measurementStream } from '../app/Support/measurement-stream'

const roots: string[] = []
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cleaner-progress-'))
  roots.push(root)
  return root
}
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

it('publishes useful large files before finishing without corrupting the top-N heap', () => {
  const root = fixture()
  for (let i = 1; i <= 30; i++) fs.writeFileSync(path.join(root, `${String(i).padStart(2, '0')}.bin`), Buffer.alloc(i * 1024))
  const snapshots: ReturnType<typeof scanLargeFiles>[] = []
  const result = scanLargeFiles({ roots: [root], minSizeBytes: 1, limit: 5, onSnapshot: snapshot => snapshots.push(snapshot) })
  expect(snapshots[0].scanned).toBeLessThan(result.scanned)
  expect(snapshots[0].files).toHaveLength(1)
  expect(result.files.map(file => file.sizeBytes)).toEqual([30, 29, 28, 27, 26].map(n => n * 1024))
  expect(snapshots[0].files).toHaveLength(1)
})

it('publishes immutable disk trees with correct totals across repeated du chunks', async () => {
  const root = fixture()
  for (let i = 0; i < 20; i++) {
    const child = path.join(root, `folder-${i}`, 'nested')
    fs.mkdirSync(child, { recursive: true })
    fs.writeFileSync(path.join(child, 'data'), Buffer.alloc(8192, i))
  }
  const snapshots: { tree: unknown, json: string }[] = []
  const result = await scanDirectory(root, { structureDepth: 1, concurrency: 2, onSnapshot: tree => snapshots.push({ tree, json: JSON.stringify(tree) }) })
  expect(snapshots.length).toBeGreaterThan(1)
  for (const snapshot of snapshots) expect(JSON.stringify(snapshot.tree)).toBe(snapshot.json)
  function check(node: typeof result.tree) {
    const children = node.children ?? []
    expect(new Set(children.map(child => child.aggregate ? `aggregate:${child.path}` : child.path)).size).toBe(children.length)
    expect(children.reduce((sum, child) => sum + child.sizeBytes, 0)).toBeLessThanOrEqual(node.sizeBytes)
    for (const child of children) check(child)
  }
  for (const snapshot of snapshots) {
    const tree = snapshot.tree as typeof result.tree
    check(tree)
    expect(tree.sizeBytes).toBeLessThanOrEqual(result.tree.sizeBytes)
  }
  check(result.tree)
  expect(result.tree.sizeBytes).toBeGreaterThanOrEqual(20 * 8192)
})

it('only publishes duplicate groups after the full contents match', () => {
  const root = fixture()
  const data = Buffer.alloc(256 * 1024, 1)
  fs.writeFileSync(path.join(root, 'a'), data)
  fs.writeFileSync(path.join(root, 'b'), data)
  const different = Buffer.from(data)
  different[128 * 1024] = 2
  fs.writeFileSync(path.join(root, 'c'), different)
  let groups: string[][] = []
  findDuplicates({ roots: [root], minSizeBytes: 1, onSnapshot: result => { groups = result.groups.map(group => group.files.map(file => path.basename(file.path)).sort()) } })
  expect(groups).toEqual([['a', 'b']])
})

it('delivers measurements before the final stream record and reports failures', async () => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const response = measurementStream(async publish => {
    publish({ '/first': 42 })
    await gate
    return { success: true, sizes: { '/first': 42, '/last': 99 } }
  })
  expect(response.headers.get('Cache-Control')).toContain('no-store')
  const reader = response.body!.getReader()
  const first = await reader.read()
  expect(JSON.parse(new TextDecoder().decode(first.value))).toEqual({ sizes: { '/first': 42 } })
  release()
  const last = await reader.read()
  expect(JSON.parse(new TextDecoder().decode(last.value)).complete).toBe(true)
  expect((await reader.read()).done).toBe(true)
  const failed = measurementStream(async () => { throw new Error('disk failed') })
  expect(JSON.parse(await failed.text())).toEqual({ success: false, complete: true, error: 'disk failed' })
})
