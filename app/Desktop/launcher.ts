/* eslint-disable ts/no-top-level-await, no-console */
/**
 * `Contents/MacOS/SystemCleaner` — the executable macOS actually launches.
 *
 * The Stacks desktop launcher (`@stacksjs/desktop-build`) opens a Craft window
 * on a remote URL, which is right for a hosted Stacks app and wrong for this
 * one: SystemCleaner inspects the Mac it is installed on, so the thing behind
 * the window has to be a server running *here*.
 *
 * So this launcher owns the whole lifecycle:
 *   1. start the bundled agent server on a loopback port the OS picks,
 *   2. wait until it answers,
 *   3. open the Craft window on it,
 *   4. shut the server down when the window closes.
 *
 * Step 4 is the one worth being careful about. Without it, quitting the app
 * leaves a process holding an HTTP port and a SQLite handle, and the next
 * launch inherits both.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import process from 'node:process'

/**
 * One executable, three jobs.
 *
 * `bun build --compile` writes a ~60 MB file whatever you compile: sixty of
 * those megabytes are the Bun runtime, and the entrypoint is a rounding error
 * on top. This app shipped three of them — launcher, agent, scanner — so the
 * bundle carried three copies of the same runtime and weighed 230 MB, of which
 * about 180 MB was that duplication. The Craft runtime, which is the part
 * people expect to be big, is 13 MB.
 *
 * So the agent and the scanner are subcommands of this binary rather than
 * binaries of their own. Both were already spawned as child processes with
 * their input in argv, so nothing about how they run changed — only which file
 * gets executed.
 *
 * This has to come before anything else at module scope: the launcher's own
 * body starts a server and opens a window as a side effect of loading.
 */
const subcommand = process.argv[2]

if (subcommand === 'agent' || subcommand === 'scan') {
  if (subcommand === 'agent') {
    // Returns as soon as the server is listening; `Bun.serve` is what keeps the
    // process alive from then on. An earlier draft called `process.exit(0)`
    // here, which killed the agent one line after it had printed the port the
    // launcher was still waiting to connect to — the launcher then timed out
    // with "the agent server never became healthy", which is true and says
    // nothing about why.
    const { runAgent } = await import('./server')
    await runAgent()
  }
  else {
    // Always exits the process. The request is argv[3], behind the subcommand.
    const { runScannerCli } = await import('../Workers/disk-scan')
    await runScannerCli(process.argv[3] ?? '')
  }

  // Everything below this point is the launcher, and a subcommand must never
  // reach it — falling through would have the agent spawn a second agent and
  // open a window. Parking here suspends module evaluation for good; the
  // process stays alive on the server's own handle.
  await new Promise(() => {})
}

const APP_NAME = 'SystemCleaner'

/** How long the server gets to bind and answer before the launcher gives up. */
const STARTUP_TIMEOUT_MS = 20_000
const POLL_INTERVAL_MS = 100

const macosDir = path.dirname(process.execPath)
const contentsDir = path.dirname(macosDir)

const craftBinary = path.join(macosDir, 'craft-runtime')
const webRoot = path.join(contentsDir, 'Resources/web')
const migrationsDir = path.join(contentsDir, 'Resources/migrations')

/**
 * Application data lives in `~/Library/Application Support`, not next to the
 * binary. A `.app` in `/Applications` is not writable by the user, and it gets
 * replaced wholesale on update — cleanup history stored inside it would be
 * both unwritable and disposable.
 */
const dataDir = path.join(os.homedir(), 'Library/Application Support', APP_NAME)
const databasePath = path.join(dataDir, 'system-cleaner.sqlite')

function fail(message: string): never {
  console.error(`[${APP_NAME}] ${message}`)
  process.exit(1)
}

for (const [label, target] of [
  ['Craft runtime', craftBinary],
  ['web payload', webRoot],
] as const) {
  if (!fs.existsSync(target))
    fail(`${label} missing from the app bundle: ${target}`)
}

fs.mkdirSync(dataDir, { recursive: true })

const agent = Bun.spawn([process.execPath, 'agent'], {
  stdout: 'pipe',
  stderr: 'inherit',
  env: {
    ...process.env,
    APP_ENV: 'production',
    NODE_ENV: 'production',
    // The control plane in `routes/api.ts` is registered only for the local
    // agent. This build is a production build *and* the local agent, which is
    // exactly the case the flag exists to express.
    SYSTEM_CLEANER_AGENT: '1',
    SYSTEM_CLEANER_WEB_ROOT: webRoot,
    SYSTEM_CLEANER_MIGRATIONS: migrationsDir,
    SYSTEM_CLEANER_PORT: '0',
    DB_CONNECTION: 'sqlite',
    DB_DATABASE_PATH: databasePath,
  },
})

let shuttingDown = false

function stopAgent(): void {
  if (shuttingDown)
    return
  shuttingDown = true
  try {
    agent.kill()
  }
  catch {
    // Already gone.
  }
}

process.on('exit', stopAgent)
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => {
    stopAgent()
    process.exit(0)
  })
}

