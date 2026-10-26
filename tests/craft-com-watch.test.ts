/**
 * The PE import parser behind `scripts/craft-com-watch.ts`.
 *
 * This parser is the whole of the watcher's judgement: it decides whether a
 * new Craft release calls `CoInitializeEx`, and therefore whether the Windows
 * desktop app is unblocked. Its dangerous failure is silence — a parser that
 * finds nothing reports "not fixed yet" forever, which looks exactly like
 * waiting. The watcher guards the live case by requiring `CoTaskMemFree`,
 * which Craft has always imported; these tests cover the parsing itself
 * against binaries built to be known.
 *
 * Verified against three real binaries when written: the shipped v0.0.142
 * runtime and a from-source build both answer `CoTaskMemFree`, and a build of
 * craft-native/craft#342 answers `CoInitializeEx, CoTaskMemFree` — the same
 * answers an independent parser gave.
 */
import { describe, expect, it } from 'bun:test'
import { importsFrom, verdict } from '../scripts/craft-com-watch'

/**
 * Assemble the smallest PE64 that has an import directory.
 *
 * One section holding the import descriptors, the lookup thunks and the
 * strings, so the virtual-address mapping is exercised rather than bypassed:
 * the section is given a virtual address that differs from its file offset,
 * which is the whole reason the parser has to translate at all.
 */
function buildPe(imports: { dll: string, names: (string | number)[] }[]): Uint8Array {
  const SECTION_RVA = 0x1000
  const SECTION_RAW = 0x400
  const bytes = new Uint8Array(0x2000)
  const view = new DataView(bytes.buffer)

  const peOffset = 0x80
  view.setUint32(0x3C, peOffset, true)
  bytes[peOffset] = 0x50
  bytes[peOffset + 1] = 0x45
  view.setUint16(peOffset + 6, 1, true) // one section
  const optionalSize = 240
  view.setUint16(peOffset + 20, optionalSize, true)
  const optional = peOffset + 24
  view.setUint16(optional, 0x20B, true) // PE32+

  // Lay out the section's contents, tracking both views of every address.
  let cursor = 0
  const area: number[] = []
  const put = (value: number): void => { area.push(value); cursor += 1 }
  const putU32 = (value: number): void => {
    for (let i = 0; i < 4; i += 1) put((value >>> (8 * i)) & 0xFF)
  }
  const putU64 = (value: bigint): void => {
    for (let i = 0; i < 8; i += 1) put(Number((value >> BigInt(8 * i)) & 0xFFn))
  }
  const putString = (text: string): number => {
    const at = cursor
    for (const code of new TextEncoder().encode(text)) put(code)
    put(0)
    return at
  }
  const rvaOf = (offset: number): number => SECTION_RVA + offset

  // Strings first, so the descriptors can point at them.
  const dllNames = imports.map(i => rvaOf(putString(i.dll)))
  const nameRvas = imports.map(i => i.names.map((name) => {
    if (typeof name === 'number')
      return null
    const at = cursor
    put(0)
    put(0) // the two-byte hint the parser skips
    for (const code of new TextEncoder().encode(name)) put(code)
    put(0)
    return rvaOf(at)
  }))

  // Then a lookup table per DLL, null-terminated.
  const thunkRvas = imports.map((entry, i) => {
    while (cursor % 8 !== 0) put(0)
    const at = cursor
    entry.names.forEach((name, j) => {
      if (typeof name === 'number')
        putU64((1n << 63n) | BigInt(name))
      else
        putU64(BigInt(nameRvas[i][j] as number))
    })
    putU64(0n)
    return rvaOf(at)
  })

  // Finally the descriptors, also null-terminated.
  while (cursor % 4 !== 0) put(0)
  const importRva = rvaOf(cursor)
  imports.forEach((_, i) => {
    putU32(thunkRvas[i]) // OriginalFirstThunk
    putU32(0) // TimeDateStamp
    putU32(0) // ForwarderChain
    putU32(dllNames[i]) // Name
    putU32(thunkRvas[i]) // FirstThunk
  })
  for (let i = 0; i < 5; i += 1) putU32(0)

  // Data directory entry 1 is the import table.
  const directories = optional + 112
  view.setUint32(directories + 8, importRva, true)
  view.setUint32(directories + 12, cursor, true)

  // The one section header.
  const section = optional + optionalSize
  view.setUint32(section + 8, area.length, true) // VirtualSize
  view.setUint32(section + 12, SECTION_RVA, true) // VirtualAddress
  view.setUint32(section + 16, area.length, true) // SizeOfRawData
  view.setUint32(section + 20, SECTION_RAW, true) // PointerToRawData

  bytes.set(area, SECTION_RAW)
  return bytes
}

