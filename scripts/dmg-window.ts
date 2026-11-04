#!/usr/bin/env bun
/* eslint-disable no-console */
/**
 * The Finder window that opens when someone mounts SystemCleaner.dmg.
 *
 * A disk image carries its own window geometry in a `.DS_Store` at the volume
 * root: where the window opens, how big it is, whether it has a toolbar, and
 * the exact pixel each icon sits on. Without one, Finder falls back to whatever
 * the person's last window looked like, and the app and the `/Applications`
 * symlink land wherever the default grid puts them — which reads as "here are
 * two files" rather than "drag this onto that".
 *
 * Only Finder writes that file, and only while a window is open on a
 * *writable* volume. So the layout is authored once by Finder
 * (`scripts/author-dmg-window.ts`) and committed, and the build copies it in.
 * Scripting Finder during the build instead would make every release depend on
 * a GUI session and an Automation grant on a GitHub runner — where a refusal
 * is silent and the only symptom is a badly laid out window that nobody sees
 * until someone downloads it.
 *
 * Position only, no background image, and that is what makes one authored
 * fixture reusable. A background needs a `BKGD` record holding an alias to a
 * file on the volume that authored it, which means nothing on any other
 * volume. The three records this layout does use — `Iloc` for each icon,
 * `bwsp` for the window, `icvp` for the icon view — name nothing outside
 * themselves.
 *
 * Reading it back matters because the failure mode is cosmetic and silent.
 * `hdiutil create -srcfolder` drops a root `.DS_Store` on the floor without a
 * word: staging the file next to the app produces an image with no layout at
 * all, which is exactly how this would have shipped. `build-desktop-app.ts`
 * therefore images a read-write volume, writes the file onto it, converts, and
 * then checks the result still has it.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

/** The committed layout, authored by Finder. Regenerate with `author-dmg-window.ts`. */
export const DMG_WINDOW_FIXTURE: string = path.join(import.meta.dir, '../app/Desktop/dmg-window.DS_Store')

/**
 * What the window is supposed to look like.
 *
 * The icons sit at a quarter and three quarters of a 660pt-wide window, which
 * centres the pair and leaves the gap a drag crosses. 128pt icons because the
 * app icon is the only thing in the window worth looking at.
 */
export const DMG_WINDOW = {
  width: 660,
  height: 460,
  /**
   * The background picture is shorter than the window, and has to be.
   *
   * Finder draws it at the top-left of the *content* area, one pixel per
   * point, and the content area is the window minus its title and status
   * bars — about 400pt of a 460pt window. A 460-tall image loses its bottom
   * line off the end, which is how the footer went missing. Launchpad's DMG
   * ships 660x400 in a 660x460 window for exactly this reason.
   */
  backgroundHeight: 400,
  iconSize: 128,
  arrangeBy: 'none',
  /**
   * 0 is "no background", which is what the committed fallback carries.
   *
   * The shipped image gets 2 — an actual picture — but that cannot be baked
   * into a fixture: Finder stores it as a `backgroundImageAlias` bound to the
   * volume it was authored on, and the alias does not resolve on any other
   * volume. Measured both ways, including against a second volume with an
   * identical name, which still came back with no background. So the build
   * sets the background on the real volume and only falls back to this.
   */
  backgroundType: 0,
  items: {
    'SystemCleaner.app': { x: 165, y: 200 },
    'Applications': { x: 495, y: 200 },
  },
} as const

/** Where the background lives inside the volume, if the build manages to set one. */
export const DMG_BACKGROUND_IN_VOLUME = '.background/installer.png'

/** Where the window opens on screen. Only its size is asserted; macOS clamps the origin. */
const SCREEN_ORIGIN = { x: 200, y: 120 }

/**
 * The AppleScript that arranges a mounted volume's window.
 *
 * Shared, because there are two callers and they must agree: the authoring
 * script bakes the no-background version into the committed fixture, and the
 * build runs the background version against the volume it is about to ship. A
 * drift between them would mean the fallback layout is not the layout.
 *
 * Takes the volume name as `argv`, so a caller never has to quote it into the
 * source. Bounds are set *last*, and that ordering is load-bearing: hiding the
 * toolbar rebuilds the window, so a size set before it is silently discarded —
 * the first run of this asked for 660x400 and Finder recorded 920x464, its own
 * default, with every other property correct.
 */
