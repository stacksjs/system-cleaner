import { describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { bundleLayout, dataDir, runtimeSupports, windowArgs } from '../app/Desktop/bundle'

/**
 * The launcher's platform decisions, asserted from whichever machine runs the
 * suite.
 *
 * These lived inline in `launcher.ts`, which starts a server and opens a
 * window as a side effect of being loaded — so none of it could be imported
 * and checked, and the macOS assumptions in it were invisible until someone
 * tried to assemble a Windows bundle. Every one of them is now a pure function
 * over an exec path and a platform name.
 *
 * See stacksjs/system-cleaner#23.
 */

describe('bundleLayout', () => {
  it('reads the prescribed shape on macOS', () => {
    const exec = '/Applications/SystemCleaner.app/Contents/MacOS/SystemCleaner'
    const layout = bundleLayout(exec, 'darwin')

    expect(layout.craftBinary).toBe('/Applications/SystemCleaner.app/Contents/MacOS/craft-runtime')
    expect(layout.webRoot).toBe('/Applications/SystemCleaner.app/Contents/Resources/web')
    expect(layout.migrationsDir).toBe('/Applications/SystemCleaner.app/Contents/Resources/migrations')
  })

  /**
   * Windows prescribes no bundle shape, so the layout is flat: the directory
   * the user unzipped. Inventing a `Contents/MacOS` there would have been
   * consistent and meaningless.
   */
  it('is flat on Windows, and names the runtime with its extension', () => {
    const exec = 'C:\\Program Files\\SystemCleaner\\SystemCleaner.exe'
    const layout = bundleLayout(exec, 'win32')

    // `.exe`, because `Bun.spawn` on Windows will not find an extensionless
    // file and the failure is an ENOENT at launch with nothing on screen.
    expect(layout.craftBinary).toContain('craft-runtime.exe')
    expect(layout.craftBinary).toContain('SystemCleaner')
    expect(layout.webRoot).toContain('resources')
    expect(layout.webRoot).toContain('web')
    // No macOS scaffolding anywhere in it.
    for (const p of Object.values(layout))
      expect(p, p).not.toContain('Contents')
  })

  it('keeps the runtime beside the executable on every platform', () => {
    const cases = [
      { platform: 'darwin', exec: '/opt/app/SystemCleaner', dir: '/opt/app' },
      { platform: 'win32', exec: 'C:\\app\\SystemCleaner.exe', dir: 'C:\\app' },
      { platform: 'linux', exec: '/opt/app/SystemCleaner', dir: '/opt/app' },
    ] as const

    for (const { platform, exec, dir } of cases) {
      const flavour = platform === 'win32' ? path.win32 : path.posix
      expect(flavour.dirname(bundleLayout(exec, platform).craftBinary), platform).toBe(dir)
    }
  })
})

describe('dataDir', () => {
  it('uses Application Support on macOS', () => {
    expect(dataDir('darwin', 'SystemCleaner', '/Users/glenn')).toBe(
      '/Users/glenn/Library/Application Support/SystemCleaner',
    )
  })

  /**
   * `%LOCALAPPDATA%`, not a path built under the home directory: a machine
   * with folder redirection does not put it there, and writing cleanup history
   * to the wrong volume is the sort of thing nobody notices until a roaming
   * profile syncs a SQLite file.
   */
  it('honours LOCALAPPDATA on Windows', () => {
    expect(dataDir('win32', 'SystemCleaner', 'C:\\Users\\glenn', {
      LOCALAPPDATA: 'D:\\Redirected\\glenn\\AppData\\Local',
    })).toBe('D:\\Redirected\\glenn\\AppData\\Local\\SystemCleaner')
  })

  it('falls back to a real path when LOCALAPPDATA is unset', () => {
    const d = dataDir('win32', 'SystemCleaner', 'C:\\Users\\glenn', {})
    expect(path.win32.isAbsolute(d)).toBe(true)
    expect(d).toBe('C:\\Users\\glenn\\AppData\\Local\\SystemCleaner')
  })

  it('never puts data inside the bundle', () => {
    // The whole reason this is not `dirname(execPath)`: an installed app is
    // unwritable and is replaced wholesale on update.
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      const d = dataDir(platform, 'SystemCleaner', platform === 'win32' ? 'C:\\Users\\glenn' : '/Users/glenn', {})
      expect(d).not.toContain('Program Files')
      expect(d).not.toContain('/Applications/')
    }
  })
})

