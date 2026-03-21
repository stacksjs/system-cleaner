import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { PathSafetyCheck } from './types'

export const HOME = os.homedir()
export const USERNAME = os.userInfo().username
export const UID = os.userInfo().uid

// Directories that must never be deleted
const PROTECTED_PATHS = new Set([
  HOME,
  path.join(HOME, 'Desktop'),
  path.join(HOME, 'Documents'),
  path.join(HOME, 'Downloads'),
  path.join(HOME, 'Pictures'),
  path.join(HOME, 'Music'),
  path.join(HOME, 'Movies'),
  path.join(HOME, 'Applications'),
  path.join(HOME, '.ssh'),
  path.join(HOME, '.gnupg'),
  path.join(HOME, '.aws'),
  path.join(HOME, '.kube'),
  path.join(HOME, '.config'),
  '/',
  '/System',
  '/Library',
  '/Applications',
  '/Users',
  '/usr',
  '/bin',
  '/sbin',
  '/var',
  '/private',
  '/etc',
  '/tmp',
])

// Patterns in paths that indicate sensitive data
const SENSITIVE_PATTERNS = [
  '.ssh',
  '.gnupg',
  '.gpg',
  'credentials',
  'secrets',
  '.aws',
  '.kube',
  'keychain',
  '.env',
  'id_rsa',
  'id_ed25519',
  'known_hosts',
  'authorized_keys',
]

/**
 * Check if a path is safe to delete
 */
export function isPathSafe(targetPath: string): PathSafetyCheck {
  const resolved = path.resolve(targetPath)

  if (!resolved.startsWith(HOME)) {
    return { safe: false, reason: 'Path is outside home directory' }
  }

  if (resolved === HOME) {
    return { safe: false, reason: 'Cannot delete home directory' }
  }

  if (PROTECTED_PATHS.has(resolved)) {
    return { safe: false, reason: `${path.basename(resolved)} is a protected directory` }
  }

  // Check for sensitive data patterns
  const lowerPath = resolved.toLowerCase()
  for (const pattern of SENSITIVE_PATTERNS) {
    if (lowerPath.includes(pattern)) {
      return { safe: false, reason: `Path contains sensitive data pattern: ${pattern}` }
    }
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
 * Check if a path is safe for cleaning (less strict - allows cleaning contents)
 */
export function isCleanable(targetPath: string): PathSafetyCheck {
  const resolved = path.resolve(targetPath)

  if (!resolved.startsWith(HOME) && !resolved.startsWith('/private/tmp') && !resolved.startsWith('/private/var/tmp')) {
    return { safe: false, reason: 'Path is outside allowed directories' }
  }

  try {
    const stat = fs.lstatSync(resolved)
    if (stat.isSymbolicLink()) {
      return { safe: false, reason: 'Will not clean symbolic links' }
    }
    if (!stat.isDirectory()) {
      return { safe: false, reason: 'Path is not a directory' }
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
