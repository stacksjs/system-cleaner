/**
 * The files an update leaves on disk, and the order a relaunch has to happen
 * in.
 *
 * Both live here rather than in `self-update.ts` because that module resolves
 * the running `.app` and builds an updater as a side effect of being imported,
 * so nothing inside it can be exercised from a test.
 */

import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

/**
 * Where a downloaded update waits to be installed.
 *
 * Pinned rather than left to Craft, which derives the directory from the
 * bundle's file name and so puts a 35 MB disk image in
 * `craft-updates/SystemCleaner.app/` — a path that reads like an app bundle,
 * is not one, and which this app could only sweep by reproducing how that name
 * was built. Naming it here is what makes the sweep below possible.
 *
 * Still under the temp directory. A download has to survive the app quitting,
 * which this does, but it should not survive a reboot: that is the one cleanup
 * nobody has to remember, and the cost of being wrong is a re-download.
 */
export function updateDownloadDir(tmpDir: string = os.tmpdir()): string {
  return path.join(tmpDir, 'system-cleaner-updates')
}

/**
 * Where the updater will put — or has already put — a manifest entry's
 * download.
 *
 * `path.basename` of the whole URL, which is what Craft's updater does to name
 * the file. Predicting that path exactly is the entire point of this function,
 * so it has to be wrong in the same way if it is ever wrong at all.
 */
export function downloadPathFor(dir: string, url: string): string {
  return path.join(dir, path.basename(url))
}

/**
 * Where downloads landed before this app named the directory itself.
 *
 * Pinning `downloadDir` fixes the next orphan and strands the last one:
 * there is a verified 35 MB disk image in Craft's default location on every
 * machine whose install failed, and nothing will ever look there again. So
 * this reproduces that default — `craft-updates/<bundle file name>/` — once,
 * to collect it.
 *
 * Nothing this version writes can be in here, so it is always swept whole.
 */
export function legacyDownloadDir(appPath: string, tmpDir: string = os.tmpdir()): string {
  return path.join(tmpDir, 'craft-updates', path.basename(appPath) || 'app')
}

/** SHA-256 of a file, or null when it cannot be read. */
export async function fileSha256(file: string): Promise<string | null> {
  return new Promise((resolve) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(file)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', () => resolve(null))
  })
}

/**
 * The download already on disk for this manifest entry, or null.
 *
 * Hashed rather than trusted on size or name. A file left behind by a failed
 * install is the normal case here, and a truncated one looks identical from
 * the outside.
 */
export async function existingDownload(
  dir: string,
  url: string,
  sha256: string,
): Promise<string | null> {
  const file = downloadPathFor(dir, url)
  if (!fs.existsSync(file))
    return null
  return (await fileSha256(file)) === sha256 ? file : null
}

/**
 * Delete everything in the download directory except `keep`.
 *
 * Craft deletes the download once an install succeeds, so anything still here
 * is the residue of one that did not — and nothing ever collected it, because
 * the next launch has no memory of having started it. A 35 MB disk image that
 * outlives the version it was for, in an app whose whole job is reclaiming
 * disk space, is the wrong file to leave behind.
 *
 * Returns what it removed, for the caller to log.
 */
export function sweepDownloads(dir: string, keep: string | null): string[] {
  let entries: string[]
  try {
    entries = fs.readdirSync(dir)
  }
  catch {
    // No directory yet, which is the same as nothing to sweep.
    return []
  }

  const removed: string[] = []
  for (const entry of entries) {
    const file = path.join(dir, entry)
    if (keep && path.resolve(file) === path.resolve(keep))
      continue
    try {
      fs.rmSync(file, { recursive: true, force: true })
      removed.push(file)
    }
    catch {
      // Someone else's file, or a permission we do not have. Leaving it is
      // better than failing an update check over it.
    }
  }
  return removed
}

/**
 * Remove a swept directory, and the parent it was the only tenant of.
 *
 * Only ever called on directories this app created or reproduced the name of,
 * and only when they are already empty — `rmdir` refuses otherwise, which is
 * the check rather than a race against it.
 */
export function removeEmptyDirs(...dirs: string[]): void {
  for (const dir of dirs) {
    try {
      fs.rmdirSync(dir)
    }
    catch {
      // Not empty, or not there. Either way there is nothing to do.
    }
  }
}

/**
 * Wait for the old copy to be gone, then open the new one.
 *
 * The ordering is the fix. Craft's default relaunch opens the bundle first and
 * quits the old copy 250 ms later, which is backwards for this app: the agent
 * serves the page from a loopback port it remembers between launches, so for
 * those 250 ms — plus however long a graceful shutdown takes — two agents are
 * reaching for one port. The loser falls back to a fresh one and writes it
 * down, the page's origin changes with it, and `localStorage` silently empties:
 * appearance back to system, every switch in Settings back to its default. The
 * update worked and the app looks like it was reinstalled.
 *
 * So this quits first and opens afterwards, from a process that outlives both.
 * `kill -0` polls the launcher — the parent that owns the agent and the window
 * — and the brief wait after it disappears covers the socket being released
 * after the process holding it is reaped.
 *
 * The path and the pid go in as positional arguments rather than interpolated
 * into the script, so neither can be read as shell syntax.
 */
export function relaunchCommand(
  appPath: string,
  launcherPid: number,
  waitTenths = 150,
): string[] {
  const script = [
    'i=0',
    'while [ "$i" -lt "$3" ] && kill -0 "$2" 2>/dev/null; do',
    '  sleep 0.1',
    '  i=$((i + 1))',
    'done',
    'sleep 0.2',
    'exec /usr/bin/open -n "$1"',
  ].join('\n')

  return ['/bin/sh', '-c', script, 'sh', appPath, String(launcherPid), String(waitTenths)]
}
