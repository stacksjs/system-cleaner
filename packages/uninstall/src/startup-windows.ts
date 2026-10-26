import * as fs from 'node:fs'
import * as path from 'node:path'
import process from 'node:process'
import type { StartupItem } from './types'

/**
 * What starts automatically on Windows.
 *
 * Two places, and people think of both as "startup items" even though the
 * system treats them very differently:
 *
 *  - **The Run keys.** Four of them — per-user and machine-wide, each with a
 *    32-bit view on a 64-bit machine. A value here is a command line, not a
 *    path, so it carries arguments and the executable may be quoted.
 *  - **The Startup folders.** One per user and one for all users. A shortcut
 *    dropped in either is launched at logon.
 *
 * Whether a Run entry is *enabled* is not stored with it. Windows 8 and later
 * keep that in a parallel `StartupApproved` key as a binary blob whose first
 * byte says which — which is why Task Manager can disable something without
 * deleting it, and why reading the Run key alone would report every disabled
 * item as enabled.
 *
 * Everything here that interprets `reg.exe` output is a pure function over
 * text: the only machine that can run it is not the one this was written on.
 *
 * See stacksjs/system-cleaner#23.
 */

/** One value read out of a registry key. */
export interface RegistryValue {
  name: string
  type: string
  value: string
}

/**
 * Parse `reg.exe query <key>` output.
 *
 * The format is a key line, then one indented line per value:
 *
 *     HKEY_CURRENT_USER\Software\...\Run
 *         OneDrive    REG_SZ    "C:\...\OneDrive.exe" /background
 *
 * Name, type and value are separated by runs of whitespace, but the *value*
 * may contain them freely — a path with spaces, or arguments — so the split
 * takes the first two fields and keeps the rest intact. A value name may also
 * contain spaces, which is why the type is found by looking for the `REG_`
 * token rather than by counting fields from the left.
 */
export function parseRegQuery(stdout: string): RegistryValue[] {
  const values: RegistryValue[] = []

  for (const line of stdout.split('\n')) {
    const trimmed = line.trimEnd()
    // Value lines are indented; the key line is not.
    if (!trimmed.startsWith(' ') && !trimmed.startsWith('\t'))
      continue

    const body = trimmed.trim()
    if (!body)
      continue

    const typeMatch = body.match(/\s(REG_[A-Z_]+)\s/)
    if (!typeMatch || typeMatch.index === undefined)
      continue

    const name = body.slice(0, typeMatch.index).trim()
    const value = body.slice(typeMatch.index + typeMatch[0].length).trim()
    if (!name)
      continue

    values.push({ name, type: typeMatch[1], value })
  }

  return values
}

/**
 * Which Run entries have been switched off, by name.
 *
 * `StartupApproved` stores a 12-byte blob per entry, and only the first byte
 * matters: an even value is enabled, an odd one is disabled. `reg query`
 * prints it as hex, so `0200000000000000...` is on and `0300...` is off.
 *
 * Anything unparseable is reported as enabled, which matches what the entry
 * does: a Run value with no approval record runs.
 */
export function parseStartupApproved(stdout: string): Map<string, boolean> {
  const disabled = new Map<string, boolean>()

  for (const entry of parseRegQuery(stdout)) {
    if (entry.type !== 'REG_BINARY')
      continue
    const firstByte = Number.parseInt(entry.value.slice(0, 2), 16)
    disabled.set(entry.name, Number.isFinite(firstByte) ? (firstByte & 1) === 1 : false)
  }

  return disabled
}

/**
 * The executable a Run command line points at.
 *
 * The value is a command line: the program may be quoted, and arguments
 * follow it. Splitting on the first space would cut `C:\Program Files\...` in
 * half, which is most of what is in there.
 */
export function programFromCommand(command: string): string {
  const trimmed = command.trim()
  if (trimmed.startsWith('"')) {
    const closing = trimmed.indexOf('"', 1)
    if (closing > 0)
      return trimmed.slice(1, closing)
  }
  const space = trimmed.indexOf(' ')
  return space > 0 ? trimmed.slice(0, space) : trimmed
}

/** The registry locations Windows starts things from. */
export interface RunKey {
  key: string
  approvalKey: string
  scope: StartupItem['scope']
  /** Shown so somebody can find the entry themselves. */
  label: string
}

