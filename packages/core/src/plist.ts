import type { PlistEntry } from './types'
import { safeReadFile } from './paths'
import * as path from 'node:path'

/**
 * Parse a macOS plist XML file and extract common fields
 */
export function parsePlist(filepath: string): PlistEntry {
  const content = safeReadFile(filepath)

  const getStringField = (key: string): string => {
    const match = content.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`))
    return match ? match[1] : ''
  }

  const getBoolField = (key: string): boolean => {
    const keyIdx = content.indexOf(`<key>${key}</key>`)
    if (keyIdx === -1)
      return false
    const after = content.substring(keyIdx + `<key>${key}</key>`.length, keyIdx + `<key>${key}</key>`.length + 50)
    // Match <true/>, <true />, or <true></true>
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
 * Parse plist to a generic key-value object
 */
export function parsePlistToObject(filepath: string): Record<string, string | boolean | string[]> {
  const content = safeReadFile(filepath)
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
 * Read an app bundle's Info.plist
 */
export function readAppInfoPlist(appPath: string): Record<string, string | boolean | string[]> {
  const plistPath = path.join(appPath, 'Contents', 'Info.plist')
  return parsePlistToObject(plistPath)
}
