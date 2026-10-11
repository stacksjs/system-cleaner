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
import { readRememberedPort, rememberPort } from '../Support/Runtime/agent-port'

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
    SYSTEM_CLEANER_PORT: String(readRememberedPort(portFile)),
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
rememberPort(portFile, port)
await waitForHealth(port)

const craft = Bun.spawn([
  craftBinary,
  ...windowArgs(platform, {
    url: `http://127.0.0.1:${port}/app`,
    title: APP_NAME,
    width: 1400,
    height: 900,
    devtools: process.env.SYSTEM_CLEANER_DEVTOOLS === '1',
  }, flag => probeRuntime(craftBinary, flag)),
], {
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
})

const code = await craft.exited
stopAgent()
process.exit(code)