export const WINDOWS_RUN_KEYS: RunKey[] = [
  {
    key: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
    approvalKey: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run',
    scope: 'user',
    label: 'HKCU\\...\\CurrentVersion\\Run',
  },
  {
    key: 'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
    approvalKey: 'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run',
    scope: 'system',
    label: 'HKLM\\...\\CurrentVersion\\Run',
  },
  {
    // The 32-bit view. A 32-bit installer on a 64-bit machine writes here, and
    // reading only the native view misses it entirely.
    key: 'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run',
    approvalKey: 'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run32',
    scope: 'system',
    label: 'HKLM\\...\\WOW6432Node\\...\\Run',
  },
]

/** The two folders a shortcut can be dropped into to run at logon. */
export function startupFolders(): { dir: string, scope: StartupItem['scope'], label: string }[] {
  const roaming = process.env.APPDATA || path.win32.join(process.env.USERPROFILE || '', 'AppData', 'Roaming')
  const programData = process.env.PROGRAMDATA || 'C:\\ProgramData'
  const tail = path.win32.join('Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')

  return [
    { dir: path.win32.join(roaming, tail), scope: 'user', label: 'Startup folder (you)' },
    { dir: path.win32.join(programData, tail), scope: 'system', label: 'Startup folder (all users)' },
  ]
}

/**
 * The suffix a disabled shortcut carries.
 *
 * Renaming rather than deleting, so turning something back on restores exactly
 * what was there. Windows only launches what it recognises, and it does not
 * recognise this.
 */
export const DISABLED_SUFFIX = '.disabled-by-system-cleaner'

/** Run `reg.exe query`, or null when the key is absent or unreadable. */
async function regQuery(key: string): Promise<string | null> {
  try {
    // Spawned directly: `exec` wraps everything in `sh -c`, which Windows does
    // not have.
    const proc = Bun.spawn(['reg.exe', 'query', key], { stdout: 'pipe', stderr: 'ignore' })
    const timer = setTimeout(() => proc.kill(), 5000)
    const stdout = await new Response(proc.stdout).text()
    const code = await proc.exited
    clearTimeout(timer)
    // Exit 1 is "no such key", which is ordinary: a machine with nothing in
    // HKLM\...\Run has no key at all rather than an empty one.
    return code === 0 ? stdout : null
  }
  catch {
    return null
  }
}

/**
 * Everything Windows starts at logon.
 *
 * Registry entries and Startup-folder shortcuts in one list, because that is
 * how a person thinks about them even though the system does not.
 */
export async function discoverWindowsStartup(): Promise<StartupItem[]> {
  const items: StartupItem[] = []

  for (const run of WINDOWS_RUN_KEYS) {
    const stdout = await regQuery(run.key)
    if (stdout === null)
      continue

    const approvals = parseStartupApproved(await regQuery(run.approvalKey) ?? '')

    for (const entry of parseRegQuery(stdout)) {
      const program = programFromCommand(entry.value)
      items.push({
        id: `startup-${items.length}`,
        name: entry.name,
        label: entry.name,
        vendor: vendorOf(program),
        icon: 'i-f7-power',
        category: categoryOf(program),
        scope: run.scope,
        type: 'registry',
        // A Run entry has no equivalent of these: it is launched once at logon
        // and never restarted.
        runAtLoad: true,
        keepAlive: false,
        disabled: approvals.get(entry.name) ?? false,
        filepath: `${run.key}\\${entry.name}`,
        program: entry.value,
        // `program` keeps the whole command line for display; the existence
        // check needs the executable on its own, without the arguments.
        targetMissing: program !== '' && path.win32.isAbsolute(program) && !fs.existsSync(program),
      })
    }
  }

  for (const folder of startupFolders()) {
    let entries: string[]
    try {
      entries = fs.readdirSync(folder.dir)
    }
    catch {
      continue
    }

    for (const entry of entries) {
      if (entry === 'desktop.ini')
        continue

      const disabled = entry.endsWith(DISABLED_SUFFIX)
      const name = disabled ? entry.slice(0, -DISABLED_SUFFIX.length) : entry
      const full = path.win32.join(folder.dir, entry)

      items.push({
        id: `startup-${items.length}`,
        name: path.win32.basename(name, path.win32.extname(name)),
        label: name,
        vendor: vendorOf(name),
        icon: 'i-f7-power',
        category: categoryOf(name),
        scope: folder.scope,
        type: 'startup-folder',
        runAtLoad: true,
        keepAlive: false,
        disabled,
        filepath: full,
        program: full,
        // The entry *is* the file, and it was just read out of the directory.
        // A `.lnk` here could still point somewhere dead, but resolving a
        // shortcut target is not something this reads, so the honest answer
        // is no rather than a guess.
        targetMissing: false,
      })
    }
  }

  items.sort((a, b) => {
    if (a.disabled !== b.disabled)
      return a.disabled ? 1 : -1
    return a.name.localeCompare(b.name)
  })

  return items
}

