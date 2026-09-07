/**
 * Updating SystemCleaner itself.
 *
 * The mechanics — fetch the manifest, verify the download, replace the bundle,
 * relaunch — live in `@stacksjs/desktop`, which gets them from Craft. What
 * belongs here is the part that is about this app: where its releases are, and
 * the fact that a download the user is waiting on has to be observable from a
 * screen that may be re-rendered or navigated away from halfway through.
 *
 * Nothing in here is reachable off the local agent: `routes/api.ts` does not
 * register the control plane on the public deployment at all.
 */

import type { AutoUpdater, UpdateManifest, UpdateProgress } from '@stacksjs/desktop'
import * as fs from 'node:fs'
import * as path from 'node:path'
import process from 'node:process'
import {
  bundlePathForExecutable,
  canReplaceBundle,
  createSelfUpdater,
  readBundleIdentity,
} from '@stacksjs/desktop'

/** Where releases are published. The manifest is an asset on the newest one. */
const REPOSITORY = 'stacksjs/system-cleaner'

/**
 * How the update flow looks from a screen.
 *
 * One value rather than a set of booleans: `downloading` and `ready` and
 * `error` are mutually exclusive, and a UI that has to reconcile three flags
 * eventually renders a state that cannot happen.
 */
export type UpdateStage =
  | 'unsupported'
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'installing'
  | 'error'

export interface UpdateStatus {
  stage: UpdateStage
  /** Version running now. */
  currentVersion: string
  /** Version on offer, when there is one. */
  latestVersion: string | null
  releaseNotes: string | null
  /** 0–100 while downloading. */
  percent: number
  bytesDownloaded: number
  bytesTotal: number
  /** Bytes per second, for a rate the user can sanity-check against their line. */
  speed: number
  error: string | null
  /** Why updating is not possible here, when `stage` is `unsupported`. */
  unsupportedReason: string | null
  /** Team ID the running bundle is signed with, and the one updates are pinned to. */
  teamId: string | null
  checkedAt: string | null
}

/**
 * The version this process is running.
 *
 * The bundle's `Info.plist` is authoritative: it is what the user sees in
 * Finder, what the release was tagged with, and — unlike anything compiled in
 * from `package.json` — it cannot disagree with the bundle it sits inside.
 */
function readInstalledVersion(bundlePath: string | null): string {
  if (bundlePath) {
    try {
      const plist = fs.readFileSync(path.join(bundlePath, 'Contents/Info.plist'), 'utf8')
      const match = plist.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/)
      if (match) return match[1].trim()
    }
    catch {
      // Fall through to the source tree's own answer.
    }
  }

  try {
    const pkg = JSON.parse(fs.readFileSync(new URL('../../../package.json', import.meta.url).pathname, 'utf8'))
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0'
  }
  catch {
    return '0.0.0'
  }
}

const bundlePath = bundlePathForExecutable()
const currentVersion = readInstalledVersion(bundlePath)

let status: UpdateStatus = {
  stage: 'idle',
  currentVersion,
  latestVersion: null,
  releaseNotes: null,
  percent: 0,
  bytesDownloaded: 0,
  bytesTotal: 0,
  speed: 0,
  error: null,
  unsupportedReason: null,
  teamId: null,
  checkedAt: null,
}

/**
 * Why this copy cannot update itself, or null when it can.
 *
 * Answered once and reported rather than discovered halfway through: a user
 * who is told up front that the app is running from a source tree is better
 * served than one who watches a 40 MB download and then sees it fail.
 */
function unsupportedReason(): string | null {
  if (process.platform !== 'darwin')
    return 'Automatic updates are only implemented for macOS.'
  if (!bundlePath)
    return 'This copy is running from the source tree, not an installed app.'
  if (!canReplaceBundle(bundlePath))
    return `${path.dirname(bundlePath)} is not writable by this user, so the app cannot replace itself.`
  return null
}

let updater: AutoUpdater | null = null
let updaterPromise: Promise<AutoUpdater> | null = null

/**
 * The updater, built once.
 *
 * Construction reads the running bundle's code signature to decide which
 * signing team updates must come from, so it is async and worth caching. The
 * promise is cached rather than the result so two screens asking at the same
 * moment share one construction instead of racing.
 */
