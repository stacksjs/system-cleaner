#!/usr/bin/env bun
/* eslint-disable no-console */
/**
 * Render `resources/dmg/installer-background.svg` to the PNG the DMG carries.
 *
 *     bun scripts/render-dmg-background.ts
 *
 * Both files are committed: the SVG is the editable source, the PNG is what
 * ships, and this turns one into the other on a Mac. The PNG is committed
 * rather than rendered during the build so a release never depends on
 * QuickLook being willing to rasterise an SVG on a runner.
 *
 * Finder draws a background image at its natural size, one pixel per point, so
 * the PNG has to be exactly the window's 660x460 or the window shows a corner
 * of it. It is rendered at 2x and then resampled down, which is just free
 * antialiasing — the file that ships is an ordinary 72dpi image, the same
 * shape Launchpad's DMG uses.
 *
 * The squared viewBox is the awkward part. `qlmanage` only renders into a
 * square thumbnail, and `sips` only crops from the centre — `--cropOffset` is
 * accepted and then ignored, in either flag order, which cost an afternoon.
 * Shifting the viewBox up by half the leftover height puts the artwork dead
 * centre of the square, which is precisely what a centre crop then recovers.
 */

import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import process from 'node:process'
import { DMG_WINDOW } from './dmg-window'

if (process.platform !== 'darwin') {
  console.error('[dmg-background] needs qlmanage and sips, so only macOS can run it')
  process.exit(1)
}

export const DMG_BACKGROUND_SVG: string = path.join(import.meta.dir, '../resources/dmg/installer-background.svg')
export const DMG_BACKGROUND_PNG: string = path.join(import.meta.dir, '../resources/dmg/installer-background.png')

/** Rendered at this multiple and resampled down, purely for the antialiasing. */
const SUPERSAMPLE = 2

function run(command: string, args: string[]): void {
  const done = spawnSync(command, args, { stdio: ['ignore', 'ignore', 'pipe'] })
  if (done.status !== 0)
    throw new Error(`${command} ${args.join(' ')} failed: ${done.stderr?.toString().trim()}`)
}

const { width, backgroundHeight: height } = DMG_WINDOW
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dmg-background-'))

try {
  const source = fs.readFileSync(DMG_BACKGROUND_SVG, 'utf8')
  const expected = `width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"`
  if (!source.includes(expected))
    throw new Error(`${DMG_BACKGROUND_SVG} must declare ${expected} to match the window`)

  // Centre the artwork in a square canvas; see the note above.
  const offset = (width - height) / 2
  const squared = source.replace(
    expected,
    `width="${width}" height="${width}" viewBox="0 ${-offset} ${width} ${width}"`,
  )
  const squaredFile = path.join(work, 'squared.svg')
  fs.writeFileSync(squaredFile, squared)

  const side = width * SUPERSAMPLE
  run('qlmanage', ['-t', '-s', String(side), '-o', work, squaredFile])
  const thumbnail = path.join(work, 'squared.svg.png')
  if (!fs.existsSync(thumbnail))
    throw new Error('qlmanage rendered no thumbnail; QuickLook cannot read the SVG')

  const cropped = path.join(work, 'cropped.png')
  run('sips', ['-c', String(height * SUPERSAMPLE), String(width * SUPERSAMPLE), thumbnail, '--out', cropped])
  run('sips', ['-z', String(height), String(width), cropped, '--out', DMG_BACKGROUND_PNG])

  const measured = spawnSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', DMG_BACKGROUND_PNG], { encoding: 'utf8' })
  const w = Number(measured.stdout.match(/pixelWidth: (\d+)/)?.[1])
  const h = Number(measured.stdout.match(/pixelHeight: (\d+)/)?.[1])
  if (w !== width || h !== height)
    throw new Error(`rendered ${w}x${h}, but the window is ${width}x${height} and Finder will show a corner of it`)

  console.log(`[dmg-background] ${DMG_BACKGROUND_PNG} (${w}x${h})`)
}
finally {
  fs.rmSync(work, { recursive: true, force: true })
}
