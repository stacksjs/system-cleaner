import { Database } from 'bun:sqlite'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { exec, HOME, isMacOS, readAppInfoPlist, shellEscape } from '@system-cleaner/core'

/**
 * What every app on this Mac has been allowed to reach.
 *
 * macOS splits this by *capability* — System Settings answers "who has the
 * microphone" and never "what has this app been given" — and grants outlive
 * the apps that asked for them, so an app deleted two years ago can still
 * hold a Full Disk Access entry nobody can see.
 *
 * See stacksjs/system-cleaner#35.
 *
 * ## Read-only, with one exception
 *
 * There is no supported way to *grant* a permission: SIP blocks writing to
 * `TCC.db` even as root, and Automation entries cannot be added by hand at
 * all. `tccutil reset` is the only sanctioned mutation and it does not deny
 * anything — it forgets the decision, so the app asks again the next time it
 * needs the capability. `resetPermission` says so in those terms rather than
 * calling itself a revoke, because a button labelled "revoke" that actually
 * means "re-prompt" is a promise this app would be breaking.
 *
 * ## And `tccutil` cannot touch the interesting rows
 *
 * Measured, not assumed. `tccutil reset Camera com.something.gone` exits 64
 * with `No such bundle identifier`: it resolves the identifier before it
 * will reset anything, so a grant whose app has been deleted — the one
 * finding System Settings genuinely cannot show you — is the one thing the
 * command refuses to clear.
 *
 * Resetting the whole service for every app would work and is not on offer;
 * it would revoke Screen Recording from the user's conferencing app to tidy
 * away a dead row. What does work is the "−" button in the relevant Privacy
 * pane, so `settingsAnchorFor` exists to send the user straight there, and
 * the screen offers that instead of a reset it knows would fail.
 *
 * ## Why `installed` is three-valued
 *
 * The valuable finding here is a grant whose app is gone, and the dangerous
 * mistake is calling a grant stale when it is not — someone then resets a
 * permission a running system component depends on. So `installed` is
 * `'yes' | 'no' | 'unknown'` and nothing is reported missing without a
 * positive reason: a client path that does not exist, or a third-party
 * bundle id absent from an index that found plenty of other apps. Anything
 * else stays `'unknown'`, the same way `targetMissing` on `StartupItem`
 * stays false whenever the answer is not knowable.
 */

export type InstalledState = 'yes' | 'no' | 'unknown'

/** 0 denied · 1 not yet asked · 2 allowed · 3 limited (Photos, Contacts). */
export type GrantDecision = 'allowed' | 'denied' | 'limited' | 'unknown'

export interface PermissionGrant {
  /** The raw TCC service, e.g. `kTCCServiceSystemPolicyAllFiles`. */
  service: string
  /** What System Settings calls it, e.g. `Full Disk Access`. */
  label: string
  decision: GrantDecision
  /** `user` is this login's store; `system` is the machine-wide one. */
  scope: 'user' | 'system'
  /** When the decision was last written, when the schema records it. */
  lastModified: Date | null
  /** The Privacy pane anchor, empty when this service has no known one. */
  settingsAnchor: string
}

export interface AppPermissions {
  /** A bundle identifier, or an absolute path for a plain binary. */
  client: string
  clientType: 'bundle-id' | 'path'
  /** The app's name where one could be found, else the client itself. */
  name: string
  installed: InstalledState
  /** Where it was found, when it was. */
  appPath: string | null
  /** True for `com.apple.*`, which is never reported as missing. See below. */
  apple: boolean
  /**
   * Whether `tccutil reset` can act on this client at all.
   *
   * False for a client whose bundle is gone, because `tccutil` resolves the
   * identifier first and exits 64 — see the note at the top. The screen
   * offers the Privacy pane for these instead of a button that cannot work.
   */
  resettable: boolean
  grants: PermissionGrant[]
}

export interface PermissionScan {
  apps: AppPermissions[]
  /**
   * True when neither store could be opened, which is a different fact from
   * finding nothing. An empty list would read as "nothing has been granted
   * anything", which is never true on a Mac in use.
   */
  unavailable: boolean
  reason?: string
  /** True when the machine-wide store could not be read, but the user's could. */
  systemStoreUnreadable: boolean
}

/**
 * The services a person actually recognises, named as System Settings names
 * them.
 *
 * `tccd` ships 106 of these and most are internal (`kTCCServiceWillow`,
 * `kTCCServiceSensorKitWatchOnWristState`). Rather than invent a label for
 * every one, the table covers what appears in Privacy & Security and
 * `humanizeService` derives a readable fallback for the rest — an unlabelled
 * service should still show a name, because the row is about what *this app*
 * holds and hiding one would be hiding a grant.
 */