describe('importsFrom', () => {
  it('reads the names imported from a DLL', () => {
    const pe = buildPe([{ dll: 'ole32.dll', names: ['CoTaskMemFree', 'CoInitializeEx'] }])
    expect(importsFrom(pe, 'ole32.dll')).toEqual(['CoInitializeEx', 'CoTaskMemFree'])
  })

  it('answers the question the watcher actually asks', () => {
    const unpatched = buildPe([{ dll: 'ole32.dll', names: ['CoTaskMemFree'] }])
    const patched = buildPe([{ dll: 'ole32.dll', names: ['CoTaskMemFree', 'CoInitializeEx'] }])
    expect(importsFrom(unpatched, 'ole32.dll').includes('CoInitializeEx')).toBe(false)
    expect(importsFrom(patched, 'ole32.dll').includes('CoInitializeEx')).toBe(true)
  })

  it('does not confuse one DLL with another', () => {
    const pe = buildPe([
      { dll: 'KERNEL32.dll', names: ['LoadLibraryW', 'GetProcAddress'] },
      { dll: 'ole32.dll', names: ['CoTaskMemFree'] },
    ])
    expect(importsFrom(pe, 'ole32.dll')).toEqual(['CoTaskMemFree'])
    expect(importsFrom(pe, 'KERNEL32.dll')).toEqual(['GetProcAddress', 'LoadLibraryW'])
  })

  it('matches a DLL name however it is cased', () => {
    // Craft's own table spells it `ole32.dll` and KERNEL32 in capitals, and
    // which case a linker emits is not something to depend on.
    const pe = buildPe([{ dll: 'OLE32.DLL', names: ['CoTaskMemFree'] }])
    expect(importsFrom(pe, 'ole32.dll')).toEqual(['CoTaskMemFree'])
  })

  it('reports an ordinal import rather than hiding it', () => {
    // A symbol imported by ordinal carries no name, so a name search would
    // never see it. Reported as `#13` so the output cannot be mistaken for an
    // empty import list.
    const pe = buildPe([{ dll: 'ole32.dll', names: [13, 'CoTaskMemFree'] }])
    expect(importsFrom(pe, 'ole32.dll')).toEqual(['#13', 'CoTaskMemFree'])
  })

  it('returns nothing for a DLL that is not imported', () => {
    const pe = buildPe([{ dll: 'ole32.dll', names: ['CoTaskMemFree'] }])
    expect(importsFrom(pe, 'user32.dll')).toEqual([])
  })

  it('refuses something that is not a PE', () => {
    const notPe = new Uint8Array(0x400)
    expect(() => importsFrom(notPe, 'ole32.dll')).toThrow(/not a PE/)
  })
})

/**
 * The verdict, which inverted once already.
 *
 * This watcher was built to announce `CoInitializeEx` arriving, and now
 * announces it leaving. No Craft release at or above the floor has dropped it,
 * so CI will never exercise the branch that matters; these do.
 */
describe('verdict', () => {
  const FIXED = ['CoInitializeEx', 'CoTaskMemFree', 'CoUninitialize']
  const BROKEN = ['CoTaskMemFree']

  it('says nothing about a release below the floor, fixed or not', () => {
    // v0.0.164 does not initialise COM and never will. It is also not what
    // this app pins, so it is not news.
    expect(verdict(164, 175, BROKEN)).toBe('below-floor')
    expect(verdict(174, 175, FIXED)).toBe('below-floor')
  })

  it('is quiet while the newest release still initialises COM', () => {
    expect(verdict(247, 175, FIXED)).toBe('initialises-com')
  })

  it('judges the floor release itself', () => {
    // The floor is the version being shipped, so a regression there is the
    // most urgent case of all, not an off-by-one to skip.
    expect(verdict(175, 175, BROKEN)).toBe('regressed')
    expect(verdict(175, 175, FIXED)).toBe('initialises-com')
  })

  it('calls a release at or above the floor without the call a regression', () => {
    expect(verdict(248, 175, BROKEN)).toBe('regressed')
  })

  it('does not accept the control import as the one that matters', () => {
    // The whole diagnosis rested on `CoTaskMemFree` being present while
    // `CoInitializeEx` was absent. If those are ever conflated, this script
    // reports health for exactly the binary that fails.
    expect(verdict(248, 175, ['CoTaskMemFree', 'CoUninitialize'])).toBe('regressed')
  })

  it('reads an ordinal import as absent, because a name search cannot see it', () => {
    // `#13` is what an ordinal import looks like here. Craft imports ole32 by
    // name today; if that changed, the honest answer is that this script can
    // no longer tell, and `regressed` is the answer that gets looked at.
    expect(verdict(248, 175, ['#13', 'CoTaskMemFree'])).toBe('regressed')
  })
})
