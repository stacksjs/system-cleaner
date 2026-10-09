import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import process from 'node:process'
import type { PathSafetyCheck } from './types'

/**
 * Windows compares paths without regard to case, and separates them with a
 * backslash. Both matter here: `isPathSafe` is the one gate every destructive
 * route passes through, and on Windows it had no opinion about either.
 */
const IS_WINDOWS = process.platform === 'win32'

/**
 * True when `child` is `parent` or sits beneath it.
 *
 * A bare `startsWith` is not a containment test, and on a machine with two
 * accounts whose short names share a prefix it is a hole: with HOME
 * `/Users/glenn`, `/Users/glenn2/Documents` reads as inside your own home.
 * PROTECTED_PATHS only ever holds the current user's roots, so nothing behind
 * the boundary check refuses it - the sibling's entire home, Library and
 * Pictures all came back safe to delete. glenn/glenn2 and ci/ci-runner are
 * ordinary pairs, not contrivances.
 */
export function isWithin(child: string, parent: string): boolean {
  if (samePath(child, parent))
    return true
  const prefix = parent.endsWith(path.sep) ? parent : parent + path.sep
  return IS_WINDOWS
    ? child.toLowerCase().startsWith(prefix.toLowerCase())
    : child.startsWith(prefix)
}

/** Path equality, as the running filesystem defines it. */
function samePath(a: string, b: string): boolean {
  return IS_WINDOWS ? a.toLowerCase() === b.toLowerCase() : a === b
}

/**
 * Split into segments on whichever separator this platform writes.
 *
 * Gated on the platform rather than always splitting on both: a backslash is
 * a legal character in a macOS filename, so splitting on it there would make
 * a file named `notes\.ssh` read as a path containing an `.ssh` segment. That
 * errs safe - it refuses rather than deletes - but it is still a wrong answer,
 * and the behaviour on macOS should not move at all.
 */
function segmentsOf(p: string): string[] {
  return IS_WINDOWS ? p.split(/[\\/]+/) : p.split('/')
}

export const HOME = os.homedir()
export const USERNAME = os.userInfo().username
export const UID = os.userInfo().uid

/**
 * The system roots, per platform.
 *
 * The POSIX list protected nothing on Windows: `/System` and `/usr` do not
 * exist there, so every one of these checks passed for any path, including
 * `C:\\Windows`. The Windows CI leg caught it on its first run
 * (stacksjs/system-cleaner#23).
 */
const SYSTEM_ROOTS: string[] = IS_WINDOWS
  ? (() => {
      const drive = process.env.SystemDrive || 'C:'
      const windir = process.env.SystemRoot || process.env.windir || `${drive}\\Windows`
      return [
        `${drive}\\`,
        windir,
        process.env.ProgramFiles || `${drive}\\Program Files`,
        process.env['ProgramFiles(x86)'] || `${drive}\\Program Files (x86)`,
        process.env.PROGRAMDATA || `${drive}\\ProgramData`,
        `${drive}\\Users`,
        // The AppData roots themselves. Individual app folders inside them are
        // the whole point of a cleaner; the roots are not.
        process.env.LOCALAPPDATA || path.win32.join(HOME, 'AppData', 'Local'),
        process.env.APPDATA || path.win32.join(HOME, 'AppData', 'Roaming'),
        path.win32.join(HOME, 'AppData'),
      ]
    })()
  : ['/', '/System', '/Library', '/Applications', '/Users', '/usr', '/bin', '/sbin', '/var', '/private', '/etc', '/tmp']

/**
 * The user directories that hold work rather than disposable state.
 *
 * `Videos` is the Windows spelling of `Movies`; both are listed because the
 * set is checked against a resolved path and costs nothing to over-specify.
 */
const USER_ROOTS = ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Music', 'Movies', 'Videos', 'Applications', 'Library', '.ssh', '.gnupg', '.aws', '.kube', '.config']

// Directories that must never be deleted
const PROTECTED_PATHS = new Set([
  HOME,
  ...USER_ROOTS.map(d => path.join(HOME, d)),
  ...SYSTEM_ROOTS,
])

