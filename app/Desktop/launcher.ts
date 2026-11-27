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
 *   1. start the bundled agent server on a loopback port — the one it used
 *      last time, or one the OS picks,
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
import { bundleLayout, dataDir as dataDirFor, runtimeSupports as probeRuntime, windowArgs } from './bundle'
import { createProcessShutdown } from '../Support/Runtime/process-shutdown'
import { readRememberedPort, rememberPort } from '../Support/Runtime/agent-port'
import { homeIsGranted, realHomeFolder } from '../../packages/core/src/sandbox'

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

/**
 * The platform this bundle was assembled for.
 *
 * Narrowed rather than cast: `process.platform` admits a dozen values this app
 * has no layout for, and `bundleLayout` must not be handed one of them and
 * silently return the POSIX shape.
 */
const platform = process.platform === 'darwin' || process.platform === 'win32' ? process.platform : 'linux'

const { craftBinary, webRoot, migrationsDir } = bundleLayout(process.execPath, platform)

/**
 * The Mac App Store edition turns this around. Apple's sandbox will not let a
 * helper put up a window of its own, so there Craft's App Store runtime is the
 * app's main executable and starts this binary as `craft-backend`, inside its
 * sandbox. This binary then starts the agent as usual and, instead of opening
 * a window, speaks Craft's bundle protocol: one loopback URL with a session
 * token on stdout, then stdin held open until the window goes away.
 */
const craftBackend = platform === 'darwin' && path.basename(process.execPath) === 'craft-backend'

/**
 * Application data lives beside the user's other application data, never next
 * to the binary. An installed app sits somewhere the user cannot write -
 * `/Applications`, `C:\\Program Files` - and is replaced wholesale on update,
 * so cleanup history stored inside it would be both unwritable and disposable.
 */
const dataDir = dataDirFor(platform, APP_NAME, os.homedir(), process.env)
const databasePath = path.join(dataDir, 'system-cleaner.sqlite')

/**
 * The port this app used last time.
 *
 * See `app/Support/Runtime/agent-port.ts` for why an app on a loopback port
 * has to keep the same one: the port is the page's origin, and an origin that
 * changes every launch empties everything the page has stored against it.
 */
const portFile = path.join(dataDir, 'agent-port')

function fail(message: string): never {
  console.error(`[${APP_NAME}] ${message}`)
  process.exit(1)
}

for (const [label, target] of [
  ...(craftBackend ? [] : [['Craft runtime', craftBinary]] as const),
  ['web payload', webRoot],
] as const) {
  if (!fs.existsSync(target))
    fail(`${label} missing from the app bundle: ${target}`)
}

fs.mkdirSync(dataDir, { recursive: true })

/**
 * In the App Store edition, where the agent looks for the person's files.
 *
 * The sandbox points `HOME` at this app's container, so every target under
 * `~/Library` would resolve inside it and come back empty. Once the person has
 * granted their home folder, Craft holds it open and lists it in
 * `CRAFT_SECURITY_SCOPED_PATHS`; this process and the agent inherit the
 * access, and pointing the agent's `HOME` at the real folder is all every
 * `os.homedir()` underneath needs. The database stays in the container: its
 * path above was computed from the container home and is passed explicitly.
 */
const sandboxHome: Record<string, string> = {}
if (craftBackend && process.env.APP_SANDBOX_CONTAINER_ID) {
  const realHome = realHomeFolder()
  sandboxHome.SYSTEM_CLEANER_REAL_HOME = realHome
  // Claimed only once it is true: a bookmark that resolved in Craft but whose
  // access did not reach this process would otherwise point the agent at a
  // folder it cannot read and bring back the empty figures this fixes.
  if (homeIsGranted()) {
    if (canRead(path.join(realHome, 'Library'))) {
      sandboxHome.HOME = realHome
      sandboxHome.SYSTEM_CLEANER_HOME_GRANTED = '1'
    }
    else {
      console.error(`[${APP_NAME}] ${realHome} is granted but not readable from the backend; scanning the container instead`)
    }
  }
}

function canRead(folder: string): boolean {
  try {
    fs.readdirSync(folder)
    return true
  }
  catch {
    return false
  }
}

const agent = Bun.spawn([process.execPath, 'agent'], {
  stdout: 'pipe',
  stderr: 'inherit',
  // Same binary, so it carries the GUI subsystem and shows nothing anyway -
  // set for the same reason as below, so neither spawn depends on that
  // happening to stay true.
  windowsHide: true,
  env: {
    ...process.env,
    APP_ENV: 'production',
    NODE_ENV: 'production',
    // The control plane in `routes/api.ts` is registered only for the local
    // agent. This build is a production build *and* the local agent, which is
    // exactly the case the flag exists to express.
    SYSTEM_CLEANER_AGENT: '1',
    SYSTEM_CLEANER_DESKTOP_SESSION: '1',
    SYSTEM_CLEANER_WEB_ROOT: webRoot,
    SYSTEM_CLEANER_MIGRATIONS: migrationsDir,
    SYSTEM_CLEANER_PORT: String(readRememberedPort(portFile)),
    DB_CONNECTION: 'sqlite',
    DB_DATABASE_PATH: databasePath,
    ...sandboxHome,
  },
})

let craft: Bun.Subprocess | null = null
const shutdown = createProcessShutdown(() => craft ? [agent, craft] : [agent])

process.on('exit', shutdown.force)
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => {
    void shutdown.stop().finally(() => process.exit(0))
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
const afterUpdate = platform === 'darwin' && process.argv.includes('--updated')
rememberPort(portFile, port)
await waitForHealth(port)

if (craftBackend) {
  // The agent's own output stays on its pipe, so this is the only line Craft
  // reads. The window is the main one: the App Store edition has no menu bar
  // popover to start from.
  // Craft accepts exactly `http://127.0.0.1:<port>/?session=<token>`; the
  // agent sends a request for that address on to the app.
  process.stdout.write(`http://127.0.0.1:${port}/?session=${crypto.randomUUID()}\n`)
  for await (const _chunk of Bun.stdin.stream()) {
    // Craft writes nothing; the stream ending is the signal.
  }
  await shutdown.stop()
  process.exit(0)
}

craft = Bun.spawn([
  craftBinary,
  ...windowArgs(platform, {
    url: `http://127.0.0.1:${port}/app${platform === 'darwin' ? '/tray' : ''}${afterUpdate ? '?updated=1' : ''}`,
    title: APP_NAME,
    width: platform === 'darwin' ? 360 : 1400,
    height: platform === 'darwin' ? 460 : 900,
    trayPopover: platform === 'darwin',
    devtools: process.env.SYSTEM_CLEANER_DEVTOOLS === '1',
    // With this on, `craft.exited` below no longer fires when the window
    // closes — only when the tray's Quit does. Which is what the shutdown
    // sequence after it already wanted: the agent is stopped when the app is
    // really going away, not when its window happens to be shut.
    tray: true,
  }, flag => probeRuntime(craftBinary, flag)),
], {
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
  // The launcher is a GUI-subsystem binary on Windows, so it owns no console.
  // `craft-runtime.exe` is a console-subsystem one, and Windows allocates a
  // fresh console for such a child unless told not to - which would put a
  // command prompt on screen beside the app window. Ignored on POSIX.
  windowsHide: true,
})

const code = await craft.exited
await shutdown.stop()
process.exit(code)
