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
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import process from 'node:process'
import {
  bundlePathForExecutable,
  canReplaceBundle,
  createSelfUpdater,
  quitLauncher,
  readBundleIdentity,
} from '@stacksjs/desktop'
import {
  downloadPathFor,
  existingDownload,
  legacyDownloadDir,
  relaunchCommand,
  removeEmptyDirs,
  sweepDownloads,
  updateDownloadDir,
} from './downloads'

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

/**
 * The version this copy is running, read fresh every time it is asked for.
 *
 * Read once at import, this was wrong in the one case that matters. The agent
 * can outlive the bundle it was started from — a copy dragged over
 * `/Applications`, an update installed by a second copy — and a version cached
 * at boot then offers an update to the version already installed, downloads it,
 * and swaps it in over itself. It costs one read of a small file to not be
 * confidently wrong about which app this is.
 */
function installedVersion(): string {
  return readInstalledVersion(bundlePath)
}

let status: UpdateStatus = {
  stage: 'idle',
  currentVersion: installedVersion(),
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
  // The Mac App Store edition runs sandboxed, and the Store delivers its
  // updates; Apple does not allow a Store app to replace itself.
  if (process.env.APP_SANDBOX_CONTAINER_ID)
    return 'Installed from the App Store, which delivers its updates.'
  if (!bundlePath)
    return 'This copy is running from the source tree, not an installed app.'
  if (!canReplaceBundle(bundlePath))
    return `${path.dirname(bundlePath)} is not writable by this user, so the app cannot replace itself.`
  return null
}

let updater: AutoUpdater | null = null
let updaterPromise: Promise<AutoUpdater> | null = null
/** The version the cached updater was built to compare against. */
let updaterVersion: string | null = null

/**
 * The updater, built once per installed version.
 *
 * Construction reads the running bundle's code signature to decide which
 * signing team updates must come from, so it is async and worth caching. The
 * promise is cached rather than the result so two screens asking at the same
 * moment share one construction instead of racing.
 *
 * It is thrown away when the bundle underneath turns out to be a different
 * version than the one it was built for, because `currentVersion` is what
 * every comparison in it is made against and there is no public way to correct
 * it in place. Never mid-transfer: a rebuild there would abandon a download
 * the user is watching.
 */
function getUpdater(): Promise<AutoUpdater> {
  const version = installedVersion()
  const settled = status.stage !== 'downloading' && status.stage !== 'installing'
  if (updaterVersion !== null && updaterVersion !== version && settled) {
    updater = null
    updaterPromise = null
  }

  if (updater) return Promise.resolve(updater)
  if (updaterPromise) return updaterPromise

  updaterVersion = version
  updaterPromise = createSelfUpdater({
    repository: REPOSITORY,
    currentVersion: version,
    appPath: bundlePath ?? undefined,
    // The user asks for the download. A background fetch of 40 MB on someone
    // else's tethered connection is not a decision this app gets to make.
    autoDownload: false,
    autoInstall: false,
    // Somewhere this app can find again, so a download survives the app
    // quitting and an abandoned one can be collected. See `./downloads`.
    downloadDir: updateDownloadDir(),
    // Quit, then reopen — the opposite order to Craft's default, and the
    // difference between keeping the loopback port and silently emptying
    // everything the page has stored. See `relaunchCommand`.
    relaunch: (appPath: string) => {
      const [command, ...args] = relaunchCommand(appPath, process.ppid)
      spawn(command, args, { detached: true, stdio: 'ignore' }).unref()
      quitLauncher()
    },
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
    //
    // Also written to stderr, which the launcher inherits. An update that
    // fails leaves the user looking at one sentence in a window they are about
    // to close; the reason a bundle swap was refused has to outlive that.
    instance.on('error', (error: unknown) => {
      status = { ...status, stage: 'error', error: describe(error) }
      console.error('[SystemCleaner] self-update:', describe(error))
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
 * Tell the updater about a download it did not make itself.
 *
 * `AutoUpdater` remembers a verified download in instance state, so one that
 * outlived the process that fetched it is invisible to the next: the disk
 * image is there, hashed and correct, and "Restart to Install" has quietly
 * become "Download Update" again. Thirty-five megabytes, fetched twice, for
 * nothing — and the first copy left behind, because only the process that knew
 * about it could have collected it.
 *
 * There is no public way to hand one over, so the two fields are written
 * directly. That is safe in the way that matters: `installUpdate` recomputes
 * the SHA-256 against the manifest before it extracts anything, so a path
 * handed over here cannot cause something unvouched-for to be installed, only
 * spare a second download of something that is. The feature check keeps a
 * Craft that renames the fields to a re-download rather than an exception.
 */
function adoptDownload(instance: AutoUpdater, file: string): boolean {
  const fields = instance as unknown as {
    downloadPath?: string | null
    verifiedDownloadPath?: string | null
  }
  if (!('downloadPath' in fields) || !('verifiedDownloadPath' in fields))
    return false

  fields.downloadPath = file
  fields.verifiedDownloadPath = file
  return true
}

/**
 * Take stock of the download directory against what the manifest now offers.
 *
 * Both halves of this are the same question asked once: which file on disk, if
 * any, is the update this app is being offered? Everything else in there is
 * residue — a failed install's disk image, or a version that has since been
 * superseded — and this is the only moment the app is in a position to know
 * that, because it is the only moment it knows what the current answer is.
 *
 * Returns true when the update is already downloaded and verified.
 */
async function reconcileDownloads(
  instance: AutoUpdater,
  info: UpdateManifest | null,
): Promise<boolean> {
  const dir = updateDownloadDir()
  const offered = info?.platforms?.darwin ?? null
  const keep = offered ? downloadPathFor(dir, offered.url) : null

  const removed = sweepDownloads(dir, keep)

  // Collect whatever the version before this one abandoned in Craft's default
  // location, which nothing else will ever look at again.
  if (bundlePath) {
    const legacy = legacyDownloadDir(bundlePath)
    removed.push(...sweepDownloads(legacy, null))
    removeEmptyDirs(legacy, path.dirname(legacy))
  }

  if (removed.length > 0)
    console.error(`[SystemCleaner] self-update: discarded ${removed.length} stale download(s)`)

  if (!offered)
    return false

  const verified = await existingDownload(dir, offered.url, offered.sha256)
  return verified ? adoptDownload(instance, verified) : false
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
  status = { ...status, currentVersion: installedVersion() }
  return status
}

/** Ask GitHub whether there is a newer release. */
export async function checkForUpdate(): Promise<UpdateStatus> {
  const reason = unsupportedReason()
  if (reason)
    return { ...status, stage: 'unsupported', unsupportedReason: reason }

  if (['checking', 'downloading', 'ready', 'installing'].includes(status.stage)) return status
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

    // A check is the only point at which this app knows which download is the
    // one being offered, so it is where an abandoned one gets collected and an
    // already-verified one gets picked back up.
    const ready = await reconcileDownloads(instance, info)

    status = {
      ...status,
      stage: info ? (ready ? 'ready' : 'available') : 'up-to-date',
      currentVersion: installedVersion(),
      latestVersion: info?.version ?? null,
      releaseNotes: info?.releaseNotes ?? null,
      percent: ready ? 100 : 0,
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

  if (status.stage === 'installing') return status
  if (status.stage !== 'ready')
    return { ...status, stage: 'error', error: 'No update has been downloaded yet.' }

  status = { ...status, stage: 'installing', error: null }

  const instance = await getUpdater()
  void instance.installUpdate(true).catch((error) => {
    status = { ...status, stage: 'error', error: describe(error) }
  })

  return status
}
