import type { AppInfo } from './types'
import { parseRegQuery } from './startup-windows'

/**
 * Installed programs on Windows.
 *
 * Nothing here resembles the macOS model, and pretending otherwise is the
 * trap. A Mac app is a bundle: uninstalling it means moving a directory this
 * app picked to the Trash, and every byte of that is something we chose and
 * can undo. A Windows program is a registry entry pointing at the vendor's own
 * uninstaller, and removing it means running a command somebody else wrote.
 *
 * So this module discovers and measures; it does not delete. What it can offer
 * is what Windows' own Apps & features offers — start the uninstaller the
 * vendor registered and let the person finish it — and it says that is what
 * happened rather than claiming the program is gone.
 *
 * See stacksjs/system-cleaner#23.
 */

/** Where Windows records what is installed. */
export const UNINSTALL_KEYS = [
  'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  // 32-bit programs on a 64-bit machine. Reading only the native view misses
  // a large share of what is actually installed.
  'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
] as const

/** One program, as the registry describes it. */
export interface InstalledProgram {
  key: string
  name: string
  version: string
  publisher: string
  /** Kilobytes, as `EstimatedSize` records it. Often absent. */
  estimatedSizeKB: number
  installLocation: string
  uninstallString: string
  /** The vendor's own silent variant, when they registered one. */
  quietUninstallString: string
  systemComponent: boolean
}

/**
 * Split `reg query ... /s` output into one block per key.
 *
 * `/s` walks the whole tree in a single call, which matters: there are
 * hundreds of these keys and one spawn each would take minutes. A key line is
 * unindented and every value under it is indented, so the blocks fall out of
 * the indentation.
 */
export function parseRegTree(stdout: string): { key: string, values: Map<string, string> }[] {
  const blocks: { key: string, values: Map<string, string> }[] = []
  let current: { key: string, values: Map<string, string> } | null = null
  let buffer: string[] = []

  const flush = (): void => {
    if (!current)
      return
    for (const value of parseRegQuery(buffer.join('\n')))
      current.values.set(value.name, value.value)
    blocks.push(current)
    buffer = []
  }

  for (const raw of stdout.split('\n')) {
    const line = raw.trimEnd()
    if (!line.trim())
      continue

    if (!line.startsWith(' ') && !line.startsWith('\t')) {
      flush()
      current = { key: line.trim(), values: new Map() }
      continue
    }

    buffer.push(line)
  }

  flush()
  return blocks
}