// Path components that indicate sensitive data (matched as whole path segments)
const SENSITIVE_SEGMENTS = new Set([
  '.ssh',
  '.gnupg',
  '.gpg',
  'credentials',
  'secrets',
  '.aws',
  '.kube',
  'Keychains',
])

// Filenames that are sensitive (matched exactly against basename)
const SENSITIVE_FILES = new Set([
  '.env',
  'id_rsa',
  'id_ed25519',
  'known_hosts',
  'authorized_keys',
])

/**
 * Set membership, case-folded where the filesystem is.
 *
 * `C:\\Users\\x\\.SSH` and `~/.ssh` are the same directory on Windows and
 * different ones on macOS, and only the Windows reading is dangerous.
 */
function matchesSensitive(set: Set<string>, segment: string): boolean {
  if (set.has(segment)) return true
  if (!IS_WINDOWS) return false
  const lower = segment.toLowerCase()
  for (const entry of set) {
    if (entry.toLowerCase() === lower) return true
  }
  return false
}

/**
 * Check if a path is safe to delete
 */
export function isPathSafe(targetPath: string): PathSafetyCheck {
  const resolved = path.resolve(targetPath)

  // Allow /Applications (for app uninstall) but reject other system paths.
  // The allowance is macOS-only on purpose: Windows uninstalls through the
  // registry rather than by deleting a bundle, and `appUninstall` is false
  // there, so opening up Program Files would widen the gate for a feature
  // that does not exist.
  const inHome = isWithin(resolved, HOME)
  const inAppBundles = !IS_WINDOWS && resolved.startsWith('/Applications/')
  if (!inHome && !inAppBundles) {
    return { safe: false, reason: 'Path is outside home directory' }
  }

  if (samePath(resolved, HOME)) {
    return { safe: false, reason: 'Cannot delete home directory' }
  }

  // /Applications itself is protected, but /Applications/SomeApp.app is allowed
  if (resolved === '/Applications') {
    return { safe: false, reason: 'Cannot delete /Applications directory' }
  }

  // Compared with samePath rather than Set.has, because Windows resolves
  // `C:\\WINDOWS` and `C:\\Windows` to the same directory and a Set does not.
  for (const protectedPath of PROTECTED_PATHS) {
    if (samePath(resolved, protectedPath))
      return { safe: false, reason: `${path.basename(resolved) || resolved} is a protected directory` }
  }

  // Check for sensitive data — match whole path segments to avoid false positives
  // (e.g., ".ssh" should block ~/.ssh/keys but NOT ~/Library/Caches/com.ssh-agent-cache)
  //
  // Split on either separator. This was `split('/')`, which on Windows returns
  // the whole path as a single segment and therefore matched nothing: an
  // `.ssh` or `credentials` directory passed the check completely. Git for
  // Windows puts keys in ~/.ssh like everywhere else, so this was not
  // hypothetical.
  const segments = segmentsOf(resolved)
  for (const segment of segments) {
    if (matchesSensitive(SENSITIVE_SEGMENTS, segment)) {
      return { safe: false, reason: `Path contains sensitive directory: ${segment}` }
    }
  }
  const basename = segments[segments.length - 1]
  if (matchesSensitive(SENSITIVE_FILES, basename)) {
    return { safe: false, reason: `Path contains sensitive file: ${basename}` }
  }

  try {
    const stat = fs.lstatSync(resolved)
    if (stat.isSymbolicLink()) {
      return { safe: false, reason: 'Will not delete symbolic links for safety' }
    }
  }
  catch {
    return { safe: false, reason: 'Path does not exist' }
  }

  return { safe: true }
}

/**
 * Caches macOS gates behind a consent prompt, keyed on the media libraries.
 *
 * These do not fail to clean, they *hang*: a process that touches
 * `~/Library/Caches/com.apple.Music` without consent parks in a syscall the
 * kernel will not return from, ignoring both its own timeout and SIGKILL.
 * Measuring `~/Library/Caches` hit it and blocked, which took the whole clean
 * down with it — the button did nothing at all, silently, on the largest
 * category the app offers.
 *
 * Refusing them up front costs a few hundred megabytes and keeps every other
 * category workable.
 */
