import * as os from 'node:os'
import * as path from 'node:path'
import process from 'node:process'

/**
 * The Mac App Store edition, and what the App Sandbox leaves it.
 *
 * macOS sets `APP_SANDBOX_CONTAINER_ID` in the environment of every sandboxed
 * process, and the agent inherits it from Craft's App Store runtime through
 * `craft-backend`. Nothing else sets it, so it is the one reliable signal.
 *
 * A sandboxed process starts out seeing its own container as its home folder.
 * Every figure the app shows is about the real one, so until the person grants
 * it, Quick Clean would report 0 B and Privacy would find no traces, both of
 * which read as a clean Mac. The grant is a security-scoped bookmark Craft
 * keeps (`craft.dialog.requestFolderAccess`); Craft reopens it before it
 * starts the backend and lists it in `CRAFT_SECURITY_SCOPED_PATHS`, and the
 * launcher then points the agent's `HOME` at the real home folder and sets
 * `SYSTEM_CLEANER_HOME_GRANTED`.
 */
export const SANDBOXED: boolean = process.platform === 'darwin' && Boolean(process.env.APP_SANDBOX_CONTAINER_ID)

/** Which build this is, as the screens and the App Review notes name it. */
export const EDITION: 'app-store' | 'direct' = SANDBOXED ? 'app-store' : 'direct'

/**
 * The person's real home folder, even from inside the sandbox.
 *
 * `os.homedir()` reads `$HOME`, which the sandbox points at
 * `~/Library/Containers/<id>/Data`. The container path is derived from the
 * real one, so stripping that suffix recovers it without asking the password
 * database, which the sandbox may also answer with the container.
 */
export function realHomeFolder(env: NodeJS.ProcessEnv = process.env): string {
  if (env.SYSTEM_CLEANER_REAL_HOME)
    return env.SYSTEM_CLEANER_REAL_HOME
  const home = env.HOME || os.homedir()
  const id = env.APP_SANDBOX_CONTAINER_ID
  if (id) {
    const suffix = path.join('/Library/Containers', id, 'Data')
    if (home.endsWith(suffix))
      return home.slice(0, -suffix.length) || '/'
  }
  return home
}

/** The folders Craft holds open for this process, from its environment. */
export function grantedFolders(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.CRAFT_SECURITY_SCOPED_PATHS || '')
    .split('\n')
    .map(p => p.trim())
    .filter(p => path.isAbsolute(p))
}

/**
 * True when a grant covers the real home folder: the folder itself or one
 * above it. A grant inside it (only Downloads, say) is not enough for the
 * cleaning targets, which live under `~/Library`.
 */
export function homeIsGranted(env: NodeJS.ProcessEnv = process.env): boolean {
  const home = realHomeFolder(env)
  return grantedFolders(env).some(folder => home === folder || home.startsWith(folder.endsWith('/') ? folder : `${folder}/`))
}

/**
 * Whether the agent this code runs in can see the real home folder. Outside
 * the sandbox it always can.
 */
export const HOME_GRANTED: boolean = !SANDBOXED || process.env.SYSTEM_CLEANER_HOME_GRANTED === '1'

/**
 * Everything the App Sandbox rules out, with the sentence each screen shows.
 *
 * Keyed by the capability a whole screen depends on, or by the action inside
 * a screen that cannot run. Each reason says what is missing and, where there
 * is one, where the person can do it instead, so no screen is left looking
 * empty or broken.
 */
export const SANDBOX_LIMITS = {
  startupItems: 'Apps from the Mac App Store cannot read or change what macOS starts at login. You can review login items and background apps in System Settings, under General, Login Items & Extensions.',
  appUninstall: 'Apps from the Mac App Store cannot remove other apps. Drag an app from Applications to the Trash in Finder, then use Leftovers to clear the files it left behind.',
  maintenance: 'These tasks run system commands that need administrator rights, which apps from the Mac App Store cannot ask for. The direct download of SystemCleaner can run them.',
  trash: 'Apps from the Mac App Store cannot empty the Trash. Empty it from the Dock or Finder instead. Files SystemCleaner moves there stay recoverable until you do.',
  scheduledClean: 'An overnight clean needs a background agent that runs while SystemCleaner is closed, which apps from the Mac App Store cannot install. Run Quick Clean whenever you like instead.',
  processes: 'Apps from the Mac App Store cannot see other apps\' processes, so there is no list to show. Activity Monitor shows them, and can quit one.',
  processControl: 'Apps from the Mac App Store cannot quit other apps or processes. Use Activity Monitor, or quit the app itself, to stop one.',
  homebrew: 'Apps from the Mac App Store cannot run Homebrew. Run brew upgrade in Terminal to update these packages.',
  selfUpdate: 'The Mac App Store keeps this edition up to date.',
  vpn: 'Changing network settings needs administrator rights, which apps from the Mac App Store cannot ask for. Use System Settings, under VPN, instead.',
} as const

export type SandboxLimit = keyof typeof SANDBOX_LIMITS

/** The reason a feature is unavailable in this build, or null when it works. */
export function sandboxLimit(feature: string): string | null {
  if (!SANDBOXED) return null
  return (SANDBOX_LIMITS as Record<string, string>)[feature] ?? null
}