const TCC_LABELS: Record<string, string> = {
  kTCCServiceAccessibility: 'Accessibility',
  kTCCServiceAddressBook: 'Contacts',
  kTCCServiceAppleEvents: 'Automation',
  kTCCServiceAudioCapture: 'Audio Recording',
  kTCCServiceBluetoothAlways: 'Bluetooth',
  kTCCServiceCalendar: 'Calendars',
  kTCCServiceCamera: 'Camera',
  kTCCServiceContactsFull: 'Contacts',
  kTCCServiceContactsLimited: 'Contacts (limited)',
  kTCCServiceDeveloperTool: 'Developer Tools',
  kTCCServiceEndpointSecurityClient: 'Endpoint Security',
  kTCCServiceFileProviderDomain: 'File Provider',
  kTCCServiceFocusStatus: 'Focus Status',
  kTCCServiceListenEvent: 'Input Monitoring',
  kTCCServiceLocation: 'Location Services',
  kTCCServiceMediaLibrary: 'Media & Apple Music',
  kTCCServiceMicrophone: 'Microphone',
  kTCCServiceMotion: 'Motion & Fitness',
  kTCCServicePhotos: 'Photos',
  kTCCServicePhotosAdd: 'Photos (add only)',
  kTCCServicePostEvent: 'Input Control',
  kTCCServiceReminders: 'Reminders',
  kTCCServiceRemoteDesktop: 'Remote Desktop',
  kTCCServiceScreenCapture: 'Screen Recording',
  kTCCServiceSiri: 'Siri',
  kTCCServiceSpeechRecognition: 'Speech Recognition',
  // The one that bit the uninstaller: deleting another app's bundle has
  // needed this since macOS 13, and the failure path used to name Full Disk
  // Access instead. See #35.
  kTCCServiceSystemPolicyAppBundles: 'App Management',
  kTCCServiceSystemPolicyAllFiles: 'Full Disk Access',
  kTCCServiceSystemPolicyAppData: 'App Data',
  kTCCServiceSystemPolicyDesktopFolder: 'Desktop Folder',
  kTCCServiceSystemPolicyDeveloperFiles: 'Developer Files',
  kTCCServiceSystemPolicyDocumentsFolder: 'Documents Folder',
  kTCCServiceSystemPolicyDownloadsFolder: 'Downloads Folder',
  kTCCServiceSystemPolicyNetworkVolumes: 'Network Volumes',
  kTCCServiceSystemPolicyRemovableVolumes: 'Removable Volumes',
  kTCCServiceSystemPolicySysAdminFiles: 'Administration Files',
  kTCCServiceUbiquity: 'iCloud Drive',
  kTCCServiceUserTracking: 'Tracking',
  kTCCServiceVirtualMachineNetworking: 'Virtual Machine Networking',
}

/**
 * The System Settings pane that lists a service, where one is known.
 *
 * Every anchor here was read out of `SecurityPrivacyExtension.appex`, except
 * `Privacy_AllFiles`, which `/open-privacy-settings` has been using since
 * before this screen existed. A service with no entry opens Privacy &
 * Security at the top, which is the right window at the wrong scroll
 * position — the same degradation that route already documents, and better
 * than a guessed anchor that silently lands somewhere else.
 */
const SETTINGS_ANCHORS: Record<string, string> = {
  kTCCServiceAccessibility: 'Privacy_Accessibility',
  kTCCServiceAppleEvents: 'Privacy_Automation',
  kTCCServiceAudioCapture: 'Privacy_AudioCapture',
  kTCCServiceCalendar: 'Privacy_Calendars',
  kTCCServiceCamera: 'Privacy_Camera',
  kTCCServiceDeveloperTool: 'Privacy_DevTools',
  kTCCServiceMicrophone: 'Privacy_Microphone',
  kTCCServicePasteboard: 'Privacy_Pasteboard',
  kTCCServicePhotos: 'Privacy_Photos',
  kTCCServicePhotosAdd: 'Privacy_Photos',
  kTCCServiceScreenCapture: 'Privacy_ScreenCapture',
  kTCCServiceSystemPolicyAllFiles: 'Privacy_AllFiles',
  kTCCServiceSystemPolicyDesktopFolder: 'Privacy_DesktopFolder',
  kTCCServiceSystemPolicyDocumentsFolder: 'Privacy_DocumentsFolder',
  kTCCServiceSystemPolicyDownloadsFolder: 'Privacy_DownloadsFolder',
  kTCCServiceSystemPolicyNetworkVolumes: 'Privacy_NetworkVolume',
  kTCCServiceSystemPolicyRemovableVolumes: 'Privacy_RemovableVolume',
}

