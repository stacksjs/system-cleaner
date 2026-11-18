import { describe, expect, it } from 'bun:test'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { AutoUpdater } from '@stacksjs/desktop'
import {
  downloadPathFor,
  existingDownload,
  fileSha256,
  legacyDownloadDir,
  relaunchCommand,
  removeEmptyDirs,
  sweepDownloads,
  updateDownloadDir,
} from '../app/Support/Update/downloads'

/**
 * What an update leaves behind, and the order it puts itself back together in.
 *
 * Both of these only ever went wrong silently. A download abandoned by a
 * failed install sat in the temp directory of a disk-cleaning app for as long
 * as the machine stayed up, and a relaunch in the wrong order cost the page
 * its origin and everything stored against it. Neither raised anything.
 */

function scratch(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sc-updates-test-'))
}

function write(dir: string, name: string, body: string): string {
  const file = path.join(dir, name)
  fs.writeFileSync(file, body)
  return file
}

function sha256(body: string): string {
  return crypto.createHash('sha256').update(body).digest('hex')
}

describe('where a download lives', () => {
  // Built with `path.join` rather than written out, because the Windows leg of
  // CI runs this suite too and a literal separator is the one difference that
  // has nothing to do with what is being asserted.
  it('keeps downloads in a directory of its own, not one shaped like a bundle', () => {
    const dir = updateDownloadDir('/tmp')
    expect(dir).toBe(path.join('/tmp', 'system-cleaner-updates'))
    // Craft's default is `craft-updates/<bundle file name>/`, which reads as a
    // path inside an app bundle and cannot be swept without reproducing it.
    expect(dir).not.toContain('.app')
  })

  it('names the file the way the updater will, so the path can be predicted', () => {
    expect(downloadPathFor('/tmp/u', 'https://example.com/v1/SystemCleaner-1.0.0.dmg'))
      .toBe(path.join('/tmp/u', 'SystemCleaner-1.0.0.dmg'))
  })

  it('still knows where downloads landed before the directory was pinned', () => {
    expect(legacyDownloadDir('/Applications/SystemCleaner.app', '/tmp'))
      .toBe(path.join('/tmp', 'craft-updates', 'SystemCleaner.app'))
  })

  it('collects what the old location was left holding', () => {
    const tmp = scratch()
    const legacy = legacyDownloadDir('/Applications/SystemCleaner.app', tmp)
    fs.mkdirSync(legacy, { recursive: true })
    write(legacy, 'SystemCleaner-1.0.0.dmg', 'abandoned by a failed install')

    expect(sweepDownloads(legacy, null)).toHaveLength(1)
    removeEmptyDirs(legacy, path.dirname(legacy))

    expect(fs.existsSync(path.join(tmp, 'craft-updates'))).toBe(false)
  })

  it('leaves a directory that still has something in it', () => {
    const dir = scratch()
    write(dir, 'someone-elses-file', 'x')
    removeEmptyDirs(dir)
    expect(fs.existsSync(dir)).toBe(true)
  })
})

describe('picking up a download that outlived its process', () => {
  it('returns the file when it matches the manifest hash', async () => {
    const dir = scratch()
    write(dir, 'App-1.0.0.dmg', 'bundle bytes')
    const found = await existingDownload(dir, 'https://example.com/App-1.0.0.dmg', sha256('bundle bytes'))
    expect(found).toBe(path.join(dir, 'App-1.0.0.dmg'))
  })

  it('refuses a half-written one rather than trusting the name', async () => {
    const dir = scratch()
    write(dir, 'App-1.0.0.dmg', 'truncated')
    const found = await existingDownload(dir, 'https://example.com/App-1.0.0.dmg', sha256('bundle bytes'))
    expect(found).toBeNull()
  })

  it('reports nothing rather than throwing when there is no download', async () => {
    const dir = scratch()
    expect(await existingDownload(dir, 'https://example.com/App-1.0.0.dmg', sha256('x'))).toBeNull()
    expect(await fileSha256(path.join(dir, 'absent'))).toBeNull()
  })

  /**
   * The canary for a Craft upgrade. `self-update.ts` hands an already-verified
   * download back by writing these two fields, because there is no public way
   * to say "you already have this". If they are ever renamed, the fallback is
   * a re-download — but this test is how that gets noticed rather than paid
   * for 35 MB at a time.
   */
  it('still finds the fields on the updater that hold a verified download', () => {
    const instance = new AutoUpdater({
      updateUrl: 'https://example.invalid/update.json',
      currentVersion: '1.0.0',
      appPath: '/Applications/Nothing.app',
    })
    expect('downloadPath' in instance).toBe(true)
    expect('verifiedDownloadPath' in instance).toBe(true)
  })
})

