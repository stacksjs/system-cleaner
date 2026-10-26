import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * Where the pieces of an installed app sit, and how to drive the window,
 * per platform.
 *
 * Extracted from `launcher.ts` because that file starts a server and opens a
 * window as a side effect of being loaded, so nothing in it could be imported
 * and checked. Every platform-dependent decision the launcher makes now lives
 * here as a pure function over an exec path and a platform name, which means
 * the Windows answers can be asserted from a Mac — and had to be, since the
 * first Windows bundle was assembled before anyone could run it.
 *
 * See stacksjs/system-cleaner#23.
 */

export type DesktopPlatform = 'darwin' | 'win32' | 'linux'

export interface BundleLayout {
  /** The Craft runtime that hosts the web view. */
  craftBinary: string
  /** The prerendered UI. */
  webRoot: string
  /** Migrations the agent applies on first run. */
  migrationsDir: string
}

/**
 * The bundle's own files, relative to the executable the OS launched.
 *
 * macOS has a prescribed shape and the paths reflect it: the launcher sits in
 * `Contents/MacOS` beside the runtime, and everything else is under
 * `Contents/Resources`. Windows prescribes nothing, so the layout is flat —
 * the directory the user unzipped, with a `resources` folder in it. Inventing
 * a `Contents/MacOS` on Windows would have been consistent and meaningless.
 */
export function bundleLayout(execPath: string, platform: DesktopPlatform): BundleLayout {
  // The path flavour follows the *platform argument*, not the host. In
  // production they always agree - the Windows launcher runs on Windows - but
  // a function that takes a platform and then applies the host's separator
  // rules cannot be checked from anywhere else, which was the entire reason
  // for pulling it out of the launcher. Handed `C:\\app\\SystemCleaner.exe` on
  // a Mac, `path.dirname` answers `.` and the runtime path came out as a bare
  // `craft-runtime.exe` relative to the working directory.
  const p = platform === 'win32' ? path.win32 : path.posix
  const execDir = p.dirname(execPath)

  if (platform === 'darwin') {
    const contents = p.dirname(execDir)
    return {
      craftBinary: p.join(execDir, 'craft-runtime'),
      webRoot: p.join(contents, 'Resources', 'web'),
      migrationsDir: p.join(contents, 'Resources', 'migrations'),
    }
  }

  return {
    craftBinary: p.join(execDir, platform === 'win32' ? 'craft-runtime.exe' : 'craft-runtime'),
    webRoot: p.join(execDir, 'resources', 'web'),
    migrationsDir: p.join(execDir, 'resources', 'migrations'),
  }
}

/**
 * Where the app keeps what it remembers.
 *
 * Never beside the binary. An installed app lives somewhere the user cannot
 * write — `/Applications`, `C:\Program Files` — and is replaced wholesale on
 * update, so cleanup history stored inside it would be both unwritable and
 * disposable.
 *
 * `env` is passed in rather than read, because `%LOCALAPPDATA%` is the only
 * correct answer on Windows and a machine with folder redirection does not put
 * it under the home directory.
 */
export function dataDir(
  platform: DesktopPlatform,
  appName: string,
  home: string,
  env: Record<string, string | undefined> = {},
): string {
  if (platform === 'darwin')
    return path.posix.join(home, 'Library', 'Application Support', appName)

  if (platform === 'win32')
    return path.win32.join(env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local'), appName)

  // XDG, for the Linux build that does not exist yet but will land here first.
  return path.posix.join(env.XDG_DATA_HOME || path.posix.join(home, '.local', 'share'), appName)
}

/** How often to consult a flag table, in bytes. */
const PROBE_CHUNK = 1024 * 1024

/**
 * Whether a Craft runtime takes a given flag, without running it.
 *
 * Asks what the binary *supports* rather than what version it calls itself.
 * The flag appears in its own argument table, which is the fact a version
 * number was standing in for and cannot drift away from the behaviour. It also
 * works on a runtime that will not execute: macOS kills an unsigned Mach-O on
 * exec, so a `--version` probe read empty stdout and judged every flag
 * unsupported — which is what the pantry download looks like before the build
 * signs it.
 *
 * This was `grep -qa`, which Windows does not have, and the failure would have
 * been silent: `grep` missing means the spawn throws, the catch returns false,
 * and every flag reads as unsupported. The window would still open, plainly,
 * and nobody would know why.
 *
 * Read in chunks with an overlap rather than slurped whole, so a 14 MB runtime
 * costs a megabyte of memory and a flag spanning a chunk boundary is still
 * found.
 */
export function runtimeSupports(binaryPath: string, flag: string): boolean {
  const needle = Buffer.from(flag, 'utf8')
  let fd: number
  try {
    fd = fs.openSync(binaryPath, 'r')
  }
  catch {
    // A runtime that cannot be read is treated as incapable, which is the safe
    // answer for every flag the launcher asks about.
    return false
  }

  try {
    const overlap = needle.length - 1
    const buffer = Buffer.alloc(PROBE_CHUNK + overlap)
    let carried = 0
    let position = 0

    while (true) {
      const read = fs.readSync(fd, buffer, carried, PROBE_CHUNK, position)
      if (read === 0)
        return false

      const filled = carried + read
      if (buffer.subarray(0, filled).includes(needle))
        return true

      // Keep the tail, so a needle straddling the boundary is seen next pass.
      carried = Math.min(overlap, filled)
      buffer.copy(buffer, 0, filled - carried, filled)
      position += read
    }
  }
  catch {
    return false
  }
  finally {
    try { fs.closeSync(fd) }
    catch { /* already closed */ }
  }
}

export interface WindowOptions {
  url: string
  title: string
  width: number
  height: number
  devtools: boolean
}

/**
 * The arguments that open the app's window.
 *
 * The chrome is macOS-only, and deliberately so rather than incidentally. On
 * macOS, hiding the titlebar puts the window's own buttons over the page's
 * top-left corner, which is where this app's chrome belongs — and the icon
 * rail offsets its first button below them. Windows has no traffic lights to
 * offset against, and `--web-window-material` is an `NSVisualEffectView`: the
 * flag parses there and backs nothing, so asking for it would hide the
 * titlebar and leave a window with no chrome at all and no way to drag it.
 *
 * So Windows gets an ordinary titlebar. The launcher's own note on the
 * fallback path already describes the result: plain, but not broken.
 */
export function windowArgs(
  platform: DesktopPlatform,
  options: WindowOptions,
  supports: (flag: string) => boolean,
): string[] {
  const args = [options.url, '--title', options.title]

  if (platform === 'darwin' && supports('--titlebar-hidden')) {
    args.push('--titlebar-hidden')
    args.push(...(supports('--web-window-material')
      ? ['--web-window-material']
      : ['--web-sidebar-material', '--web-sidebar-width', '74', '--web-sidebar-material-opacity', '0.25']))
  }

  // Everything the page stores lives in `localStorage` — the colour mode read
  // before first paint, and every switch in the Settings window. Craft gives a
  // window a non-persistent store by default, which empties on quit and is not
  // shared between windows.
  if (supports('--persistent-storage'))
    args.push('--persistent-storage')

  args.push('--width', String(options.width), '--height', String(options.height))

  if (!options.devtools)
    args.push('--no-devtools')

  return args
}