/** The anchor for a service, or an empty string to open the pane plainly. */
export function settingsAnchorFor(service: string): string {
  return SETTINGS_ANCHORS[service] || ''
}

/**
 * A readable name for a service with no entry above.
 *
 * `kTCCServiceSensorKitAmbientLightSensor` becomes "Sensor Kit Ambient Light
 * Sensor" — not what Apple would call it, but honest about which service it
 * is, which is the point of showing it at all.
 */
export function humanizeService(service: string): string {
  const known = TCC_LABELS[service]
  if (known)
    return known

  const derived = service
    .replace(/^kTCCService/, '')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim()

  // Never empty. A bare `kTCCService`, or no service at all, would otherwise
  // render as a blank row — which reads as a permission with no name rather
  // than as a store this app could not make sense of.
  return derived || service || 'Unnamed permission'
}

export interface TccStore {
  scope: 'user' | 'system'
  path: string
}

/**
 * The two stores, in the order they are merged.
 *
 * Exported so the suite can point `listAppPermissions` at stores it built
 * itself. Reading the real ones needs Full Disk Access, which a test run
 * does not have and CI never will, and the parsing is the part most worth
 * covering: a schema that moved between releases, a decision column that
 * means two different things, and the installed-or-not call that decides
 * whether a row says "app is gone".
 */
export const TCC_STORES: readonly TccStore[] = [
  { scope: 'user', path: path.join(HOME, 'Library/Application Support/com.apple.TCC/TCC.db') },
  { scope: 'system', path: '/Library/Application Support/com.apple.TCC/TCC.db' },
]

/**
 * Where an installed `.app` can be.
 *
 * `/System/Applications` matters as much as `/Applications` here, because
 * half the clients in a real TCC store are Apple's own and reporting Safari
 * or Terminal as uninstalled would be worse than reporting nothing.
 */
const APP_SEARCH_DIRS = [
  '/Applications',
  '/Applications/Utilities',
  '/System/Applications',
  '/System/Applications/Utilities',
  `${HOME}/Applications`,
]

interface AppIndex {
  /** Lower-cased bundle id to the bundle that declares it. */
  byBundleId: Map<string, { name: string, appPath: string }>
  /**
   * False when the index is too thin to draw a conclusion from. Everything
   * stays `'unknown'` then rather than being called missing — the orphan
   * scanner shipped the opposite behaviour in #26 and offered live apps for
   * deletion.
   */
  trustworthy: boolean
}

function indexApp(index: Map<string, { name: string, appPath: string }>, appPath: string): void {
  try {
    const info = readAppInfoPlist(appPath)
    const bundleId = info.CFBundleIdentifier
    if (typeof bundleId === 'string' && bundleId && !index.has(bundleId.toLowerCase())) {
      index.set(bundleId.toLowerCase(), {
        name: path.basename(appPath, '.app'),
        appPath,
      })
    }
  }
  catch { /* unreadable bundle; it stays absent and so stays 'unknown' */ }
}

/**
 * Every app bundle this Mac can see, keyed by bundle identifier.
 *
 * Spotlight *and* the directories, for the reason spelled out in
 * `orphans.ts`: `mdfind` answers from an index, and a stale index once
 * returned 290 bundles of which one was in `/Applications` while 44 were
 * installed there.
 */
async function buildAppIndex(): Promise<AppIndex> {
  const byBundleId = new Map<string, { name: string, appPath: string }>()

  const spotlight = await exec(
    'mdfind "kMDItemContentType == \'com.apple.application-bundle\'" 2>/dev/null',
    { timeout: 20_000 },
  )
  if (spotlight.ok) {
    for (const appPath of spotlight.stdout.split('\n').filter(Boolean))
      indexApp(byBundleId, appPath)
  }

  for (const dir of APP_SEARCH_DIRS) {
    let entries: string[]
    try {
      entries = fs.readdirSync(dir)
    }
    catch {
      continue
    }
    for (const entry of entries) {
      if (entry.endsWith('.app'))
        indexApp(byBundleId, path.join(dir, entry))
    }
  }

  // A handful of apps means something went wrong — no Spotlight and an
  // unreadable /Applications — and conclusions drawn from it would be
  // wrong in the dangerous direction.
  return { byBundleId, trustworthy: byBundleId.size >= 20 }
}

interface AccessRow {
  service: string
  client: string
  clientType: number
  decision: GrantDecision
  lastModified: Date | null
}