describe('windowArgs', () => {
  const base = { url: 'http://127.0.0.1:1234/app', title: 'SystemCleaner', width: 1400, height: 900, devtools: false }
  const all = () => true
  const none = () => false

  it('asks for the app chrome on macOS when the runtime can host it', () => {
    const args = windowArgs('darwin', base, all)
    expect(args).toContain('--titlebar-hidden')
    expect(args).toContain('--web-window-material')
  })

  it('falls back to the sidebar material on an older macOS runtime', () => {
    const args = windowArgs('darwin', base, f => f !== '--web-window-material')
    expect(args).toContain('--titlebar-hidden')
    expect(args).toContain('--web-sidebar-material')
    expect(args).not.toContain('--web-window-material')
  })

  it('opens a plain titlebar on macOS when the runtime cannot host chrome', () => {
    const args = windowArgs('darwin', base, none)
    expect(args).not.toContain('--titlebar-hidden')
  })

  /**
   * The flag parses on Windows and backs nothing — `--web-window-material` is
   * an `NSVisualEffectView`, and there are no traffic lights for the icon rail
   * to offset against. Asking for a hidden titlebar there would produce a
   * window with no chrome at all and no way to drag it, so the probe passing
   * must not be enough on its own.
   */
  it('never hides the titlebar on Windows, even though the flag is in the binary', () => {
    const args = windowArgs('win32', base, all)
    expect(args).not.toContain('--titlebar-hidden')
    expect(args).not.toContain('--web-window-material')
    expect(args).not.toContain('--web-sidebar-material')
  })

  /**
   * `--system-tray` is not additive on Windows.
   *
   * Craft reads it as "this is a tray application", logs
   * `FailedToCreateWindow` and opens nothing — the app has no window at all,
   * which is how v0.3.9 shipped a Windows build that could not start. The
   * flag parses there, so the capability probe says yes and is not enough on
   * its own, exactly as with the titlebar above.
   */
  it('never asks for the tray on Windows, even though the flag is in the binary', () => {
    const args = windowArgs('win32', { ...base, tray: true }, all)
    expect(args).not.toContain('--system-tray')
    expect(args).not.toContain('--keep-running')
  })

  it('asks for the tray on macOS, and keeps the process alive for it', () => {
    // The two travel together: a status item that disappears with the window
    // is the one state a menu bar item must not have.
    const args = windowArgs('darwin', { ...base, tray: true }, all)
    expect(args).toContain('--system-tray')
    expect(args).toContain('--keep-running')
  })

  it('leaves the tray alone when the caller did not ask for it', () => {
    expect(windowArgs('darwin', base, all)).not.toContain('--system-tray')
  })

  it('still keeps page storage on Windows', () => {
    // Everything the app remembers on the page's side is in localStorage, and
    // Craft's default store is emptied on quit.
    expect(windowArgs('win32', base, all)).toContain('--persistent-storage')
  })

  it('puts the url first, which is what craft reads as its target', () => {
    for (const platform of ['darwin', 'win32'] as const)
      expect(windowArgs(platform, base, all)[0]).toBe(base.url)
  })

  it('suppresses devtools unless asked', () => {
    expect(windowArgs('win32', base, all)).toContain('--no-devtools')
    expect(windowArgs('win32', { ...base, devtools: true }, all)).not.toContain('--no-devtools')
  })
})

describe('runtimeSupports', () => {
  it('finds a flag in the real runtime this bundle ships', () => {
    const craft = 'pantry/craft-native.org/v0.0.90/bin/craft'
    if (!fs.existsSync(craft)) return
    expect(runtimeSupports(craft, '--titlebar-hidden')).toBe(true)
    expect(runtimeSupports(craft, '--no-such-flag-anywhere')).toBe(false)
  })

  /**
   * This was `grep -qa`, which Windows does not have — and the failure would
   * have been silent rather than loud: the spawn throws, the catch returns
   * false, every flag reads as unsupported, and the window opens plainly with
   * nobody knowing why.
   */
  it('reads the file itself rather than shelling out', async () => {
    const src = await Bun.file('app/Desktop/bundle.ts').text()
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code).not.toContain('grep')
    expect(code).not.toContain('spawn')
  })

  it('finds a flag that straddles a chunk boundary', () => {
    // The chunked read carries an overlap for exactly this case. One megabyte
    // of filler, then the needle split across the seam.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-probe-'))
    try {
      const file = path.join(dir, 'fake-runtime')
      const flag = '--titlebar-hidden'
      const pad = Buffer.alloc(1024 * 1024 - 5, 0x41)
      fs.writeFileSync(file, Buffer.concat([pad, Buffer.from(flag, 'utf8'), Buffer.alloc(32, 0x42)]))
      expect(runtimeSupports(file, flag)).toBe(true)
    }
    finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('treats an unreadable runtime as incapable', () => {
    // The safe answer for every flag the launcher asks about.
    expect(runtimeSupports('/no/such/runtime', '--titlebar-hidden')).toBe(false)
  })
})