function getUpdater(): Promise<AutoUpdater> {
  if (updater) return Promise.resolve(updater)
  if (updaterPromise) return updaterPromise

  updaterPromise = createSelfUpdater({
    repository: REPOSITORY,
    currentVersion,
    appPath: bundlePath ?? undefined,
    // The user asks for the download. A background fetch of 40 MB on someone
    // else's tethered connection is not a decision this app gets to make.
    autoDownload: false,
    autoInstall: false,
  }).then((instance) => {
    instance.on('download-progress', (progress: UpdateProgress) => {
      if (progress.phase === 'downloading') {
        status = {
          ...status,
          stage: 'downloading',
          percent: progress.percent,
          bytesDownloaded: progress.bytesDownloaded ?? 0,
          bytesTotal: progress.bytesTotal ?? 0,
          speed: progress.speed ?? 0,
        }
      }
    })

    instance.on('update-downloaded', () => {
      status = { ...status, stage: 'ready', percent: 100 }
    })

    // The updater emits `error` as an EventEmitter event, which crashes the
    // process when nothing is listening. This listener is the difference
    // between a failed update and a dead agent.
    instance.on('error', (error: unknown) => {
      status = { ...status, stage: 'error', error: describe(error) }
    })

    updater = instance
    return instance
  }).catch((error) => {
    updaterPromise = null
    throw error
  })

  return updaterPromise
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Fill in the signing team, once.
 *
 * Reading it costs a `codesign` call, and it is the same answer for the life
 * of the process — but every entry point wants it, because it is what the UI
 * shows to say *whose* updates this copy will accept.
 */
async function ensureTeamId(): Promise<void> {
  if (status.teamId !== null || !bundlePath)
    return
  const identity = await readBundleIdentity(bundlePath)
  status = { ...status, teamId: identity.teamId }
}

/** Current state, for a screen that just opened or is polling. */
export async function updateStatus(): Promise<UpdateStatus> {
  const reason = unsupportedReason()
  if (reason)
    return { ...status, stage: 'unsupported', unsupportedReason: reason }

  await ensureTeamId()
  return status
}

/** Ask GitHub whether there is a newer release. */
export async function checkForUpdate(): Promise<UpdateStatus> {
  const reason = unsupportedReason()
  if (reason)
    return { ...status, stage: 'unsupported', unsupportedReason: reason }

  await ensureTeamId()
  status = { ...status, stage: 'checking', error: null }

  try {
    const instance = await getUpdater()
    const info: UpdateManifest | null = await instance.checkForUpdates()

    // `null` covers two outcomes the user must not see conflated: there is no
    // newer version, and we could not reach GitHub to find out. Reporting the
    // second as "up to date" is the one wrong answer an update check can give
    // — confident, false, and it stops the user looking any further.
    const failure = instance.getLastError()
    if (!info && failure) {
      status = {
        ...status,
        stage: 'error',
        error: `Could not check for updates: ${failure.message}`,
        checkedAt: new Date().toISOString(),
      }
      return status
    }

    status = {
      ...status,
      stage: info ? 'available' : 'up-to-date',
      latestVersion: info?.version ?? null,
      releaseNotes: info?.releaseNotes ?? null,
      error: null,
      checkedAt: new Date().toISOString(),
    }
  }
  catch (error) {
    status = { ...status, stage: 'error', error: describe(error) }
  }

  return status
}

/**
 * Fetch the update the last check found.
 *
 * Returns as soon as the download is under way rather than when it finishes:
 * a 40 MB transfer outlives any sensible HTTP timeout, and the screen already
 * polls `updateStatus` for the progress the events keep current.
 */
export async function downloadUpdate(): Promise<UpdateStatus> {
  const reason = unsupportedReason()
  if (reason)
    return { ...status, stage: 'unsupported', unsupportedReason: reason }

  if (status.stage === 'downloading' || status.stage === 'ready')
    return status

  if (status.stage !== 'available')
    return { ...status, stage: 'error', error: 'No update has been found to download.' }

  status = { ...status, stage: 'downloading', percent: 0, bytesDownloaded: 0, error: null }

  const instance = await getUpdater()
  void instance.downloadUpdate().catch((error) => {
    status = { ...status, stage: 'error', error: describe(error) }
  })

  return status
}

/**
 * Verify the downloaded bundle, swap it in, and relaunch.
 *
 * The reply is sent before the relaunch happens — `createSelfUpdater` gives
 * the install a short delay before it quits the launcher, so the screen learns
 * the install succeeded rather than seeing the connection drop and guessing.
 */
export async function installUpdate(): Promise<UpdateStatus> {
  const reason = unsupportedReason()
  if (reason)
    return { ...status, stage: 'unsupported', unsupportedReason: reason }

  if (status.stage !== 'ready')
    return { ...status, stage: 'error', error: 'No update has been downloaded yet.' }

  status = { ...status, stage: 'installing', error: null }

  const instance = await getUpdater()
  void instance.installUpdate(true).catch((error) => {
    status = { ...status, stage: 'error', error: describe(error) }
  })

  return status
}
