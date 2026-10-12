import { describe, expect, it } from 'bun:test'
import { parseDword, parseRegTree, splitCommand, toAppInfo, toInstalledPrograms, UNINSTALL_KEYS } from '../packages/uninstall/src/apps-windows'

/**
 * Installed programs on Windows.
 *
 * Driven from captured `reg.exe query ... /s` output, because the machine that
 * can run it is not the one this was written on.
 *
 * The thing worth keeping in mind while reading these: this key is not a list
 * of programs. It is a list of registry entries, most of which are programs
 * and a sizeable minority of which are update records, plumbing a vendor
 * marked `SystemComponent`, and the same install registered twice in two
 * hives. A naive read shows a user four hundred entries and invites them to
 * uninstall a patch.
 *
 * See stacksjs/system-cleaner#23.
 */

const TREE = String.raw`
HKEY_LOCAL_MACHINE\Software\Microsoft\Windows\CurrentVersion\Uninstall\{0A1B-REAL}
    DisplayName    REG_SZ    Example Editor
    DisplayVersion    REG_SZ    4.2.1
    Publisher    REG_SZ    Example Corp
    InstallLocation    REG_SZ    C:\Program Files\Example Editor
    EstimatedSize    REG_DWORD    0x7a120
    UninstallString    REG_SZ    "C:\Program Files\Example Editor\unins000.exe" /SILENT

HKEY_LOCAL_MACHINE\Software\Microsoft\Windows\CurrentVersion\Uninstall\{0A1B-MSI}
    DisplayName    REG_SZ    Example Suite
    DisplayVersion    REG_SZ    1.0.0
    Publisher    REG_SZ    Example Corp
    EstimatedSize    REG_DWORD    0x3e8
    UninstallString    REG_SZ    MsiExec.exe /X{0A1B-MSI}
    QuietUninstallString    REG_SZ    MsiExec.exe /X{0A1B-MSI} /qn

HKEY_LOCAL_MACHINE\Software\Microsoft\Windows\CurrentVersion\Uninstall\KB5034441
    DisplayName    REG_SZ    Security Update for Windows (KB5034441)
    UninstallString    REG_SZ    C:\Windows\System32\wusa.exe /uninstall /kb:5034441

HKEY_LOCAL_MACHINE\Software\Microsoft\Windows\CurrentVersion\Uninstall\{PLUMBING}
    DisplayName    REG_SZ    Example Runtime Support
    SystemComponent    REG_DWORD    0x1
    UninstallString    REG_SZ    MsiExec.exe /X{PLUMBING}

HKEY_LOCAL_MACHINE\Software\Microsoft\Windows\CurrentVersion\Uninstall\{PATCH}
    DisplayName    REG_SZ    Example Editor Language Pack
    ParentDisplayName    REG_SZ    Example Editor
    UninstallString    REG_SZ    MsiExec.exe /X{PATCH}

HKEY_LOCAL_MACHINE\Software\Microsoft\Windows\CurrentVersion\Uninstall\{NO-NAME}
    UninstallString    REG_SZ    MsiExec.exe /X{NO-NAME}
`

describe('reading the uninstall tree', () => {
  it('splits a /s walk into one block per key', () => {
    const blocks = parseRegTree(TREE)
    expect(blocks).toHaveLength(6)
    expect(blocks[0].key).toContain('{0A1B-REAL}')
    expect(blocks[0].values.get('DisplayName')).toBe('Example Editor')
  })

  it('keeps a value containing spaces whole', () => {
    const blocks = parseRegTree(TREE)
    expect(blocks[0].values.get('InstallLocation')).toBe('C:\\Program Files\\Example Editor')
    expect(blocks[0].values.get('UninstallString'))
      .toBe('"C:\\Program Files\\Example Editor\\unins000.exe" /SILENT')
  })

  it('reads a DWORD out of its hex form', () => {
    expect(parseDword('0x7a120')).toBe(500000)
    expect(parseDword('0x3e8')).toBe(1000)
    expect(parseDword('')).toBe(0)
    expect(parseDword('nonsense')).toBe(0)
  })
})