const PERMISSION_GATED = [
  'Library/Caches/com.apple.Music',
  'Library/Caches/com.apple.TV',
  'Library/Caches/com.apple.podcasts',
  'Library/Caches/com.apple.photolibraryd',
]

/**
 * Whether `isCleanable` will refuse this path for the consent-prompt reason.
 *
 * Callers that *list* cleanable things want this: a gated path has a real size
 * and looks perfectly cleanable, so it used to appear in Quick Clean with a
 * Clean button that could only ever fail. Better to leave it out of the list
 * than to offer an action that never works.
 */
export function isPermissionGated(targetPath: string): boolean {
  const resolved = path.resolve(targetPath)
  return PERMISSION_GATED.some(gated => resolved === path.join(HOME, gated) || resolved.startsWith(`${path.join(HOME, gated)}/`))
}

/**
 * Check if a path is safe for cleaning (less strict - allows cleaning contents)
 */
export function isCleanable(targetPath: string): PathSafetyCheck {
  const resolved = path.resolve(targetPath)

  if (PERMISSION_GATED.some(gated => resolved === path.join(HOME, gated) || resolved.startsWith(`${path.join(HOME, gated)}/`))) {
    return {
      safe: false,
      reason: 'macOS gates this cache behind a media-library permission; cleaning it blocks until that is granted',
    }
  }

  if (
    !isWithin(resolved, HOME)
    && !resolved.startsWith('/private/tmp')
    && !resolved.startsWith('/private/var/tmp')
    && !resolved.startsWith('/Library/')
    && !resolved.startsWith('/private/var/log')
    && !resolved.startsWith('/private/var/db')
  ) {
    return { safe: false, reason: 'Path is outside allowed directories' }
  }

  try {
    const stat = fs.lstatSync(resolved)
    if (stat.isSymbolicLink()) {
      return { safe: false, reason: 'Will not clean symbolic links' }
    }
    if (!stat.isDirectory() && !stat.isFile()) {
      return { safe: false, reason: 'Path is not a regular file or directory' }
    }
  }
  catch {
    return { safe: false, reason: 'Path does not exist' }
  }

  return { safe: true }
}

/**
 * Common macOS library paths
 */
export const macPaths = {
  libraryDir: path.join(HOME, 'Library'),
  caches: path.join(HOME, 'Library/Caches'),
  logs: path.join(HOME, 'Library/Logs'),
  preferences: path.join(HOME, 'Library/Preferences'),
  applicationSupport: path.join(HOME, 'Library/Application Support'),
  cookies: path.join(HOME, 'Library/Cookies'),
  launchAgents: path.join(HOME, 'Library/LaunchAgents'),
  savedState: path.join(HOME, 'Library/Saved Application State'),
  httpStorages: path.join(HOME, 'Library/HTTPStorages'),
  webkit: path.join(HOME, 'Library/WebKit'),
  containers: path.join(HOME, 'Library/Containers'),
  groupContainers: path.join(HOME, 'Library/Group Containers'),
  crashReports: path.join(HOME, 'Library/Logs/DiagnosticReports'),
  trash: path.join(HOME, '.Trash'),

  // System-level paths
  systemLaunchAgents: '/Library/LaunchAgents',
  systemLaunchDaemons: '/Library/LaunchDaemons',
  systemCaches: '/Library/Caches',
  systemLogs: '/Library/Logs',
  systemApplications: '/Applications',
  systemCrashReports: '/Library/Logs/DiagnosticReports',
} as const

/**
 * The same concepts on Windows, and `null` where there is no such concept.
 *
 * Null is the whole point. Windows has no per-user "Library", no launch
 * agents, no saved application state, and preferences live in the registry
 * rather than on disk. Mapping those onto a plausible-looking directory would
 * make the cleaner scan something that was never the thing it meant - and this
 * app deletes what it scans. A caller that gets `null` is being told to skip
 * the feature, which is what `capabilities` in ./platform is for.
 *
 * Built from a function so the env can be injected in a test; on macOS every
 * one of these variables is undefined, and a bare `process.env.X` map would
 * silently become a set of relative paths rooted at the CWD.
 */
