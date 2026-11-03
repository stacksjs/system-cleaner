import { describe, expect, it } from 'bun:test'
import process from 'node:process'
import {
  classifySnapshot,
  deleteLocalSnapshots,
  listLocalSnapshots,
  SNAPSHOT_VOLUMES,
  snapshotDateToDate,
} from '@system-cleaner/clean'

/**
 * Local APFS snapshots — stacksjs/system-cleaner#33.
 *
 * The risk this feature carries is not missing a snapshot. It is offering to
 * delete one that is not Time Machine's: an OS update snapshot is what lets
 * someone roll back a bad macOS release, and the sealed system snapshot is
 * what the Mac boots from. `tmutil deletelocalsnapshots` refuses both, which
 * is why it is the only tool `deleteLocalSnapshots` calls — so the tests that
 * matter most here are the ones that pin the classifier and the filter.
 */

describe('classifySnapshot', () => {
  it('recognises a Time Machine snapshot and pulls its date out', () => {
    // The date is the whole argument `tmutil deletelocalsnapshots` takes, so
    // a classifier that returned the name instead would fail at the shell.
    expect(classifySnapshot('com.apple.TimeMachine.2026-11-03-091500.local'))
      .toEqual({ kind: 'time-machine', date: '2026-11-03-091500' })
  })

  it('recognises one without the .local suffix', () => {
    // Older macOS wrote them this way, and a Mac upgraded across that change
    // can hold both spellings at once.
    expect(classifySnapshot('com.apple.TimeMachine.2026-11-03-091500'))
      .toEqual({ kind: 'time-machine', date: '2026-11-03-091500' })
  })

  it('recognises an OS update snapshot, which carries no date', () => {
    const name = 'com.apple.os.update-5514FF97DEE9C60C7FBF462B06A418D5FC4A882D5AF41D2BAF0A1419FB9B9F86'
    expect(classifySnapshot(name)).toEqual({ kind: 'os-update', date: '' })
  })

  it('does not mistake a near-miss for a Time Machine snapshot', () => {
    // Each of these would hand a malformed date to `tmutil` if the pattern
    // were loose, and the one named like a backup is the dangerous case: it
    // would be offered for deletion and then fail.
    for (const name of [
      'com.apple.TimeMachine.2026-11-03.local',
      'com.apple.TimeMachine.local',
      'com.apple.TimeMachine.2026-11-03-0915.local',
      'com.apple.TimeMachineExtra.2026-11-03-091500.local',
      'TimeMachine.2026-11-03-091500',
      'my-own-snapshot',
      '',
    ])
      expect(classifySnapshot(name).kind, name).not.toBe('time-machine')
  })

  it('leaves the date empty for anything it does not date', () => {
    for (const name of ['my-own-snapshot', 'com.apple.os.update-abc', ''])
      expect(classifySnapshot(name).date, name).toBe('')
  })
})

describe('snapshotDateToDate', () => {
  /**
   * Local time, not UTC. `new Date('2026-11-03')` is UTC midnight, which on a
   * machine west of Greenwich lands on the 2nd — enough to file an hourly
   * snapshot under the wrong day in the list.
   */
  it('reads the stamp as local time', () => {
    const d = snapshotDateToDate('2026-11-03-091500')
    expect(d).not.toBeNull()
    expect(d!.getFullYear()).toBe(2026)
    expect(d!.getMonth()).toBe(10)
    expect(d!.getDate()).toBe(3)
    expect(d!.getHours()).toBe(9)
    expect(d!.getMinutes()).toBe(15)
    expect(d!.getSeconds()).toBe(0)
  })

  it('refuses a date that does not exist rather than rolling it over', () => {
    // `new Date(2026, 1, 30)` is silently the 2nd of March. A snapshot list
    // showing a date the snapshot was not taken on is worse than one row
    // reading "no date".
    expect(snapshotDateToDate('2026-02-30-091500')).toBeNull()
    expect(snapshotDateToDate('2026-13-01-091500')).toBeNull()
  })

  it('refuses anything that is not the exact shape', () => {
    for (const bad of ['2026-11-03', '2026-11-03-0915', '2026/11/03-091500', 'x', ''])
      expect(snapshotDateToDate(bad), bad).toBeNull()
  })
})

describe('deleteLocalSnapshots', () => {
  /**
   * The validation happens before anything is spawned, so this runs on every
   * platform and does not touch the machine: a malformed date is rejected by
   * the regex, never escaped into a shell and hoped about.
   */
  it('rejects a date that is not a snapshot date, without running anything', async () => {
    const result = await deleteLocalSnapshots([
      '; rm -rf /',
      '2026-11-03',
      '$(whoami)',
      '2026-11-03-091500 && echo pwned',
    ])

    expect(result.succeeded).toEqual([])
    expect(result.failed.length).toBe(4)
    expect(result.elevated).toBe(false)
  })

  it('reports an empty request as nothing to do', async () => {
    const result = await deleteLocalSnapshots([])
    expect(result.succeeded).toEqual([])
    expect(result.failed).toEqual([])
  })
})

describe('listLocalSnapshots', () => {
  it('asks both halves of the boot volume group', () => {
    // Time Machine's hourly snapshots land on the data volume while the OS
    // update snapshots sit on the system volume, so asking only one of the
    // two reports half the truth. Checked on the machine this was written on:
    // `tmutil listlocalsnapshots /` was empty while `diskutil` found an
    // update snapshot on `/`.
    expect(SNAPSHOT_VOLUMES).toContain('/')
    expect(SNAPSHOT_VOLUMES).toContain('/System/Volumes/Data')
  })

  it.skipIf(process.platform === 'darwin')('says so rather than reporting a clean Mac off macOS', async () => {
    // The capability-map lesson from #23: an empty result from a platform
    // with no implementation reads as good news.
    const scan = await listLocalSnapshots()
    expect(scan.unavailable).toBe(true)
    expect(scan.reason).toBeTruthy()
    expect(scan.snapshots).toEqual([])
  })

  it.skipIf(process.platform !== 'darwin')('returns a usable, self-consistent list on macOS', async () => {
    const scan = await listLocalSnapshots()

    expect(scan.unavailable).toBe(false)
    expect(scan.volumes).toEqual([...SNAPSHOT_VOLUMES])

    for (const snapshot of scan.snapshots) {
      expect(snapshot.name, 'every snapshot has a name').toBeTruthy()
      expect(SNAPSHOT_VOLUMES).toContain(snapshot.volume)

      // The classifier and the stored kind cannot disagree, or a Time Machine
      // snapshot could be listed as undeletable and vice versa.
      expect(classifySnapshot(snapshot.name).kind).toBe(snapshot.kind)

      // This is the invariant that keeps the delete path safe: nothing but a
      // dated Time Machine snapshot may ever be marked deletable.
      if (snapshot.timeMachineManaged) {
        expect(snapshot.kind).toBe('time-machine')
        expect(snapshot.date).toMatch(/^\d{4}-\d{2}-\d{2}-\d{6}$/)
        expect(snapshot.createdAt).not.toBeNull()
      }

      // A snapshot the Mac boots from or reverts to is never ours to remove.
      if (snapshot.rootTo || snapshot.revertTo)
        expect(snapshot.timeMachineManaged).toBe(false)
    }

    // One UUID, one row. The same snapshot is visible from both mount points
    // of a volume group, and listing it twice would offer it for deletion
    // twice.
    const uuids = scan.snapshots.map(s => s.uuid).filter(Boolean)
    expect(new Set(uuids).size).toBe(uuids.length)
  }, 60_000)
})