describe('deciding what is actually a program', () => {
  const programs = toInstalledPrograms(parseRegTree(TREE))
  const names = programs.map(p => p.name)

  it('keeps the real ones', () => {
    expect(names).toContain('Example Editor')
    expect(names).toContain('Example Suite')
  })

  it('drops an entry with no display name', () => {
    // An installer leftover. Apps & features does not show these either.
    expect(programs.some(p => p.key.includes('NO-NAME'))).toBe(false)
  })

  it('drops what the vendor flagged as plumbing', () => {
    // `SystemComponent` is set precisely so it stays out of this list.
    expect(names).not.toContain('Example Runtime Support')
  })

  it('drops updates and things parented to another program', () => {
    expect(names.some(n => n.includes('KB5034441'))).toBe(false)
    expect(names).not.toContain('Example Editor Language Pack')
  })

  it('reads size, publisher and version', () => {
    const editor = programs.find(p => p.name === 'Example Editor')!
    expect(editor.estimatedSizeKB).toBe(500000)
    expect(editor.publisher).toBe('Example Corp')
    expect(editor.version).toBe('4.2.1')
  })

  /**
   * The same install is often registered per-machine and per-user. Listing it
   * twice invites somebody to uninstall it twice, and the second attempt fails
   * confusingly.
   */
  it('collapses the same program registered in two hives', () => {
    const duplicated = parseRegTree(`${TREE}
HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{0A1B-REAL}
    DisplayName    REG_SZ    Example Editor
    DisplayVersion    REG_SZ    4.2.1
    UninstallString    REG_SZ    "C:\\Program Files\\Example Editor\\unins000.exe" /SILENT
`)
    expect(toInstalledPrograms(duplicated).filter(p => p.name === 'Example Editor')).toHaveLength(1)
  })
})

describe('the shape the rest of the app gets', () => {
  const editor = toInstalledPrograms(parseRegTree(TREE)).find(p => p.name === 'Example Editor')!
  const info = toAppInfo(editor)

  it('identifies a program by its registry key, not a directory', () => {
    // `InstallLocation` is frequently blank and occasionally wrong; the key is
    // what any later action has to be given.
    expect(info.path).toContain('{0A1B-REAL}')
    expect(info.bundleId).toBe(info.path)
  })

  it('converts the estimated size to bytes', () => {
    expect(info.sizeBytes).toBe(500000 * 1024)
  })
})

describe('splitting a registered uninstall command', () => {
  /**
   * These are command lines, not paths. Passing the whole string as one
   * argument looks for a file with the switches in its name; splitting on
   * spaces cuts `C:\Program Files\...` in half.
   */
  it('unwraps a quoted program and keeps its switches', () => {
    const split = splitCommand('"C:\\Program Files\\Example Editor\\unins000.exe" /SILENT /NORESTART')!
    expect(split.program).toBe('C:\\Program Files\\Example Editor\\unins000.exe')
    expect(split.args).toEqual(['/SILENT', '/NORESTART'])
  })

  it('handles the msiexec form, which is unquoted', () => {
    const split = splitCommand('MsiExec.exe /X{0A1B-MSI}')!
    expect(split.program).toBe('MsiExec.exe')
    expect(split.args).toEqual(['/X{0A1B-MSI}'])
  })

  it('keeps a quoted argument together', () => {
    const split = splitCommand('setup.exe /log "C:\\Temp\\my log.txt"')!
    expect(split.args).toEqual(['/log', 'C:\\Temp\\my log.txt'])
  })

  it('refuses something it cannot read rather than guessing', () => {
    expect(splitCommand('')).toBeNull()
    expect(splitCommand('   ')).toBeNull()
    // An unterminated quote is malformed; running the rest would be a guess.
    expect(splitCommand('"C:\\unterminated\\path.exe /SILENT')).toBeNull()
  })
})

describe('the registry locations', () => {
  it('covers both views and the per-user hive', () => {
    expect(UNINSTALL_KEYS.some(k => k.includes('WOW6432Node'))).toBe(true)
    expect(UNINSTALL_KEYS.some(k => k.startsWith('HKCU'))).toBe(true)
    expect(UNINSTALL_KEYS.some(k => k.startsWith('HKLM') && !k.includes('WOW6432Node'))).toBe(true)
  })
})