/**
 * Read one store, adapting to whatever schema it has.
 *
 * The columns have moved: `auth_value` replaced a plain `allowed` in Big
 * Sur, and `last_modified` is not present on every release. So the table is
 * asked what it has rather than told, and a missing column degrades that
 * field to `unknown`/`null` instead of throwing the whole read away.
 */
function readStore(file: string): { rows: AccessRow[], ok: boolean } {
  let db: Database
  try {
    db = new Database(file, { readonly: true })
  }
  catch {
    // Almost always TCC itself refusing: reading these needs Full Disk
    // Access, and the system store needs root on top of it.
    return { rows: [], ok: false }
  }

  try {
    const columns = new Set(
      (db.query('PRAGMA table_info(access)').all() as { name: string }[]).map(c => c.name),
    )
    if (!columns.has('service') || !columns.has('client'))
      return { rows: [], ok: false }

    const decisionColumn = columns.has('auth_value')
      ? 'auth_value'
      : columns.has('allowed') ? 'allowed' : null

    const select = [
      'service',
      'client',
      columns.has('client_type') ? 'client_type' : '0 AS client_type',
      decisionColumn ? `${decisionColumn} AS decision` : 'NULL AS decision',
      columns.has('last_modified') ? 'last_modified' : 'NULL AS last_modified',
    ].join(', ')

    const raw = db.query(`SELECT ${select} FROM access`).all() as {
      service: unknown
      client: unknown
      client_type: unknown
      decision: unknown
      last_modified: unknown
    }[]

    const rows: AccessRow[] = []
    for (const row of raw) {
      if (typeof row.service !== 'string' || !row.service)
        continue
      if (typeof row.client !== 'string' || !row.client)
        continue

      rows.push({
        service: row.service,
        client: row.client,
        clientType: Number(row.client_type) || 0,
        // `allowed` was a 0/1 boolean and `auth_value` is a 0..3 enum, but
        // they agree on the two values that matter: 0 is no and 2 is yes.
        // The old column never produced a 2, hence the explicit 1 case.
        decision: toDecision(row.decision, decisionColumn === 'allowed'),
        lastModified: toDate(row.last_modified),
      })
    }

    return { rows, ok: true }
  }
  catch {
    return { rows: [], ok: false }
  }
  finally {
    try { db.close() }
    catch { /* already closed */ }
  }
}

function toDecision(value: unknown, legacyBoolean: boolean): GrantDecision {
  const n = Number(value)
  if (!Number.isFinite(n))
    return 'unknown'

  if (legacyBoolean)
    return n === 1 ? 'allowed' : 'denied'

  switch (n) {
    case 0: return 'denied'
    case 2: return 'allowed'
    case 3: return 'limited'
    // 1 is "not yet asked", which is a real state and not a missing answer,
    // but it is also not a grant — the caller drops these.
    default: return 'unknown'
  }
}

function toDate(value: unknown): Date | null {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds <= 0)
    return null
  const date = new Date(seconds * 1000)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Whether a client still exists on this Mac.
 *
 * Apple's own clients are never reported missing. Most are XPC services,
 * framework bundles and daemons with no discoverable `.app` —
 * `com.apple.sharingd` has no icon in `/Applications` and never will — so an
 * index lookup says nothing about whether they are present, and a row
 * reading "app is gone" next to a running system component is exactly the
 * false positive that makes someone reset a permission they need.
 */
function resolveInstalled(
  client: string,
  clientType: 'bundle-id' | 'path',
  apple: boolean,
  index: AppIndex,
): { installed: InstalledState, name: string, appPath: string | null } {
  if (clientType === 'path') {
    // A path client is its own evidence, and needs no index to check.
    const exists = fs.existsSync(client)
    return {
      installed: exists ? 'yes' : 'no',
      name: path.basename(client),
      appPath: exists ? client : null,
    }
  }

  const hit = index.byBundleId.get(client.toLowerCase())
  if (hit)
    return { installed: 'yes', name: hit.name, appPath: hit.appPath }

  if (apple || !index.trustworthy)
    return { installed: 'unknown', name: client, appPath: null }

  return { installed: 'no', name: client, appPath: null }
}

export interface PermissionScanOptions {
  /** Which stores to read. Defaults to this Mac's two. */
  stores?: readonly TccStore[]
}