/** `0x1f4` as a number. `reg` prints DWORDs in hex. */
export function parseDword(value: string): number {
  if (!value)
    return 0
  const parsed = value.trim().startsWith('0x')
    ? Number.parseInt(value.trim().slice(2), 16)
    : Number.parseInt(value.trim(), 10)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Turn registry blocks into the programs a person would recognise.
 *
 * Most of the filtering here is about what Windows puts in this key that is
 * not a program: update records, language packs, and the components a vendor
 * marks `SystemComponent` precisely so they stay out of Apps & features.
 */
export function toInstalledPrograms(blocks: { key: string, values: Map<string, string> }[]): InstalledProgram[] {
  const programs: InstalledProgram[] = []

  for (const block of blocks) {
    const get = (name: string): string => block.values.get(name) ?? ''
    const name = get('DisplayName')

    // No display name means it is not something Apps & features would list
    // either - usually a patch record left behind by an installer.
    if (!name)
      continue

    // `SystemComponent` is the flag a vendor sets to say "this is plumbing";
    // Windows hides those, and so does this.
    if (parseDword(get('SystemComponent')) === 1)
      continue

    // An update to something else, not a thing in its own right.
    if (get('ParentKeyName') || get('ParentDisplayName'))
      continue
    if (/^(?:KB\d{6,}|Update for|Security Update for|Hotfix for)/i.test(name))
      continue

    programs.push({
      key: block.key,
      name,
      version: get('DisplayVersion'),
      publisher: get('Publisher'),
      estimatedSizeKB: parseDword(get('EstimatedSize')),
      installLocation: get('InstallLocation'),
      uninstallString: get('UninstallString'),
      quietUninstallString: get('QuietUninstallString'),
      systemComponent: false,
    })
  }

  // The same program can be registered in more than one hive - a per-machine
  // and a per-user entry for the same install - and listing it twice invites
  // somebody to uninstall it twice.
  const byIdentity = new Map<string, InstalledProgram>()
  for (const program of programs) {
    const identity = `${program.name}\u0000${program.version}`.toLowerCase()
    const existing = byIdentity.get(identity)
    // Prefer the entry that knows how to uninstall itself.
    if (!existing || (!existing.uninstallString && program.uninstallString))
      byIdentity.set(identity, program)
  }

  return [...byIdentity.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * The shape the rest of the app expects.
 *
 * `path` carries the registry key rather than a directory, because that is
 * what identifies a Windows program and what any later action has to be given.
 * `InstallLocation` is frequently blank and occasionally wrong, so it is
 * reported where present and never relied on.
 */
export function toAppInfo(program: InstalledProgram): AppInfo {
  return {
    name: program.name,
    bundleId: program.key,
    version: program.version,
    path: program.key,
    iconPath: '',
    sizeBytes: program.estimatedSizeKB * 1024,
    installDate: null,
    // Nothing here is Windows' own: `SystemComponent` entries were dropped
    // above, and what remains is what a person installed.
    isSystemApp: false,
  }
}

/** Run `reg.exe query <key> /s`, or null when the key is absent. */
async function regTree(key: string): Promise<string | null> {
  try {
    // Spawned directly: `exec` wraps everything in `sh -c`, which Windows does
    // not have.
    const proc = Bun.spawn(['reg.exe', 'query', key, '/s'], { stdout: 'pipe', stderr: 'ignore' })
    const timer = setTimeout(() => proc.kill(), 20_000)
    const stdout = await new Response(proc.stdout).text()
    const code = await proc.exited
    clearTimeout(timer)
    return code === 0 ? stdout : null
  }
  catch {
    return null
  }
}

/** Everything installed, from all three registry views. */
export async function discoverWindowsPrograms(): Promise<InstalledProgram[]> {
  const blocks: { key: string, values: Map<string, string> }[] = []

  for (const key of UNINSTALL_KEYS) {
    const stdout = await regTree(key)
    if (stdout !== null)
      blocks.push(...parseRegTree(stdout))
  }

  return toInstalledPrograms(blocks)
}

export interface UninstallLaunch {
  success: boolean
  /** True when the vendor's uninstaller was started. */
  launched: boolean
  error?: string
}

/**
 * Start the uninstaller a program registered for itself.
 *
 * This is the whole Windows uninstall story, and the limits are worth being
 * plain about.
 *
 * It **starts** the vendor's uninstaller. It does not remove anything itself,
 * does not wait for the uninstaller to finish, and does not report bytes
 * freed — most uninstallers open a window and ask questions, some need
 * administrator rights, and any of them can be cancelled halfway. Claiming a
 * program was removed because a process was spawned would be the same class of
 * lie as reporting freed space that never came back.
 *
 * The command is taken verbatim from the registry and never built from
 * anything a caller supplied: the only input is which program, and the string
 * is whatever the vendor wrote at install time. That is also what Windows'
 * own Apps & features does.
 *
 * `QuietUninstallString` is deliberately not preferred. A silent uninstall
 * with no window is indistinguishable from nothing happening, and this app
 * would then be reporting an outcome it cannot see.
 */
export async function launchWindowsUninstaller(program: InstalledProgram): Promise<UninstallLaunch> {
  const command = program.uninstallString.trim()
  if (!command)
    return { success: false, launched: false, error: `${program.name} registered no uninstaller` }

  const parsed = splitCommand(command)
  if (!parsed)
    return { success: false, launched: false, error: 'Could not read the registered uninstall command' }

  try {
    const proc = Bun.spawn([parsed.program, ...parsed.args], {
      stdout: 'ignore',
      stderr: 'ignore',
      stdin: 'ignore',
    })
    // Deliberately not awaited. An uninstaller is a window somebody is about
    // to interact with, and holding the request open until they finish would
    // block this one and tell us nothing we could report anyway.
    proc.unref?.()
    return { success: true, launched: true }
  }
  catch (err) {
    return { success: false, launched: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Split a registered uninstall command into a program and its arguments.
 *
 * These are command lines, not paths: `MsiExec.exe /X{GUID}`, or a quoted
 * path followed by switches. Passing the whole string as one argument looks
 * for a file with the switches in its name; splitting on spaces cuts
 * `C:\Program Files\...` in half. Quotes decide which.
 */
export function splitCommand(command: string): { program: string, args: string[] } | null {
  const trimmed = command.trim()
  if (!trimmed)
    return null

  if (trimmed.startsWith('"')) {
    const closing = trimmed.indexOf('"', 1)
    if (closing < 0)
      return null
    const program = trimmed.slice(1, closing)
    return program ? { program, args: tokenize(trimmed.slice(closing + 1)) } : null
  }

  // Unquoted. Everything up to the first space is the program, which is what
  // Windows itself assumes for an unquoted command.
  const space = trimmed.indexOf(' ')
  if (space < 0)
    return { program: trimmed, args: [] }

  return { program: trimmed.slice(0, space), args: tokenize(trimmed.slice(space + 1)) }
}

/** Split arguments on whitespace, keeping quoted runs together. */
function tokenize(rest: string): string[] {
  const args: string[] = []
  const pattern = /"([^"]*)"|(\S+)/g
  let match = pattern.exec(rest)
  while (match !== null) {
    args.push(match[1] ?? match[2])
    match = pattern.exec(rest)
  }
  return args
}