/** A rough vendor, from the path. Shown, never acted on. */
function vendorOf(value: string): string {
  const lower = value.toLowerCase()
  for (const [needle, vendor] of [
    ['microsoft', 'Microsoft'],
    ['windows', 'Microsoft'],
    ['google', 'Google'],
    ['adobe', 'Adobe'],
    ['dropbox', 'Dropbox'],
    ['nvidia', 'NVIDIA'],
    ['intel', 'Intel'],
    ['realtek', 'Realtek'],
    ['steam', 'Valve'],
    ['discord', 'Discord'],
    ['spotify', 'Spotify'],
  ] as const) {
    if (lower.includes(needle))
      return vendor
  }
  return 'Unknown'
}

function categoryOf(value: string): StartupItem['category'] {
  const lower = value.toLowerCase()
  // `system32` and the Windows directory are the OS's own.
  if (lower.includes('\\windows\\') || lower.includes('system32'))
    return 'system'
  if (/node|python|docker|git|code|jetbrains/.test(lower))
    return 'dev'
  return vendorOf(value) === 'Unknown' ? 'other' : 'vendor'
}

/**
 * Turn a Windows startup item on or off.
 *
 * Nothing is deleted. A Startup-folder shortcut is renamed, and a Run entry is
 * switched through the same `StartupApproved` record Task Manager writes — so
 * the Run value itself is left exactly as the installer wrote it and turning
 * the item back on restores what was there rather than a reconstruction.
 *
 * Deleting the Run value would have been fewer lines and unrecoverable: the
 * command line, its arguments and its quoting are not written down anywhere
 * else.
 */
export async function toggleWindowsStartupItem(
  filepath: string,
  action: 'enable' | 'disable',
): Promise<{ success: boolean, error?: string }> {
  const run = WINDOWS_RUN_KEYS.find(k => filepath.startsWith(`${k.key}\\`))
  if (run)
    return toggleRunEntry(run, filepath.slice(run.key.length + 1), action)

  return toggleShortcut(filepath, action)
}

/** Flip the approval byte, creating the record if there is not one yet. */
async function toggleRunEntry(
  run: RunKey,
  name: string,
  action: 'enable' | 'disable',
): Promise<{ success: boolean, error?: string }> {
  if (!name)
    return { success: false, error: 'No value name in that registry path' }

  // Twelve bytes, of which only the first is read. Task Manager writes a
  // timestamp into the rest; zeroes are accepted and mean "never toggled".
  const blob = action === 'disable' ? '03' : '02'
  const data = blob + '0'.repeat(22)

  try {
    const proc = Bun.spawn([
      'reg.exe',
      'add',
      run.approvalKey,
      '/v',
      name,
      '/t',
      'REG_BINARY',
      '/d',
      data,
      '/f',
    ], { stdout: 'ignore', stderr: 'pipe' })

    const stderr = await new Response(proc.stderr).text()
    const code = await proc.exited

    if (code !== 0) {
      // HKLM needs administrator rights, which this agent does not have and
      // cannot ask for. Saying so beats "it did not work".
      return {
        success: false,
        error: run.scope === 'system'
          ? 'Changing a machine-wide startup entry needs administrator rights'
          : stderr.trim() || `reg.exe exited ${code}`,
      }
    }

    return { success: true }
  }
  catch {
    return { success: false, error: 'Could not run reg.exe' }
  }
}

/**
 * Rename a Startup-folder shortcut.
 *
 * Windows launches what it recognises, and a file ending in the suffix below
 * is not a shortcut any more. Nothing about the original is lost.
 */
async function toggleShortcut(
  filepath: string,
  action: 'enable' | 'disable',
): Promise<{ success: boolean, error?: string }> {
  const withinStartup = startupFolders().some(f => filepath.toLowerCase().startsWith(f.dir.toLowerCase()))
  if (!withinStartup)
    return { success: false, error: 'That path is not in a Startup folder' }

  const isDisabled = filepath.endsWith(DISABLED_SUFFIX)
  if (action === 'disable' && isDisabled)
    return { success: true }
  if (action === 'enable' && !isDisabled)
    return { success: true }

  const target = action === 'disable'
    ? `${filepath}${DISABLED_SUFFIX}`
    : filepath.slice(0, -DISABLED_SUFFIX.length)

  try {
    fs.renameSync(filepath, target)
    return { success: true }
  }
  catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}