export function finderLayoutScript(options: { background?: boolean } = {}): string {
  const { x, y } = SCREEN_ORIGIN
  const app = DMG_WINDOW.items['SystemCleaner.app']
  const applications = DMG_WINDOW.items.Applications
  // `.background:installer.png` is a colon path relative to the disk, which is
  // how AppleScript addresses a file inside the volume being told to open.
  //
  // The folder holding it is parked below the window's bottom edge, which is
  // what Launchpad's DMG does too. Dot-directories are invisible to most
  // people, but anyone who has turned on hidden files -- and plenty of
  // developers have -- otherwise gets two blue folders sitting on top of the
  // headline. Giving it a position outside the visible area costs nothing and
  // puts it out of view either way.
  const background = options.background
    ? `      set background picture of opts to file "${DMG_BACKGROUND_IN_VOLUME.replace('/', ':')}"\n`
    : ''

  return `on run argv
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
${background}      try
        set position of item ".background" of container window to {${DMG_WINDOW.width - 160}, ${DMG_WINDOW.height + 140}}
      end try
${background ? '' : ''}      set position of item "SystemCleaner.app" of container window to {${app.x}, ${app.y}}
      set position of item "Applications" of container window to {${applications.x}, ${applications.y}}
      delay 1
      set the bounds of container window to {${x}, ${y}, ${x + DMG_WINDOW.width}, ${y + DMG_WINDOW.height}}
      delay 1
      update without registering applications
      delay 2
      close
    end tell
  end tell
end run
`
}

export interface DmgWindowLayout {
  /** Window size in points. */
  width: number
  height: number
  /** Screen origin, bottom-left as Cocoa records it. Clamped by macOS on a smaller display. */
  origin: { x: number, y: number }
  iconSize: number
  arrangeBy: string
  backgroundType: number
  labelOnBottom: boolean
  showItemInfo: boolean
  /** Icon position per item name. */
  items: Record<string, { x: number, y: number }>
  /** Every record type found, so a test can assert what is *absent*. */
  records: string[]
}

const DS_STORE_MAGIC = [0x00, 0x00, 0x00, 0x01, 0x42, 0x75, 0x64, 0x31]

/**
 * The record types worth recognising: the three this layout writes, plus the
 * two that would mean someone added a background image and made the fixture
 * volume-specific.
 */
const KNOWN_RECORDS = new Set(['Iloc', 'bwsp', 'icvp', 'vSrn', 'vstl', 'BKGD', 'pict', 'fwi0'])

function u32(bytes: Uint8Array, at: number): number {
  return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0
}

function ascii(bytes: Uint8Array, at: number, length: number): string {
  let out = ''
  for (let i = 0; i < length; i++) out += String.fromCharCode(bytes[at + i])
  return out
}

function utf16be(bytes: Uint8Array, at: number, units: number): string {
  let out = ''
  for (let i = 0; i < units; i++) out += String.fromCharCode((bytes[at + i * 2] << 8) | bytes[at + i * 2 + 1])
  return out
}

interface DsRecord {
  name: string
  id: string
  type: string
  payload: Uint8Array
}

/**
 * Every record in a `.DS_Store`, found by scanning for known structure ids.
 *
 * Deliberately a scan and not a parse. The file is a B-tree inside Apple's
 * buddy allocator, and walking it properly means the allocator header, the
 * block address table, the free lists and the node blocks — a few hundred
 * lines to read a file this repository *writes with Finder and commits*. The
 * risks here are a corrupted fixture, a renamed app leaving the icon positions
 * keyed to a name that no longer exists, and someone re-authoring it with the
 * wrong geometry. A scan catches all three.
 *
 * What keeps it honest is that a candidate is only accepted when the length
 * prefix, the name, the structure type and the payload length all agree, so
 * four bytes that happen to spell `Iloc` inside some other record's payload
 * are rejected rather than believed.
 */