describe('sweeping what an install abandoned', () => {
  it('removes everything but the download being offered', () => {
    const dir = scratch()
    const keep = write(dir, 'App-2.0.0.dmg', 'new')
    write(dir, 'App-1.9.0.dmg', 'superseded')
    write(dir, 'App-1.0.0.dmg', 'failed install')

    const removed = sweepDownloads(dir, keep)

    expect(removed).toHaveLength(2)
    expect(fs.readdirSync(dir)).toEqual(['App-2.0.0.dmg'])
  })

  it('clears the directory when nothing is on offer', () => {
    const dir = scratch()
    write(dir, 'App-1.0.0.dmg', 'residue')
    expect(sweepDownloads(dir, null)).toHaveLength(1)
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it('keeps the file it was told to keep however the path is spelled', () => {
    const dir = scratch()
    write(dir, 'App-2.0.0.dmg', 'new')
    sweepDownloads(dir, path.join(dir, '.', 'App-2.0.0.dmg'))
    expect(fs.readdirSync(dir)).toEqual(['App-2.0.0.dmg'])
  })

  it('treats a directory that was never created as nothing to do', () => {
    expect(sweepDownloads(path.join(scratch(), 'never'), null)).toEqual([])
  })
})

describe('relaunching in the order that keeps the port', () => {
  it('waits for the launcher to exit before it opens anything', () => {
    const [command, flag, script] = relaunchCommand('/Applications/SystemCleaner.app', 4242)
    expect(command).toBe('/bin/sh')
    expect(flag).toBe('-c')
    // The wait has to come first. Craft's default opens the new copy 250 ms
    // before the old one is told to quit, which is how two agents end up
    // reaching for one remembered port.
    expect(script.indexOf('kill -0')).toBeLessThan(script.indexOf('open'))
  })

  it('passes the path and the pid as arguments, never as shell text', () => {
    const argv = relaunchCommand('/Applications/My "App"; rm -rf ~.app', 4242)
    const script = argv[2]
    expect(script).not.toContain('My "App"')
    expect(script).not.toContain('4242')
    expect(argv.slice(3)).toEqual(['sh', '/Applications/My "App"; rm -rf ~.app', '4242', '150'])
  })

  // The relaunch is macOS-only — `unsupportedReason` refuses anything else —
  // and this runs the real script, so there is no `/bin/sh` to run it with on
  // the Windows leg of CI.
  it.skipIf(process.platform === 'win32')('actually blocks while the launcher is alive, and stops when it is not', async () => {
    // The real script text, cut before the `open` it ends with — the loop is
    // the part under test, and a test cannot be allowed to launch an app.
    const script = relaunchCommand('/unused', 0, 3)[2]
    const loop = script.slice(0, script.indexOf('exec /usr/bin/open'))

    const run = async (pid: number): Promise<number> => {
      const started = Date.now()
      await Bun.spawn(['/bin/sh', '-c', loop, 'sh', '/unused', String(pid), '3']).exited
      return Date.now() - started
    }

    // A pid nothing can own exits the loop on the first test.
    expect(await run(0x7FFFFFFF)).toBeLessThan(250)
    // This process is alive, so the loop runs its three tenths out.
    expect(await run(process.pid)).toBeGreaterThanOrEqual(250)
  })
})
