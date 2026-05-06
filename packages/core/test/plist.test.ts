import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { parsePlist, parsePlistToObject, readAppInfoPlist } from '../src/plist'
import { makeTmpDir } from './_tmp'

let TMP: string
let cleanupTmp: () => void

const XML_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.example.thing</string>
  <key>Program</key>
  <string>/usr/local/bin/thing</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/thing</string>
    <string>--flag</string>
  </array>
</dict>
</plist>`

const APP_INFO_XML = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>com.example.app</string>
  <key>CFBundleName</key>
  <string>Example App</string>
</dict>
</plist>`

beforeAll(() => {
  const r = makeTmpDir('plist')
  TMP = r.dir
  cleanupTmp = r.cleanup

  fs.writeFileSync(path.join(TMP, 'xml.plist'), XML_PLIST)

  // Build a binary plist via plutil so we can verify the bplist00 path.
  // Skip if plutil isn't available (non-mac CI).
  try {
    fs.writeFileSync(path.join(TMP, 'src.plist'), XML_PLIST)
    execFileSync('plutil', ['-convert', 'binary1', '-o', path.join(TMP, 'binary.plist'), path.join(TMP, 'src.plist')], {
      stdio: ['ignore', 'ignore', 'ignore'],
    })
  }
  catch { /* plutil unavailable */ }

  // Build a fake .app bundle with a binary Info.plist
  const appPath = path.join(TMP, 'Example.app', 'Contents')
  fs.mkdirSync(appPath, { recursive: true })
  try {
    fs.writeFileSync(path.join(appPath, 'Info.plist.xml'), APP_INFO_XML)
    execFileSync('plutil', ['-convert', 'binary1', '-o', path.join(appPath, 'Info.plist'), path.join(appPath, 'Info.plist.xml')], {
      stdio: ['ignore', 'ignore', 'ignore'],
    })
  }
  catch {
    fs.writeFileSync(path.join(appPath, 'Info.plist'), APP_INFO_XML)
  }
})

afterAll(() => {
  cleanupTmp()
})

describe('parsePlist (XML)', () => {
  it('extracts launch-agent fields from an XML plist', () => {
    const r = parsePlist(path.join(TMP, 'xml.plist'))
    expect(r.label).toBe('com.example.thing')
    expect(r.program).toBe('/usr/local/bin/thing')
    expect(r.runAtLoad).toBe(true)
    expect(r.keepAlive).toBe(false)
    expect(r.disabled).toBe(false)
  })
})

describe('parsePlistToObject (XML)', () => {
  it('decodes string, bool, integer, and array values', () => {
    const o = parsePlistToObject(path.join(TMP, 'xml.plist'))
    expect(o.Label).toBe('com.example.thing')
    expect(o.RunAtLoad).toBe(true)
    expect(o.KeepAlive).toBe(false)
    expect(o.ProgramArguments).toEqual(['/usr/local/bin/thing', '--flag'])
  })
})

describe('parsePlist (binary, via plutil)', () => {
  it('reads a binary plist by transparently converting to XML', () => {
    const binPath = path.join(TMP, 'binary.plist')
    if (!fs.existsSync(binPath))
      return // plutil unavailable
    const r = parsePlist(binPath)
    // The whole point of the fix: previously these were all empty strings
    // because the regex parser ran against bplist00 garbage.
    expect(r.label).toBe('com.example.thing')
    expect(r.program).toBe('/usr/local/bin/thing')
    expect(r.runAtLoad).toBe(true)
  })
})

describe('readAppInfoPlist', () => {
  it('reads CFBundleIdentifier from a binary Info.plist', () => {
    const o = readAppInfoPlist(path.join(TMP, 'Example.app'))
    expect(o.CFBundleIdentifier).toBe('com.example.app')
    expect(o.CFBundleName).toBe('Example App')
  })

  it('returns an empty object for a non-existent bundle', () => {
    const o = readAppInfoPlist(path.join(TMP, 'NotARealApp.app'))
    expect(Object.keys(o)).toHaveLength(0)
  })
})
