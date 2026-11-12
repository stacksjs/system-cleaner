#!/usr/bin/env bun
/* eslint-disable no-console */
/** Shared installer geometry and a reader for validating create-dmg's output. */

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
  items: {
    'SystemCleaner.app': { x: 165, y: 200 },
    'Applications': { x: 495, y: 200 },
  },
} as const

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
