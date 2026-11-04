#!/usr/bin/env bun
/* eslint-disable no-console */
/**
 * Regenerate `app/Desktop/dmg-window.DS_Store` — the window layout a mounted
 * SystemCleaner.dmg opens with.
 *
 * Run by hand on a Mac, never by the build:
 *
 *     bun scripts/author-dmg-window.ts
 *
 * Finder is the only thing that writes a `.DS_Store`, and it only does so
 * while a window is open on a writable volume. So this stages a volume whose
 * items have the names the real image uses, opens it, arranges it, closes it,
 * and lifts the file Finder left behind. The result is committed; see
 * `scripts/dmg-window.ts` for why a committed fixture rather than doing this
 * during the build.
 *
 * The app bundle staged here is an empty directory. Nothing in a `.DS_Store`
 * depends on what is inside an item — icon positions are keyed by filename
 * alone — so this needs no build output and takes a couple of seconds.
 *
 * A Finder window will open and close on screen. That is the point.
 */

import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import process from 'node:process'
import { DMG_WINDOW_FIXTURE, finderLayoutScript, requireDmgWindowLayout } from './dmg-window'

if (process.platform !== 'darwin') {
  console.error('[dmg-window] only Finder can author this, so only macOS can run it')
  process.exit(1)
}

/**
 * Not `SystemCleaner`, for the same reason the shipped volume is not: on a Mac
 * with the app installed, TCC refuses to let anything create
 * `/Volumes/SystemCleaner/SystemCleaner.app` over the copy it manages and
 * `hdiutil` fails with "Operation not permitted".
 */
const VOLUME = 'SystemCleaner Layout'

function run(command: string, args: string[]): void {
  const done = spawnSync(command, args, { stdio: 'inherit' })
  if (done.status !== 0)
    throw new Error(`${command} ${args.join(' ')} failed`)
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'system-cleaner-layout-'))
const staging = path.join(work, 'volume')
const image = path.join(work, 'layout.dmg')
let mount: string | null = null

function detach(target: string): void {
  spawnSync('hdiutil', ['detach', target], { stdio: 'ignore' })
}

try {
  fs.mkdirSync(path.join(staging, 'SystemCleaner.app'), { recursive: true })
  fs.symlinkSync('/Applications', path.join(staging, 'Applications'))

  // A stale mount from an interrupted run would be attached as
  // "SystemCleaner Layout 1" and leave this arranging the wrong volume.
  detach(path.join('/Volumes', VOLUME))

  // Writable, and oversized: Finder needs room to add the file, and the
  // slack never ships — the build converts to a compressed image.
  run('hdiutil', ['create', '-volname', VOLUME, '-srcfolder', staging, '-ov', '-format', 'UDRW', '-size', '40m', image])

  // Mounted where Finder can see it. `disk "name"` resolves against
  // /Volumes, so a private mountpoint fails with "Can't get disk" (-1728).
  const attached = spawnSync('hdiutil', ['attach', image], { encoding: 'utf8' })
  if (attached.status !== 0)
    throw new Error(`could not mount the staging volume: ${attached.stderr}`)
  mount = attached.stdout.split('\n')
    .map(line => line.split('\t').pop()?.trim() ?? '')
    .filter(entry => entry.startsWith('/Volumes/'))
    .pop() ?? null
  if (!mount)
    throw new Error(`hdiutil mounted nothing under /Volumes:\n${attached.stdout}`)

  /**
   * Wait for Finder, not for the filesystem.
   *
   * The mountpoint exists the instant `hdiutil attach` returns, but Finder
   * keeps its own list of disks and has not necessarily noticed yet — so
   * arranging immediately fails with "Can't get disk" (-1728) against a volume
   * that is demonstrably mounted. Asking Finder whether it can see it is the
   * only question whose answer means anything here.
   */
  const name = path.basename(mount)
  let visible = false
  for (let attempt = 0; attempt < 40; attempt++) {
    const asked = spawnSync('osascript', ['-e', `tell application "Finder" to exists disk ${JSON.stringify(name)}`], { encoding: 'utf8' })
    if (asked.stdout.trim() === 'true') {
      visible = true
      break
    }
    spawnSync('sleep', ['0.25'], { stdio: 'ignore' })
  }
  if (!visible)
    throw new Error(`Finder never saw ${mount}; nothing to arrange`)

  // macOS creates `.fseventsd` on any writable volume it mounts, and Finder
  // records a position for it like any other item — which lands a junk `Iloc`
  // in the committed fixture that varies from run to run. Hidden, harmless,
  // and not something a layout should carry.
  fs.rmSync(path.join(mount, '.fseventsd'), { recursive: true, force: true })

  console.log(`[dmg-window] arranging ${mount}`)

  // The no-background version: a background cannot be baked into a fixture,
  // so the committed layout is position-only and the build sets the picture
  // on the volume it actually ships. See `scripts/dmg-window.ts`.
  const script = finderLayoutScript({ background: false })

  const arranged = spawnSync('osascript', ['-', name], {
    input: script,
    encoding: 'utf8',
  })
  if (arranged.status !== 0) {
    throw new Error(
      `Finder refused to arrange the window: ${arranged.stderr.trim()}\n`
      + 'If this is an Automation permission error (-1743), allow the terminal to control Finder in System Settings > Privacy & Security > Automation.',
    )
  }

  // Finder writes on close, and the write is buffered.
  spawnSync('sync', [], { stdio: 'ignore' })

  const written = path.join(mount, '.DS_Store')
  if (!fs.existsSync(written))
    throw new Error('Finder closed the window without writing a .DS_Store')

  fs.copyFileSync(written, DMG_WINDOW_FIXTURE)
}
finally {
  if (mount) detach(mount)
  fs.rmSync(work, { recursive: true, force: true })
}

// Authoring that produced the wrong geometry is worse than none: it would
// commit a layout nobody checked. Read it back through the same code the build
// and the test use.
const { layout } = requireDmgWindowLayout()
console.log(`[dmg-window] ${DMG_WINDOW_FIXTURE}`)
console.log(`[dmg-window] ${layout.width}x${layout.height}, ${layout.iconSize}pt icons, records: ${layout.records.join(' ')}`)
for (const [name, at] of Object.entries(layout.items))
  console.log(`[dmg-window]   ${name} at ${at.x},${at.y}`)
