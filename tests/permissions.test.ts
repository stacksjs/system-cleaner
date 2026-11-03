import { Database } from 'bun:sqlite'
import { afterAll, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import process from 'node:process'
import {
  humanizeService,
  listAppPermissions,
  resetPermission,
  settingsAnchorFor,
} from '@system-cleaner/clean'

/**
 * App permissions — stacksjs/system-cleaner#35.
 *
 * The risk here is not missing a grant. It is calling one stale when it is
 * not: the screen's headline finding is "this app is gone and still holds
 * Full Disk Access", and a false positive gets someone to reset a permission
 * a running system component depends on. So most of what is pinned below is
 * the conservatism — Apple clients are never reported missing, a thin app
 * index concludes nothing, and no reset is offered where `tccutil` would
 * refuse it.
 */

describe('humanizeService', () => {
  it('names the services System Settings names', () => {
    expect(humanizeService('kTCCServiceSystemPolicyAllFiles')).toBe('Full Disk Access')
    expect(humanizeService('kTCCServiceScreenCapture')).toBe('Screen Recording')
    expect(humanizeService('kTCCServiceAppleEvents')).toBe('Automation')
    expect(humanizeService('kTCCServiceListenEvent')).toBe('Input Monitoring')
  })

  /**
   * The one the uninstaller got wrong. Deleting another app's bundle has
   * needed App Management since macOS 13, and the failure told the user to
   * grant Full Disk Access — which they did, and the delete still failed.
   */
  it('calls kTCCServiceSystemPolicyAppBundles App Management', () => {
    expect(humanizeService('kTCCServiceSystemPolicyAppBundles')).toBe('App Management')
  })

  it('derives a readable name for the services with no label', () => {
    // `tccd` ships 106 of these and most are internal. An unlabelled one
    // still has to render a name, because hiding the row would hide a grant.
    expect(humanizeService('kTCCServiceSensorKitAmbientLightSensor'))
      .toBe('Sensor Kit Ambient Light Sensor')
    expect(humanizeService('kTCCServiceWillow')).toBe('Willow')
  })

  it('never returns an empty name', () => {
    for (const service of ['kTCCService', '', 'nonsense'])
      expect(humanizeService(service), service).toBeTruthy()
  })
})

describe('settingsAnchorFor', () => {
  it('knows the panes it was given evidence for', () => {
    expect(settingsAnchorFor('kTCCServiceSystemPolicyAllFiles')).toBe('Privacy_AllFiles')
    expect(settingsAnchorFor('kTCCServiceCamera')).toBe('Privacy_Camera')
    expect(settingsAnchorFor('kTCCServiceAppleEvents')).toBe('Privacy_Automation')
  })

  it('answers empty rather than guessing', () => {
    // An invented anchor does not fail loudly — System Settings opens
    // somewhere else and the user is left looking at the wrong list. Empty
    // means "open Privacy & Security plainly", which is the right window.
    expect(settingsAnchorFor('kTCCServiceWillow')).toBe('')
    expect(settingsAnchorFor('')).toBe('')
  })
})

describe('resetPermission', () => {
  /**
   * Validation happens before anything is spawned, so these run on every
   * platform and touch nothing.
   */
  it('refuses anything that is not a TCC service name', async () => {
    for (const service of ['Camera', '; rm -rf /', 'kTCCService Camera', '']) {
      const result = await resetPermission(service, 'com.example.app')
      expect(result.success, service).toBe(false)
    }
  })

  it('refuses a client that could not be an app identifier', async () => {
    for (const client of ['$(whoami)', 'a;b', '../../etc', '']) {
      const result = await resetPermission('kTCCServiceCamera', client)
      expect(result.success, client).toBe(false)
    }
  })
})

describe('listAppPermissions', () => {
  it.skipIf(process.platform === 'darwin')('says so rather than reporting an empty Mac', async () => {
    const scan = await listAppPermissions()
    expect(scan.unavailable).toBe(true)
    expect(scan.reason).toBeTruthy()
    expect(scan.apps).toEqual([])
  })

  /**
   * Runs whether or not this machine has granted Full Disk Access: an
   * unreadable store is a legitimate outcome with its own assertions, and a
   * test that only passes on a configured Mac would be skipped in CI and
   * never run anywhere else either.
   */
  it.skipIf(process.platform !== 'darwin')('is self-consistent, readable or not', async () => {
    const scan = await listAppPermissions()

    if (scan.unavailable) {
      expect(scan.reason).toBeTruthy()
      expect(scan.apps).toEqual([])
      return
    }

    for (const app of scan.apps) {
      expect(app.client, 'every client has an identifier').toBeTruthy()
      expect(app.name).toBeTruthy()
      expect(app.grants.length).toBeGreaterThan(0)

      // Apple's clients are mostly XPC services and daemons with no
      // discoverable `.app`, so an index miss says nothing about whether
      // they are present. Reporting one as gone is the false positive that
      // matters most here.
      if (app.apple)
        expect(app.installed, app.client).not.toBe('no')

      // Never offer a reset `tccutil` would refuse: it resolves the bundle
      // identifier first and exits 64 for anything it cannot find, and a
      // path client is not an identifier at all.
      if (app.installed === 'no' || app.clientType === 'path')
        expect(app.resettable, app.client).toBe(false)

      for (const grant of app.grants) {
        expect(grant.label, grant.service).toBeTruthy()
        // "Not yet asked" is a row TCC keeps, not a permission anyone holds.
        expect(grant.decision, grant.service).not.toBe('unknown')
        expect(['user', 'system']).toContain(grant.scope)
      }
    }

    // One row per client. The same app appears in both stores, and listing
    // it twice would double every count on the screen.
    const clients = scan.apps.map(app => app.client)
    expect(new Set(clients).size).toBe(clients.length)

    // Gone-but-granted leads, because it is the finding System Settings
    // cannot show and the reason to open the screen.
    const firstInstalled = scan.apps.findIndex(app => app.installed !== 'no')
    const lastMissing = scan.apps.map(app => app.installed).lastIndexOf('no')
    if (firstInstalled !== -1 && lastMissing !== -1)
      expect(lastMissing).toBeLessThan(firstInstalled)
  }, 60_000)
})

/**
 * The parsing, against stores built here.
 *
 * Reading the real TCC databases needs Full Disk Access, which a test run
 * does not have and CI never will — so the branch that does the actual work
 * would otherwise never execute anywhere. These build the schema macOS
 * writes and assert on what comes back out, which is where the mistakes
 * live: a decision column that changed meaning in Big Sur, a client that is
 * a path rather than an identifier, and the call on whether an app is gone.
 */
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-tcc-'))

afterAll(() => {
  fs.rmSync(scratch, { recursive: true, force: true })
})

interface Row {
  service: string
  client: string
  clientType?: number
  authValue?: number
  lastModified?: number
}

/** A store with the post-Big-Sur schema: `auth_value`, 0..3. */
function modernStore(name: string, rows: Row[]): string {
  const file = path.join(scratch, `${name}.db`)
  const db = new Database(file, { create: true })
  db.run(`CREATE TABLE access (
    service TEXT NOT NULL,
    client TEXT NOT NULL,
    client_type INTEGER NOT NULL,
    auth_value INTEGER NOT NULL,
    auth_reason INTEGER NOT NULL DEFAULT 0,
    csreq BLOB,
    last_modified INTEGER NOT NULL DEFAULT 0
  )`)
  for (const row of rows) {
    db.run(
      'INSERT INTO access (service, client, client_type, auth_value, last_modified) VALUES (?, ?, ?, ?, ?)',
      [row.service, row.client, row.clientType ?? 0, row.authValue ?? 2, row.lastModified ?? 0],
    )
  }
  db.close()
  return file
}

/** The pre-Big-Sur schema: a plain `allowed` boolean and no `last_modified`. */
function legacyStore(name: string, rows: { service: string, client: string, allowed: number }[]): string {
  const file = path.join(scratch, `${name}.db`)
  const db = new Database(file, { create: true })
  db.run('CREATE TABLE access (service TEXT NOT NULL, client TEXT NOT NULL, client_type INTEGER NOT NULL, allowed INTEGER NOT NULL)')
  for (const row of rows)
    db.run('INSERT INTO access VALUES (?, ?, 0, ?)', [row.service, row.client, row.allowed])
  db.close()
  return file
}

describe.skipIf(process.platform !== 'darwin')('listAppPermissions, against a built store', () => {
  it('groups grants under the app that holds them', async () => {
    const file = modernStore('grouped', [
      { service: 'kTCCServiceCamera', client: 'com.example.ghost' },
      { service: 'kTCCServiceMicrophone', client: 'com.example.ghost' },
      { service: 'kTCCServiceSystemPolicyAllFiles', client: 'com.example.other' },
    ])

    const scan = await listAppPermissions({ stores: [{ scope: 'user', path: file }] })

    expect(scan.unavailable).toBe(false)
    expect(scan.apps.length).toBe(2)

    const ghost = scan.apps.find(app => app.client === 'com.example.ghost')!
    expect(ghost.grants.map(g => g.label).sort()).toEqual(['Camera', 'Microphone'])
  })

  it('reports a third-party app that is not installed as gone, and refuses to reset it', async () => {
    // The headline finding, and the one `tccutil` cannot act on: it resolves
    // the bundle identifier first and exits 64 for anything it cannot find.
    const file = modernStore('gone', [
      { service: 'kTCCServiceSystemPolicyAllFiles', client: 'com.example.definitely-not-installed' },
    ])

    const scan = await listAppPermissions({ stores: [{ scope: 'user', path: file }] })
    const app = scan.apps[0]

    expect(app.installed).toBe('no')
    expect(app.resettable).toBe(false)
    expect(scan.apps.filter(a => a.installed === 'no').length).toBe(1)
  })

  it('never calls an Apple client gone, however absent its bundle', async () => {
    // Most of Apple's clients are XPC services and daemons with no
    // discoverable `.app`, so an index miss says nothing — and a row reading
    // "app is gone" beside a running system component is what makes someone
    // reset a permission they need.
    const file = modernStore('apple', [
      { service: 'kTCCServiceSystemPolicyAllFiles', client: 'com.apple.sharingd' },
    ])

    const scan = await listAppPermissions({ stores: [{ scope: 'user', path: file }] })
    expect(scan.apps[0].apple).toBe(true)
    expect(scan.apps[0].installed).toBe('unknown')
  })

  it('judges a path client by whether the path is there', async () => {
    const present = path.join(scratch, 'a-real-binary')
    fs.writeFileSync(present, '#!/bin/sh\n')

    const file = modernStore('paths', [
      { service: 'kTCCServiceAccessibility', client: present, clientType: 1 },
      { service: 'kTCCServiceAccessibility', client: '/no/such/binary', clientType: 1 },
    ])

    const scan = await listAppPermissions({ stores: [{ scope: 'user', path: file }] })
    const byClient = new Map(scan.apps.map(app => [app.client, app]))

    expect(byClient.get(present)!.installed).toBe('yes')
    expect(byClient.get('/no/such/binary')!.installed).toBe('no')
    // A path is not a bundle identifier, so `tccutil` has nothing to resolve
    // either way.
    for (const app of scan.apps)
      expect(app.resettable).toBe(false)
  })

  it('reads every auth_value, and drops the rows that are not grants', async () => {
    const file = modernStore('decisions', [
      { service: 'kTCCServiceCamera', client: 'com.example.app', authValue: 2 },
      { service: 'kTCCServiceMicrophone', client: 'com.example.app', authValue: 0 },
      { service: 'kTCCServicePhotos', client: 'com.example.app', authValue: 3 },
      // 1 is "not yet asked" — a row TCC keeps, not a permission anyone
      // holds. Listing it would pad every app with capabilities it has
      // never been given.
      { service: 'kTCCServiceReminders', client: 'com.example.app', authValue: 1 },
    ])

    const scan = await listAppPermissions({ stores: [{ scope: 'user', path: file }] })
    const byService = new Map(scan.apps[0].grants.map(g => [g.service, g.decision]))

    expect(byService.get('kTCCServiceCamera')).toBe('allowed')
    expect(byService.get('kTCCServiceMicrophone')).toBe('denied')
    expect(byService.get('kTCCServicePhotos')).toBe('limited')
    expect(byService.has('kTCCServiceReminders')).toBe(false)
  })

  it('reads the pre-Big-Sur schema, where the column was a boolean', async () => {
    // `allowed` was 0/1 and `auth_value` is a 0..3 enum. Reading the old
    // column with the new rules would turn every grant into a denial, since
    // the old one never wrote a 2.
    const file = legacyStore('legacy', [
      { service: 'kTCCServiceCamera', client: 'com.example.app', allowed: 1 },
      { service: 'kTCCServiceMicrophone', client: 'com.example.app', allowed: 0 },
    ])

    const scan = await listAppPermissions({ stores: [{ scope: 'user', path: file }] })
    const byService = new Map(scan.apps[0].grants.map(g => [g.service, g.decision]))

    expect(byService.get('kTCCServiceCamera')).toBe('allowed')
    expect(byService.get('kTCCServiceMicrophone')).toBe('denied')
  })

  it('merges the two stores into one row per app, and marks the machine-wide grants', async () => {
    const user = modernStore('merge-user', [
      { service: 'kTCCServiceCamera', client: 'com.example.app' },
    ])
    const system = modernStore('merge-system', [
      { service: 'kTCCServiceAccessibility', client: 'com.example.app' },
    ])

    const scan = await listAppPermissions({
      stores: [{ scope: 'user', path: user }, { scope: 'system', path: system }],
    })

    expect(scan.apps.length).toBe(1)
    expect(scan.apps[0].grants.length).toBe(2)
    expect(scan.apps[0].grants.find(g => g.label === 'Accessibility')!.scope).toBe('system')
    expect(scan.systemStoreUnreadable).toBe(false)
  })

  it('says the machine-wide store was unreadable rather than silently halving the list', async () => {
    const user = modernStore('partial', [{ service: 'kTCCServiceCamera', client: 'com.example.app' }])

    const scan = await listAppPermissions({
      stores: [{ scope: 'user', path: user }, { scope: 'system', path: '/no/such/TCC.db' }],
    })

    expect(scan.unavailable).toBe(false)
    expect(scan.systemStoreUnreadable).toBe(true)
  })

  it('treats no readable store as no answer, not as an empty Mac', async () => {
    const scan = await listAppPermissions({
      stores: [{ scope: 'user', path: '/no/such/TCC.db' }],
    })

    expect(scan.unavailable).toBe(true)
    expect(scan.reason).toContain('Full Disk Access')
    expect(scan.apps).toEqual([])
  })

  it('survives a store with no access table at all', async () => {
    // A future macOS could rename it. The screen must then say it could not
    // read anything, rather than throwing on the way up to the route.
    const file = path.join(scratch, 'no-table.db')
    const db = new Database(file, { create: true })
    db.run('CREATE TABLE something_else (a TEXT)')
    db.close()

    const scan = await listAppPermissions({ stores: [{ scope: 'user', path: file }] })
    expect(scan.unavailable).toBe(true)
  })
})
