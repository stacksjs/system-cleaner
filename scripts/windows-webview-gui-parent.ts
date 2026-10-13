#!/usr/bin/env bun
/**
 * A stand-in for `app/Desktop/launcher.ts`, built to be compiled.
 *
 * Round one of the experiment showed the shipped `craft.exe` creates a
 * WebView2 environment with this app's exact arguments, which left how the
 * launcher *spawns* it as the only remaining difference. The launcher is a
 * GUI-subsystem binary that owns no console, and it spawns craft with
 * inherited stdio and `windowsHide: true`.
 *
 * `bun build --compile --windows-hide-console` turns this file into a binary
 * with the same two properties, so the spawn under test is the real one rather
 * than a description of it. Everything the launcher does that cannot matter —
 * the agent, the health wait, the port file — is left out.
 *
 * Writes nothing to stdout worth reading: a GUI-subsystem process has no
 * console to write to, which is the point. The verdict travels over HTTP, the
 * same way the page's does.
 *
 * Usage: windows-webview-gui-parent <craft.exe> <url>
 */

import process from 'node:process'
import path from 'node:path'

const [craftBinary, url] = process.argv.slice(2)

if (!craftBinary || !url)
  process.exit(2)

const report = (status: string): Promise<unknown> =>
  fetch(`${new URL(url).origin}/parent?status=${encodeURIComponent(status)}`, { method: 'POST' })
    .catch(() => undefined)

// The argument list `windowArgs` builds for Windows, inlined so this binary
// carries no dependency on the app's own modules.
const args = [
  url,
  '--title',
  'SystemCleaner',
  '--persistent-storage',
  '--width',
  '1400',
  '--height',
  '900',
  '--no-devtools',
]

try {
  const craft = Bun.spawn([craftBinary, ...args], {
    cwd: path.dirname(craftBinary),
    // Exactly the launcher's options: inherited stdio from a process with no
    // console, and CREATE_NO_WINDOW so Windows does not allocate one for the
    // console-subsystem child.
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
    windowsHide: true,
  })
  await report(`spawned pid ${craft.pid}`)
  const code = await craft.exited
  await report(`craft exited ${code}`)
}
catch (error) {
  await report(`spawn threw: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