export function readRecords(bytes: Uint8Array): DsRecord[] {
  for (const [index, byte] of DS_STORE_MAGIC.entries()) {
    if (bytes[index] !== byte)
      throw new Error('not a .DS_Store: the file does not start with \\0\\0\\0\\x01Bud1')
  }

  const found: DsRecord[] = []

  for (let at = 12; at + 12 <= bytes.length; at++) {
    const id = ascii(bytes, at, 4)
    if (!KNOWN_RECORDS.has(id)) continue

    // The name is UTF-16BE immediately before the id, behind its own
    // code-unit count. Walk back until a count matches the distance exactly.
    let name: string | null = null
    for (let units = 1; units <= 64; units++) {
      const nameAt = at - units * 2
      if (nameAt - 4 < 8) break
      if (u32(bytes, nameAt - 4) !== units) continue
      const candidate = utf16be(bytes, nameAt, units)
      // Printable only: the alternative is a coincidence, not a name.
      if (!/^[ -~]+$/.test(candidate)) continue
      name = candidate
      break
    }
    if (name === null) continue

    const type = ascii(bytes, at + 4, 4)
    let payload: Uint8Array
    switch (type) {
      case 'blob':
      case 'ustr': {
        const length = u32(bytes, at + 8)
        if (length > bytes.length - (at + 12)) continue
        payload = bytes.subarray(at + 12, at + 12 + length)
        break
      }
      case 'bool':
        payload = bytes.subarray(at + 8, at + 9)
        break
      case 'long':
      case 'shor':
      case 'type':
        payload = bytes.subarray(at + 8, at + 12)
        break
      case 'comp':
      case 'dutc':
        payload = bytes.subarray(at + 8, at + 16)
        break
      default:
        // Not a record: the four bytes after the id are not a structure type.
        continue
    }

    found.push({ name, id, type, payload })
  }

  return found
}

/**
 * A binary property list, enough of one.
 *
 * `bwsp` and `icvp` hold `bplist00` blobs, and the obvious way to read them is
 * `plutil -convert json`. That would tie this to macOS, and the test suite runs
 * on Ubuntu and Windows too — where a skipped test is how a broken fixture
 * would travel. Dicts, arrays, integers, reals, booleans and strings are all
 * these two records contain.
 */
export function readBinaryPlist(bytes: Uint8Array): unknown {
  if (ascii(bytes, 0, 8) !== 'bplist00')
    throw new Error('not a binary property list')

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const trailer = bytes.length - 32
  const offsetIntSize = bytes[trailer + 6]
  const objectRefSize = bytes[trailer + 7]
  const objectCount = Number(view.getBigUint64(trailer + 8))
  const topObject = Number(view.getBigUint64(trailer + 16))
  const offsetTable = Number(view.getBigUint64(trailer + 24))

  const uint = (at: number, size: number): number => {
    let value = 0
    for (let i = 0; i < size; i++) value = value * 256 + bytes[at + i]
    return value
  }

  const offsets: number[] = []
  for (let i = 0; i < objectCount; i++)
    offsets.push(uint(offsetTable + i * offsetIntSize, offsetIntSize))

  /** A count that is 0xF in the marker's low nibble is an integer that follows it. */
  const countAt = (info: number, at: number): [number, number] => {
    if (info !== 0x0F) return [info, at]
    const size = 1 << (bytes[at] & 0x0F)
    return [uint(at + 1, size), at + 1 + size]
  }

  const object = (index: number): unknown => {
    let at = offsets[index]
    const marker = bytes[at]
    at += 1
    const kind = marker >> 4
    const info = marker & 0x0F

    switch (kind) {
      case 0x0:
        if (info === 0x08) return false
        if (info === 0x09) return true
        return null
      case 0x1:
        return uint(at, 1 << info)
      case 0x2:
        return (1 << info) === 4 ? view.getFloat32(at) : view.getFloat64(at)
      case 0x5: {
        const [length, start] = countAt(info, at)
        return ascii(bytes, start, length)
      }
      case 0x6: {
        const [length, start] = countAt(info, at)
        return utf16be(bytes, start, length)
      }
      case 0xA: {
        const [length, start] = countAt(info, at)
        const items: unknown[] = []
        for (let i = 0; i < length; i++)
          items.push(object(uint(start + i * objectRefSize, objectRefSize)))
        return items
      }
      case 0xD: {
        const [length, start] = countAt(info, at)
        const entries: Record<string, unknown> = {}
        for (let i = 0; i < length; i++) {
          const key = object(uint(start + i * objectRefSize, objectRefSize))
          const value = object(uint(start + (length + i) * objectRefSize, objectRefSize))
          entries[String(key)] = value
        }
        return entries
      }
      default:
        // Data, dates and sets: nothing in these two records uses them.
        return null
    }
  }

  return object(topObject)
}

