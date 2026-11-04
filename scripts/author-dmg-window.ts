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
import { DMG_WINDOW, DMG_WINDOW_FIXTURE, requireDmgWindowLayout } from './dmg-window'

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

/** Where the window opens. Only the size is asserted; macOS clamps the origin. */
const SCREEN_ORIGIN = { x: 200, y: 120 }

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

  console.log(`[dmg-window] arranging ${mount}`)

  const { x, y } = SCREEN_ORIGIN
  const right = x + DMG_WINDOW.width
  const bottom = y + DMG_WINDOW.height
  const app = DMG_WINDOW.items['SystemCleaner.app']
  const applications = DMG_WINDOW.items.Applications

  /**
   * Bounds are set *last*, and that ordering is load-bearing. Hiding the
   * toolbar rebuilds the window, so a size set before it is discarded: the
   * first run of this asked for 660x400 and Finder recorded 920x464, its own
   * default, with every other property correct.
   */
  const script = `
on run argv
  set vol to item 1 of argv
  tell application "Finder"
    tell disk vol
      open
      set current view of container window to icon view
      set toolbar visible of container window to false
      set statusbar visible of container window to false
      set opts to the icon view options of container window
      set arrangement of opts to not arranged
      set icon size of opts to ${DMG_WINDOW.iconSize}
      set text size of opts to 12
      set label position of opts to bottom
      set shows item info of opts to false
      set position of item "SystemCleaner.app" of container window to {${app.x}, ${app.y}}
      set position of item "Applications" of container window to {${applications.x}, ${applications.y}}
      delay 1
      set the bounds of container window to {${x}, ${y}, ${right}, ${bottom}}
      delay 1
      update without registering applications
      delay 2
      close
    end tell
  end tell
end run
`

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
