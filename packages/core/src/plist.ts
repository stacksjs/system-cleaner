import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { PlistEntry } from './types'
import { safeReadFile } from './paths'

// macOS app bundles ship binary plists (`bplist00…`) almost universally; the
// previous regex parser silently returned empty strings for every binary
// file and a hidden cascade of empty bundle IDs broke orphan detection and
// app discovery. Detect the binary magic and shell out to
// `plutil -convert xml1` once, then parse the XML the same way as before.
const BPLIST_MAGIC = Buffer.from('bplist00', 'ascii')

function readPlistAsXml(filepath: string): string {
  // Sniff the first 8 bytes to avoid spawning plutil for files that are
  // already XML. Fall back to an empty string on any read error so callers
  // stay simple — every getter handles "" gracefully.
  let isBinary = false
  try {
    const fd = fs.openSync(filepath, 'r')
    try {
      const head = Buffer.alloc(8)
      fs.readSync(fd, head, 0, 8, 0)
      isBinary = head.equals(BPLIST_MAGIC)
    }
    finally {
      fs.closeSync(fd)
    }
  }
  catch {
    return ''
  }

  if (!isBinary)
    return safeReadFile(filepath)

  try {
    // execFile (not exec) — no shell, no quoting risk; filepath is passed
    // as an argv element so spaces/quotes in the path are handled by the OS.
    return execFileSync('plutil', ['-convert', 'xml1', '-o', '-', filepath], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  }
  catch {
    return ''
  }
}

/**
 * Parse a macOS plist (XML or binary) and extract launch-agent fields.
 */
export function parsePlist(filepath: string): PlistEntry {
  const content = readPlistAsXml(filepath)

  const getStringField = (key: string): string => {
    const match = content.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`))
    return match ? match[1] : ''
  }

  const getBoolField = (key: string): boolean => {
    const keyTag = `<key>${key}</key>`
    const keyIdx = content.indexOf(keyTag)
    if (keyIdx === -1)
      return false
    const after = content.substring(keyIdx + keyTag.length, keyIdx + keyTag.length + 50)
    return /\s*<true[\s/>]/.test(after)
  }

  const getArrayField = (key: string): string[] => {
    const keyPattern = `<key>${key}</key>`
    const keyIdx = content.indexOf(keyPattern)
    if (keyIdx === -1)
      return []
    const afterKey = content.substring(keyIdx + keyPattern.length)
    const arrayMatch = afterKey.match(/\s*<array>([\s\S]*?)<\/array>/)
    if (!arrayMatch)
      return []
    const strings: string[] = []
    const stringPattern = /<string>([^<]*)<\/string>/g
    let m: RegExpExecArray | null
    while ((m = stringPattern.exec(arrayMatch[1])) !== null) {
      strings.push(m[1])
    }
    return strings
  }

  const label = getStringField('Label') || path.basename(filepath, '.plist')
  const program = getStringField('Program') || getArrayField('ProgramArguments')[0] || ''
  const runAtLoad = getBoolField('RunAtLoad')
  const keepAlive = getBoolField('KeepAlive')
  const disabled = getBoolField('Disabled')

  return { label, program, runAtLoad, keepAlive, disabled, filepath }
}

/**
 * Parse a plist (XML or binary) to a generic key-value object.
 */
export function parsePlistToObject(filepath: string): Record<string, string | boolean | string[]> {
  const content = readPlistAsXml(filepath)
  const result: Record<string, string | boolean | string[]> = {}

  const keyPattern = /<key>([^<]+)<\/key>/g
  let match: RegExpExecArray | null

  while ((match = keyPattern.exec(content)) !== null) {
    const key = match[1]
    const afterKey = content.substring(match.index + match[0].length).trim()

    if (afterKey.startsWith('<string>')) {
      const valMatch = afterKey.match(/<string>([^<]*)<\/string>/)
      if (valMatch)
        result[key] = valMatch[1]
    }
    else if (afterKey.startsWith('<integer>')) {
      const intMatch = afterKey.match(/<integer>(\d+)<\/integer>/)
      if (intMatch)
        result[key] = intMatch[1]
    }
    else if (afterKey.startsWith('<true')) {
      result[key] = true
    }
    else if (afterKey.startsWith('<false')) {
      result[key] = false
    }
    else if (afterKey.startsWith('<array>')) {
      const arrayMatch = afterKey.match(/<array>([\s\S]*?)<\/array>/)
      if (arrayMatch) {
        const strings: string[] = []
        const strPattern = /<string>([^<]*)<\/string>/g
        let m: RegExpExecArray | null
        while ((m = strPattern.exec(arrayMatch[1])) !== null) {
          strings.push(m[1])
        }
        result[key] = strings
      }
    }
  }

  return result
}

/**
 * Read an app bundle's Info.plist (handles binary plists transparently).
 */
export function readAppInfoPlist(appPath: string): Record<string, string | boolean | string[]> {
  const plistPath = path.join(appPath, 'Contents', 'Info.plist')
  return parsePlistToObject(plistPath)
}