/** `{{200, 462}, {660, 400}}`, the way Finder writes a window rect. */
function parseWindowBounds(bounds: string): { origin: { x: number, y: number }, width: number, height: number } {
  const match = bounds.match(/^\{\{(-?\d+), (-?\d+)\}, \{(\d+), (\d+)\}\}$/)
  if (!match)
    throw new Error(`the window record holds bounds this cannot read: ${bounds}`)
  return {
    origin: { x: Number(match[1]), y: Number(match[2]) },
    width: Number(match[3]),
    height: Number(match[4]),
  }
}

export function readDmgWindowLayout(bytes: Uint8Array): DmgWindowLayout {
  const records = readRecords(bytes)

  const window = records.find(record => record.id === 'bwsp')
  if (!window)
    throw new Error('no `bwsp` record: the layout carries no window size or position')
  const view = records.find(record => record.id === 'icvp')
  if (!view)
    throw new Error('no `icvp` record: the layout carries no icon view settings')

  const windowPlist = readBinaryPlist(window.payload) as Record<string, unknown>
  const viewPlist = readBinaryPlist(view.payload) as Record<string, unknown>

  const bounds = parseWindowBounds(String(windowPlist.WindowBounds ?? ''))

  const items: Record<string, { x: number, y: number }> = {}
  for (const record of records) {
    if (record.id !== 'Iloc') continue
    if (record.payload.length < 8)
      throw new Error(`the icon position for ${record.name} is ${record.payload.length} bytes, not 16`)
    items[record.name] = { x: u32(record.payload, 0), y: u32(record.payload, 4) }
  }

  return {
    width: bounds.width,
    height: bounds.height,
    origin: bounds.origin,
    iconSize: Number(viewPlist.iconSize ?? 0),
    arrangeBy: String(viewPlist.arrangeBy ?? ''),
    backgroundType: Number(viewPlist.backgroundType ?? -1),
    labelOnBottom: viewPlist.labelOnBottom === true,
    showItemInfo: viewPlist.showItemInfo === true,
    items,
    records: [...new Set(records.map(record => record.id))].sort(),
  }
}

/**
 * The fixture, checked against {@link DMG_WINDOW}, or a thrown explanation.
 *
 * The build calls this before it spends five minutes compiling, so a fixture
 * that went missing or was re-authored against a renamed app says so up front
 * rather than producing an image whose window is quietly wrong.
 */
export function requireDmgWindowLayout(file: string = DMG_WINDOW_FIXTURE): { bytes: Uint8Array, layout: DmgWindowLayout } {
  if (!fs.existsSync(file))
    throw new Error(`the DMG window layout is missing: ${file}\nRegenerate it with \`bun scripts/author-dmg-window.ts\`.`)

  const bytes = new Uint8Array(fs.readFileSync(file))
  const layout = readDmgWindowLayout(bytes)

  const wrong: string[] = []
  if (layout.width !== DMG_WINDOW.width || layout.height !== DMG_WINDOW.height)
    wrong.push(`window is ${layout.width}x${layout.height}, expected ${DMG_WINDOW.width}x${DMG_WINDOW.height}`)
  if (layout.iconSize !== DMG_WINDOW.iconSize)
    wrong.push(`icon size is ${layout.iconSize}, expected ${DMG_WINDOW.iconSize}`)
  if (layout.arrangeBy !== DMG_WINDOW.arrangeBy)
    wrong.push(`icons are arranged by ${layout.arrangeBy}, which overrides their positions`)
  if (layout.backgroundType !== DMG_WINDOW.backgroundType)
    wrong.push(`backgroundType is ${layout.backgroundType}, expected ${DMG_WINDOW.backgroundType} — a background image makes the layout volume-specific`)

  for (const [name, expected] of Object.entries(DMG_WINDOW.items)) {
    const actual = layout.items[name]
    if (!actual) {
      wrong.push(`no icon position for ${name} — the layout was authored against different filenames`)
      continue
    }
    if (actual.x !== expected.x || actual.y !== expected.y)
      wrong.push(`${name} sits at ${actual.x},${actual.y}, expected ${expected.x},${expected.y}`)
  }

  if (wrong.length > 0)
    throw new Error(`${file} does not describe the intended window:\n  ${wrong.join('\n  ')}`)

  return { bytes, layout }
}

// Only when run, never when imported: `bun scripts/dmg-window.ts` prints what
// the committed fixture says, which is the quickest way to see it.
if (import.meta.main) {
  const { layout } = requireDmgWindowLayout()
  console.log(JSON.stringify(layout, null, 2))
}