/**
 * Read the port off the server's first line of output.
 *
 * Asking the OS for a free port and reading back what it gave us beats picking
 * a fixed one: a fixed port collides with whatever else the user happens to be
 * running, and a second copy of the app.
 */
async function readPort(): Promise<number> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS
  const decoder = new TextDecoder()
  let buffered = ''

  for await (const chunk of agent.stdout as ReadableStream<Uint8Array>) {
    buffered += decoder.decode(chunk, { stream: true })
    const match = buffered.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/)
    if (match)
      return Number(match[1])
    if (Date.now() > deadline)
      break
  }

  fail('the agent server did not report a port')
}

async function waitForHealth(port: number): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/__health`)
      if (res.ok)
        return
    }
    catch {
      // Not up yet.
    }
    await Bun.sleep(POLL_INTERVAL_MS)
  }

  fail('the agent server never became healthy')
}

const port = await readPort()
await waitForHealth(port)

/**
 * Whether the bundled runtime can host this app's chrome.
 *
 * Hiding the titlebar puts the window's own buttons over the page's top-left
 * corner, which is where this app's chrome belongs — every Mac app with a
 * sidebar carries them there rather than in a strip above it. Two things have
 * to be true of the runtime for that to work:
 *
 *   1. It measures its window buttons and publishes where they are, so the
 *      icon rail can start its first button below them instead of under them.
 *   2. It serves `window.startDrag`, which is the only way the page can move a
 *      window that has no titlebar. WebKit does not implement
 *      `-webkit-app-region: drag` — a WKWebView discards the declaration — so
 *      without `startDrag` a titlebar-less window cannot be moved at all.
 *
 * This used to ask the binary its version and compare it against the release
 * that introduced both. That works for the runtime this app ships, which is
 * signed during the bundle build and answers `--version` properly. It does not
 * work for one that is not yet signed: macOS kills an unsigned Mach-O on exec,
 * so the probe reads an empty stdout, the regex finds no version, and the
 * runtime is judged incapable. The pantry download behaves exactly that way
 * before the build signs it, and a local `zig build` reports 0.0.0. In both
 * cases the answer is "no titlebar-hidden", and the window comes up with an
 * ordinary titlebar and no buttons over the rail.
 *
 * So ask the binary what it *supports* rather than what it is called, without
 * running it at all. The flag name appears in its own argument table, which is
 * the fact the version number was standing in for and cannot drift away from
 * the behaviour. A runtime that cannot be read is treated as incapable: a
 * window with a titlebar is the wrong look, and a window that cannot be moved
 * is a broken app.
 */
function runtimeCanHostChrome(): boolean {
  try {
    // `grep -q` on the binary, rather than reading 13 MB into this process to
    // search it. Exit code 0 means the flag is in the runtime's option table.
    const probe = Bun.spawnSync(['grep', '-qa', '--', '--titlebar-hidden', craftBinary])
    return probe.exitCode === 0
  }
  catch {
    return false
  }
}

/**
 * The vibrancy behind the icon rail.
 *
 * Hiding the titlebar puts the real window buttons over the rail's top-left
 * corner, which is the right half of the arrangement. The other half is what
 * they sit ON. In Finder the buttons rest on a translucent sidebar that is
 * visibly a different surface from the content beside it; here the rail was
 * the same flat fill as the page, so three AppKit buttons floated on a white
 * rectangle and the corner read as a web page wearing a Mac window's buttons.
 * They are the genuine article — they show the ×/−/⤢ glyphs on hover and grey
 * out when the window loses focus — but nothing around them said so.
 *
 * `--web-sidebar-material` puts an NSVisualEffectView behind the leftmost
 * strip of the web view, which is exactly the surface Finder's buttons sit on.
 * The dev runner has been passing it all along, from the framework's defaults,
 * which is why the window has looked right under `buddy dev` and wrong once
 * installed — the launcher this app substitutes for the framework's never
 * carried it across.
 *
 * The width is the rail's own 74px rather than the 286px default, which is
 * sized for a sidebar with labels in it. The tint is what the material is
 * washed with: the framework's 0.78 washes it almost white, and
 * Finder's sidebar is plainly greyer and more translucent than the pane beside
 * it. 0.25 lands on that, and the window buttons read as buttons sitting on a
 * sidebar rather than on a white page.
 *
 * The page has to get out of the way for any of this to be visible — an opaque
 * `.app-chrome` covers the material completely. It does that by keying on the
 * marker Craft stamps on the root element when this flag is on, so a browser,
 * which has no material to show, keeps its ordinary fill.
 */
const SIDEBAR_MATERIAL = [
  '--web-sidebar-material',
  '--web-sidebar-width',
  '74',
  '--web-sidebar-material-opacity',
  '0.25',
]

const craft = Bun.spawn([
  craftBinary,
  `http://127.0.0.1:${port}/app`,
  '--title',
  APP_NAME,
  ...(runtimeCanHostChrome() ? ['--titlebar-hidden', ...SIDEBAR_MATERIAL] : []),
  '--width',
  '1400',
  '--height',
  '900',
  '--no-devtools',
], {
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
})

const code = await craft.exited
stopAgent()
process.exit(code)