/** Every client holding a grant, apps with missing bundles first. */
export async function listAppPermissions(options: PermissionScanOptions = {}): Promise<PermissionScan> {
  if (!isMacOS) {
    return {
      apps: [],
      unavailable: true,
      reason: 'App permissions are a macOS feature.',
      systemStoreUnreadable: false,
    }
  }

  const stores = (options.stores ?? TCC_STORES).map(store => ({ ...store, ...readStore(store.path) }))
  const readable = stores.filter(store => store.ok)

  if (readable.length === 0) {
    return {
      apps: [],
      unavailable: true,
      reason: 'Reading what other apps have been granted needs Full Disk Access. '
        + 'Grant it in System Settings › Privacy & Security, then scan again.',
      systemStoreUnreadable: true,
    }
  }

  const index = await buildAppIndex()
  const byClient = new Map<string, AppPermissions>()

  for (const store of readable) {
    for (const row of store.rows) {
      // "Not yet asked" is a row TCC keeps and not a permission anybody
      // holds. Listing it would pad every app with capabilities it has never
      // been given.
      if (row.decision === 'unknown')
        continue

      let app = byClient.get(row.client)
      if (!app) {
        const clientType = row.clientType === 1 ? 'path' : 'bundle-id'
        const apple = row.client.toLowerCase().startsWith('com.apple.')
        const resolved = resolveInstalled(row.client, clientType, apple, index)
        app = {
          client: row.client,
          clientType,
          name: resolved.name,
          installed: resolved.installed,
          appPath: resolved.appPath,
          apple,
          // A path client is not a bundle identifier, so `tccutil` has
          // nothing to resolve and refuses it for the same reason.
          resettable: clientType === 'bundle-id' && resolved.installed !== 'no',
          grants: [],
        }
        byClient.set(row.client, app)
      }

      app.grants.push({
        service: row.service,
        label: humanizeService(row.service),
        decision: row.decision,
        scope: store.scope,
        lastModified: row.lastModified,
        settingsAnchor: settingsAnchorFor(row.service),
      })
    }
  }

  const apps = [...byClient.values()]
  for (const app of apps)
    app.grants.sort((a, b) => a.label.localeCompare(b.label))

  // Grants whose app is gone lead: that is the one thing System Settings
  // cannot show, and the reason to open this screen.
  apps.sort((a, b) => {
    if ((a.installed === 'no') !== (b.installed === 'no'))
      return a.installed === 'no' ? -1 : 1
    if (a.apple !== b.apple)
      return a.apple ? 1 : -1
    return a.name.localeCompare(b.name)
  })

  return {
    apps,
    unavailable: false,
    systemStoreUnreadable: stores.some(store => store.scope === 'system' && !store.ok),
  }
}

/** A TCC service name, as `tccutil` will accept it. */
const SERVICE_NAME = /^kTCCService[A-Za-z]+$/

/**
 * A bundle id, or an absolute path with nothing shell-interesting in it.
 *
 * Both are escaped before they reach a shell regardless; this rejects the
 * shapes that could not be a real client in the first place, so a malformed
 * one fails here rather than as a confusing `tccutil` error.
 */
const CLIENT_NAME = /^(?:[A-Za-z0-9][\w.-]*|\/[\w./ -]+)$/

export interface PermissionResetResult {
  success: boolean
  error?: string
}

/**
 * Forget a decision, so the app is asked again next time.
 *
 * Not a revoke, and the UI must not call it one. `tccutil reset` deletes the
 * row; it does not write a denial. An app that still needs the capability
 * prompts for it on its next launch, and one that is gone simply stops
 * holding a grant nobody could see.
 *
 * There is no counterpart that grants. SIP blocks writing to `TCC.db` even
 * as root, and Automation entries cannot be added by hand at all — which is
 * why this module is a viewer with one button rather than an editor.
 */
export async function resetPermission(service: string, client: string): Promise<PermissionResetResult> {
  if (!isMacOS)
    return { success: false, error: 'App permissions are a macOS feature' }

  if (!SERVICE_NAME.test(service))
    return { success: false, error: 'Not a permission this Mac knows' }

  if (!CLIENT_NAME.test(client))
    return { success: false, error: 'Not an app identifier' }

  const result = await exec(
    `tccutil reset ${shellEscape(service.replace(/^kTCCService/, ''))} ${shellEscape(client)} 2>&1`,
    { timeout: 30_000 },
  )

  if (result.ok)
    return { success: true }

  const message = (result.stdout || result.stderr || '').trim()

  // The common failure, and the one worth translating. `tccutil` resolves
  // the bundle identifier before it resets anything, so a grant left behind
  // by a deleted app always lands here.
  if (/no such bundle identifier/i.test(message)) {
    return {
      success: false,
      error: 'macOS will not reset a permission for an app it cannot find. '
        + 'Remove the entry with the − button in System Settings › Privacy & Security.',
    }
  }

  return { success: false, error: message.slice(0, 200) || 'tccutil refused the reset' }
}