export function buildWinPaths(env: Record<string, string | undefined> = process.env): WinPaths {
  // On a real Windows box these are always set. The fallbacks exist so the
  // shape can be asserted in a test from any platform, and are deliberately
  // absolute so a mistake shows up as a wrong path rather than a relative one.
  const home = env.USERPROFILE || HOME
  const local = env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local')
  const roaming = env.APPDATA || path.win32.join(home, 'AppData', 'Roaming')
  const programData = env.PROGRAMDATA || 'C:\\ProgramData'
  const programFiles = env.ProgramFiles || 'C:\\Program Files'
  const windir = env.SystemRoot || env.windir || 'C:\\Windows'
  const temp = env.TEMP || env.TMP || path.win32.join(local, 'Temp')
  const systemDrive = env.SystemDrive || 'C:'

  return {
    localAppData: local,
    roamingAppData: roaming,
    programData,
    temp,
    windowsTemp: path.win32.join(windir, 'Temp'),
    prefetch: path.win32.join(windir, 'Prefetch'),
    // Windows writes user-mode crash dumps here when configured to; the
    // directory is absent until the first dump, which callers must tolerate.
    crashReports: path.win32.join(local, 'CrashDumps'),
    // Per-volume and SID-scoped. This is the root, not the user's own folder,
    // so anything touching it has to resolve the SID first - which is why
    // emptying the Recycle Bin is a shell API call and not an rmdir.
    recycleBin: path.win32.join(systemDrive, '$Recycle.Bin'),
    systemApplications: programFiles,
    systemLogs: path.win32.join(windir, 'Logs'),

    // No Windows equivalent. Listed rather than omitted so the gap is visible
    // in one place instead of being rediscovered at each call site.
    libraryDir: null,
    logs: null,
    preferences: null,
    cookies: null,
    launchAgents: null,
    savedState: null,
    httpStorages: null,
    webkit: null,
    containers: null,
    groupContainers: null,
    systemLaunchAgents: null,
    systemLaunchDaemons: null,
  }
}

export interface WinPaths {
  localAppData: string
  roamingAppData: string
  programData: string
  temp: string
  windowsTemp: string
  prefetch: string
  crashReports: string
  recycleBin: string
  systemApplications: string
  systemLogs: string

  libraryDir: null
  logs: null
  preferences: null
  cookies: null
  launchAgents: null
  savedState: null
  httpStorages: null
  webkit: null
  containers: null
  groupContainers: null
  systemLaunchAgents: null
  systemLaunchDaemons: null
}

/**
 * Safely read a directory, returning empty array on failure
 */
export function safeReadDir(dirPath: string): string[] {
  try {
    return fs.readdirSync(dirPath)
  }
  catch {
    return []
  }
}

/**
 * Safely read a directory with file types
 */
export function safeReadDirWithTypes(dirPath: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true })
  }
  catch {
    return []
  }
}

/**
 * Safely read a file as string
 */
export function safeReadFile(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf8')
  }
  catch {
    return ''
  }
}

/**
 * Safely stat a path
 */
export function safeStat(filePath: string): fs.Stats | null {
  try {
    return fs.statSync(filePath)
  }
  catch {
    return null
  }
}

/**
 * Safely lstat a path (does not follow symlinks)
 */
export function safeLstat(filePath: string): fs.Stats | null {
  try {
    return fs.lstatSync(filePath)
  }
  catch {
    return null
  }
}

/**
 * Check if a path exists
 */
export function pathExists(filePath: string): boolean {
  try {
    fs.accessSync(filePath)
    return true
  }
  catch {
    return false
  }
}

/**
 * Find matching paths using glob patterns in a directory
 */
export function findMatchingPaths(dirPath: string, pattern: string | RegExp): string[] {
  const entries = safeReadDir(dirPath)
  const regex = typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern
  return entries
    .filter(entry => regex.test(entry))
    .map(entry => path.join(dirPath, entry))
}

/**
 * Resolve a tilde path to an absolute path
 */
export function expandPath(p: string): string {
  if (p.startsWith('~/')) {
    return path.join(HOME, p.slice(2))
  }
  return path.resolve(p)
}
