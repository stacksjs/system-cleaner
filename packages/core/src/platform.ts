import process from 'node:process'

/**
 * The platforms this app knows how to reason about.
 *
 * `unsupported` is a real answer, not a failure to detect. Anything the
 * cleaning logic has no map for lands here, and the screens are expected to
 * say so rather than present an empty result.
 */
export type Platform = 'macos' | 'linux' | 'windows' | 'unsupported'

function detect(): Platform {
  switch (process.platform) {
    case 'darwin': return 'macos'
    case 'win32': return 'windows'
    case 'linux': return 'linux'
    default: return 'unsupported'
  }
}

export const PLATFORM: Platform = detect()

export const isMacOS: boolean = PLATFORM === 'macos'
export const isWindows: boolean = PLATFORM === 'windows'
export const isLinux: boolean = PLATFORM === 'linux'

/**
 * What this app can actually do on the platform it is running on.
 *
 * Every screen maps to one of these. The point is that a screen with no
 * implementation here is *known* to have none, rather than quietly scanning
 * zero paths and reporting that the machine is clean — which is what a Windows
 * user sees today, because `launchctl` and `mdfind` simply are not found and
 * the empty result reads as good news.
 *
 * Keep this honest. Adding a key here is a claim that the feature works, and
 * the only thing worse than a missing feature in a tool that deletes files is
 * one that claims to have checked.
 */
export interface Capabilities {
  /** Quick Clean: cache and log directories with known locations. */
  cleanTargets: boolean
  /** Disk Usage, Largest Files, Duplicates: plain filesystem walks. */
  diskScan: boolean
  /** Developer Junk: build output inside repositories. */
  developerJunk: boolean
  /** Applications and Leftovers: uninstalling and finding orphaned data. */
  appUninstall: boolean
  /** Startup Items: what launches at login. */
  startupItems: boolean
  /** Privacy: browser caches, cookies and histories. */
  privacy: boolean
  /** Maintenance: the OS-level upkeep commands. */
  maintenance: boolean
  /** Processes and the live CPU/memory readouts. */
  processes: boolean
  /** Emptying the platform's own trash can. */
  trash: boolean
}

const NONE: Capabilities = {
  cleanTargets: false,
  diskScan: false,
  developerJunk: false,
  appUninstall: false,
  startupItems: false,
  privacy: false,
  maintenance: false,
  processes: false,
  trash: false,
}

/**
 * Per-platform capability map.
 *
 * macOS is the platform this app was built against and everything works.
 *
 * Linux gets the three features that are pure filesystem work. The rest lean
 * on `launchctl`, `.app` bundles and `osascript`, none of which exist there.
 *
 * Windows is currently all false, deliberately. The path and command layers
 * have no Windows implementation yet, so every one of these would be a lie.
 * This is the flag to flip, one key at a time, as each lands — see
 * stacksjs/system-cleaner#23.
 */
const CAPABILITIES: Record<Platform, Capabilities> = {
  macos: {
    cleanTargets: true,
    diskScan: true,
    developerJunk: true,
    appUninstall: true,
    startupItems: true,
    privacy: true,
    maintenance: true,
    processes: true,
    trash: true,
  },
  linux: {
    ...NONE,
    diskScan: true,
    developerJunk: true,
  },
  windows: { ...NONE },
  unsupported: { ...NONE },
}

export const capabilities: Capabilities = CAPABILITIES[PLATFORM]

/** True when the running platform implements this feature. */
export function supports(feature: keyof Capabilities): boolean {
  return capabilities[feature]
}

/**
 * A sentence for a screen that cannot run here.
 *
 * Deliberately names the platform and the feature, because "not supported" on
 * its own reads as a bug to anyone who has not read the release notes.
 */
export function unsupportedReason(feature: keyof Capabilities): string {
  const name: Record<Platform, string> = {
    macos: 'macOS',
    linux: 'Linux',
    windows: 'Windows',
    unsupported: `this platform (${process.platform})`,
  }
  return `${FEATURE_LABELS[feature]} is not implemented on ${name[PLATFORM]} yet.`
}

const FEATURE_LABELS: Record<keyof Capabilities, string> = {
  cleanTargets: 'Quick Clean',
  diskScan: 'Disk scanning',
  developerJunk: 'Developer Junk',
  appUninstall: 'Application uninstall',
  startupItems: 'Startup Items',
  privacy: 'Privacy cleaning',
  maintenance: 'Maintenance tasks',
  processes: 'Process monitoring',
  trash: 'Emptying the Trash',
}
