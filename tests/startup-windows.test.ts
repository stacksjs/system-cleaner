import { describe, expect, it } from 'bun:test'
import { parseRegQuery, parseStartupApproved, programFromCommand, WINDOWS_RUN_KEYS } from '../packages/uninstall/src/startup-windows'

/**
 * Reading what Windows starts at logon.
 *
 * Driven from captured `reg.exe query` output, because the machine that can
 * run the command is not the one this was written on — so everything that
 * interprets it is a pure function.
 *
 * See stacksjs/system-cleaner#23.
 */

// Real `reg query HKCU\...\Run` shape. Note the quoted path with spaces and
// trailing arguments, the unquoted path, the value name containing a space,
// and a REG_EXPAND_SZ alongside the REG_SZ entries.
const RUN_KEY = String.raw`
HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run
    OneDrive    REG_SZ    "C:\Users\glenn\AppData\Local\Microsoft\OneDrive\OneDrive.exe" /background
    Spotify    REG_SZ    C:\Users\glenn\AppData\Roaming\Spotify\Spotify.exe
    Adobe Updater    REG_SZ    "C:\Program Files (x86)\Common Files\Adobe\Updater\Update.exe" -silent
    MyTool    REG_EXPAND_SZ    %USERPROFILE%\tools\mytool.exe
`

// `StartupApproved\Run`: an even first byte is enabled, an odd one disabled.
const APPROVED = String.raw`
HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run
    OneDrive    REG_BINARY    020000000000000000000000
    Spotify    REG_BINARY    030000000000000000000000
    Adobe Updater    REG_BINARY    06000000A1B2C3D400000000
`

describe('parsing reg query output', () => {
  it('reads every value, ignoring the key line', () => {
    const values = parseRegQuery(RUN_KEY)
    expect(values).toHaveLength(4)
    expect(values.map(v => v.name)).toEqual(['OneDrive', 'Spotify', 'Adobe Updater', 'MyTool'])
  })

  /**
   * A Run value is a command line, not a path. Splitting on whitespace from
   * the left would cut `C:\Program Files (x86)\...` into pieces and lose the
   * arguments.
   */
  it('keeps a value containing spaces and arguments intact', () => {
    const adobe = parseRegQuery(RUN_KEY).find(v => v.name === 'Adobe Updater')!
    expect(adobe.value).toBe('"C:\\Program Files (x86)\\Common Files\\Adobe\\Updater\\Update.exe" -silent')
  })

  /** A value *name* may contain spaces too, so the type token locates the split. */
  it('reads a value name containing a space', () => {
    expect(parseRegQuery(RUN_KEY).some(v => v.name === 'Adobe Updater')).toBe(true)
  })

  it('keeps the value type, so an expandable string is recognisable', () => {
    expect(parseRegQuery(RUN_KEY).find(v => v.name === 'MyTool')!.type).toBe('REG_EXPAND_SZ')
  })

  it('returns nothing for empty or unrelated output', () => {
    expect(parseRegQuery('')).toEqual([])
    expect(parseRegQuery('ERROR: The system was unable to find the specified registry key')).toEqual([])
  })
})

describe('which entries are switched off', () => {
  /**
   * The Run key alone says nothing about this. Windows 8 and later keep the
   * enabled flag in a parallel key, which is how Task Manager disables
   * something without deleting it — and reading the Run key alone would report
   * every disabled item as enabled.
   */
  it('reads the flag from the first byte', () => {
    const approved = parseStartupApproved(APPROVED)
    expect(approved.get('OneDrive')).toBe(false)
    expect(approved.get('Spotify')).toBe(true)
  })

  it('treats any even first byte as enabled', () => {
    // 0x06 appears on entries Task Manager has touched.
    expect(parseStartupApproved(APPROVED).get('Adobe Updater')).toBe(false)
  })

  it('says nothing about an entry with no approval record', () => {
    // A Run value with no record runs, and the caller defaults accordingly.
    expect(parseStartupApproved(APPROVED).has('MyTool')).toBe(false)
  })

  it('ignores anything that is not a binary value', () => {
    expect(parseStartupApproved(RUN_KEY).size).toBe(0)
  })
})

describe('finding the program in a command line', () => {
  it('unwraps a quoted path and drops the arguments', () => {
    expect(programFromCommand('"C:\\Program Files\\App\\app.exe" --silent -x'))
      .toBe('C:\\Program Files\\App\\app.exe')
  })

  it('takes an unquoted path up to the first space', () => {
    expect(programFromCommand('C:\\Tools\\tool.exe /background')).toBe('C:\\Tools\\tool.exe')
  })

  it('returns the whole thing when there are no arguments', () => {
    expect(programFromCommand('C:\\Tools\\tool.exe')).toBe('C:\\Tools\\tool.exe')
  })
})

describe('the registry locations', () => {
  /**
   * A 32-bit installer on a 64-bit machine writes under WOW6432Node, and
   * reading only the native view misses it entirely.
   */
  it('covers both views of the machine-wide key', () => {
    const keys = WINDOWS_RUN_KEYS.map(k => k.key)
    expect(keys.some(k => k.includes('WOW6432Node'))).toBe(true)
    expect(keys.some(k => k.startsWith('HKCU'))).toBe(true)
    expect(keys.some(k => k.startsWith('HKLM') && !k.includes('WOW6432Node'))).toBe(true)
  })

  it('pairs every run key with the approval key that describes it', () => {
    for (const run of WINDOWS_RUN_KEYS) {
      expect(run.approvalKey, `${run.key} has no approval key`).toContain('StartupApproved')
      // The 32-bit view has its own approval list.
      if (run.key.includes('WOW6432Node'))
        expect(run.approvalKey).toMatch(/Run32$/)
    }
  })

  it('marks machine-wide keys as system scope', () => {
    for (const run of WINDOWS_RUN_KEYS)
      expect(run.scope).toBe(run.key.startsWith('HKLM') ? 'system' : 'user')
  })
})
