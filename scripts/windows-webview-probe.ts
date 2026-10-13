#!/usr/bin/env bun
/**
 * Which difference stops Craft opening a window for *this* app on Windows.
 *
 * The bundle's window never opens: `CreateCoreWebView2EnvironmentWithOptions`
 * returns `CO_E_NOTINITIALIZED` (0x800401f0) and `craft.exe` exits. The cause
 * is not in dispute — craft never puts the calling thread in a COM apartment,
 * so it depends on something else in the process having done so, which is what
 * craft-native/craft#342 fixes.
 *
 * What *is* in dispute is why craft's own `windows-multi-window` CI job passes
 * on an unpatched build. Two candidates survived the cheap checks:
 *
 *  - **the invocation.** That job runs `craft.exe --url <u>`. This app runs
 *    `craft.exe <u> --title … --persistent-storage --width … --height …
 *    --no-devtools`.
 *  - **the build host.** That job builds `craft.exe` natively on Windows; the
 *    release this app downloads is cross-compiled from Linux.
 *
 * Ruled out already: the `WebView2Loader.dll` craft's CI pins from NuGet and
 * the one inside `craft-windows-x64.zip` are byte-identical (sha256
 * `c66e4a92…c5bc`), and `--core` in craft's `build:core` only changes the
 * working directory, so the CI and release builds use the same flags.
 *
 * This probe settles the first candidate, which is the one testable from here.
 * It serves a page that calls home when it loads, launches `craft.exe` with
 * one argument list after another, and records which lists produce a webview.
 * A page that fetches `/hit` can only do so from inside a running webview, so
 * a hit is proof the environment was created — stronger than asking Windows
 * whether a window exists, which a frameless or unpainted window can fail.
 *
 * Every case is reported and none of them fail the run: the result is the
 * table, and a case that errors is itself a finding. Only a usage mistake or a
 * missing binary exits non-zero.
 *
 * Usage: bun scripts/windows-webview-probe.ts --exe <craft.exe> --label <name>
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import process from 'node:process'

/**
 * How long a case may take before it counts as having produced no webview.
 *
 * Overridable, which is how this gets dry-run against a macOS craft before
 * being trusted on Windows: a harness that reports `NO_WEBVIEW` because of its
 * own bug would produce exactly the answer we are looking for.
 */
const CASE_TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS || 45_000)

/** How often the wait loop re-checks for the page's call home. */
const POLL_MS = 200

/**
 * The argument lists under test. `{URL}` is replaced with the probe page.
 *
 * Ordered so the two ends of the question come first — craft's CI invocation
 * and this app's — and the rest take them apart one flag at a time. The names
 * end up as row labels in the summary.
 */
const CASES: { name: string, args: string[] }[] = [
  // What craft's own passing CI job runs.
  { name: 'craft-ci: --url only', args: ['--url', '{URL}'] },
  // What this app's launcher runs, from `windowArgs` in app/Desktop/bundle.ts.
  {
    name: 'ours: positional + all flags',
    args: ['{URL}', '--title', 'SystemCleaner', '--persistent-storage', '--width', '1400', '--height', '900', '--no-devtools'],
  },
  // Positional URL and nothing else: isolates `--url` from the flags.
  { name: 'positional only', args: ['{URL}'] },
  // craft's invocation plus the one flag most likely to change a code path,
  // since it is the only one that changes what WebView2 is asked for.
  { name: '--url + --persistent-storage', args: ['--url', '{URL}', '--persistent-storage'] },
  // Ours without persistent storage, to see whether that flag alone carries it.
  {
    name: 'ours minus --persistent-storage',
    args: ['{URL}', '--title', 'SystemCleaner', '--width', '1400', '--height', '900', '--no-devtools'],
  },
  // Ours, but handing the URL over with `--url`, which is the only remaining
  // difference if the flags turn out to be innocent.
  {
    name: 'ours with --url',
    args: ['--url', '{URL}', '--title', 'SystemCleaner', '--persistent-storage', '--width', '1400', '--height', '900', '--no-devtools'],
  },
]

interface Outcome {
  name: string
  loaded: boolean
  /** Milliseconds until the page called home, when it did. */
  elapsedMs: number
  exitCode: number | null
  /** The COM error, when craft printed one. */
  comFailure: boolean
  /** Set when the process died of a signal rather than exiting. */
  signalCode: string | null
  /** The most useful line craft wrote, for the table. */
  detail: string
}

function usage(message: string): never {
  console.error(`${message}\nusage: bun scripts/windows-webview-probe.ts --exe <craft.exe> --label <name>`)
  process.exit(2)
}

function readArgs(): { exe: string, label: string } {
  const argv = process.argv.slice(2)
  let exe = ''
  let label = ''
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--exe')
      exe = argv[i += 1] ?? ''
    else if (argv[i] === '--label')
      label = argv[i += 1] ?? ''
    else
      usage(`unexpected argument ${argv[i]}`)
  }
  if (!exe)
    usage('--exe is required')
  if (!fs.existsSync(exe))
    usage(`no such file: ${exe}`)
  return { exe: path.resolve(exe), label: label || path.basename(exe) }
}

/**
 * Accumulate a child's output without blocking the wait loop.
 *
 * Reading the streams only after the process exits would lose the output of
 * every case that has to be killed on timeout — which is the interesting half.
 */
async function drain(stream: ReadableStream<Uint8Array> | undefined | null, into: string[]): Promise<void> {
  if (!stream)
    return
  const decoder = new TextDecoder()
  try {
    for await (const chunk of stream as AsyncIterable<Uint8Array>)
      into.push(decoder.decode(chunk, { stream: true }))
  }
  catch {
    // The stream closes under us when the process is killed. Not a finding.
  }
}

/** Leave nothing of this case running before the next one starts. */
function killStrays(): void {
  for (const image of ['craft.exe', 'msedgewebview2.exe']) {
    try {
      Bun.spawnSync(['taskkill', '/F', '/IM', image], { stdout: 'ignore', stderr: 'ignore' })
    }
    catch {
      // Not on Windows, or nothing of that name was running.
    }
  }
}

/**
 * The page craft is pointed at.
 *
 * It calls `/hit` the moment it runs, which is the whole signal: that fetch
 * happens inside the webview, so it cannot succeed unless the environment was
 * created and the document loaded. The body is visible text rather than an
 * empty document so a screenshot of a passing case shows something.
 */
function probePage(caseName: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>probe</title></head>
<body style="font:28px system-ui;padding:3rem">
<p>WebView2 probe</p>
<p>${caseName.replace(/[<&]/g, '')}</p>
<script>fetch('/hit', { method: 'POST' })</script>
</body></html>`
}

async function runCase(exe: string, probe: { name: string, args: string[] }): Promise<Outcome> {
  let hitAt = 0
  const started = Date.now()

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === '/hit') {
        if (!hitAt)
          hitAt = Date.now()
        return new Response('ok')
      }
      return new Response(probePage(probe.name), { headers: { 'content-type': 'text/html; charset=utf-8' } })
    },
  })

  const url = `http://127.0.0.1:${server.port}/probe`
  const args = probe.args.map(a => a.replace('{URL}', url))
  const stdout: string[] = []
  const stderr: string[] = []

  console.error(`\n--- ${probe.name}`)
  console.error(`    ${path.basename(exe)} ${args.join(' ')}`)

  const child = Bun.spawn([exe, ...args], {
    cwd: path.dirname(exe),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  void drain(child.stdout as ReadableStream<Uint8Array>, stdout)
  void drain(child.stderr as ReadableStream<Uint8Array>, stderr)

  const deadline = started + CASE_TIMEOUT_MS
  while (!hitAt && Date.now() < deadline) {
    // A craft that has exited will never load the page, so stop waiting for it.
    //
    // `signalCode` as well as `exitCode`, because a process killed by a signal
    // leaves the latter null: dry-running this against a macOS craft, which
    // dies of SIGTRAP outside an app bundle, sat out the whole timeout per
    // case while reporting the death as "still running".
    if (child.exitCode !== null || child.signalCode !== null) {
      // Give the drains a moment to deliver the reason it exited.
      await Bun.sleep(300)
      break
    }
    await Bun.sleep(POLL_MS)
  }

  const exitCode = child.exitCode
  const signalCode = child.signalCode
  try {
    child.kill()
  }
  catch {
    // Already gone.
  }
  await Bun.sleep(200)
  server.stop(true)
  killStrays()

  const output = `${stdout.join('')}${stderr.join('')}`
  const comFailure = /0x800401f0|CO_E_NOTINITIALIZED/i.test(output)
  const webview2Line = output.split('\n').map(l => l.trim())
    .filter(l => /WebView2|CoInitializeEx/i.test(l)).slice(-1)[0] ?? ''
  const lastLine = output.split('\n').map(l => l.trim()).filter(Boolean).slice(-1)[0] ?? ''

  const outcome: Outcome = {
    name: probe.name,
    loaded: hitAt > 0,
    elapsedMs: hitAt ? hitAt - started : 0,
    exitCode,
    signalCode,
    comFailure,
    detail: (webview2Line || lastLine).slice(0, 160),
  }

  console.error(`    => ${outcome.loaded ? `WEBVIEW LOADED in ${outcome.elapsedMs}ms` : 'NO WEBVIEW'}`)
  if (output.trim()) {
    console.error('    --- craft output ---')
    for (const line of output.split('\n').map(l => l.trimEnd()).filter(Boolean))
      console.error(`    ${line}`)
  }
  return outcome
}

async function main(): Promise<void> {
  const { exe, label } = readArgs()

  console.error(`probing ${exe}`)
  console.error(`${CASES.length} cases, ${CASE_TIMEOUT_MS / 1000}s each\n`)

  const outcomes: Outcome[] = []
  // Sequentially, because two craft processes racing for the same WebView2
  // user data folder would be testing the lock rather than the apartment.
  for (const probe of CASES)
    outcomes.push(await runCase(exe, probe))

  const rows = outcomes.map(o => [
    o.name,
    o.loaded ? `loaded in ${o.elapsedMs}ms` : 'no webview',
    o.comFailure
    ? '0x800401f0'
    : o.loaded
      ? '-'
      : o.signalCode
        ? `died of ${o.signalCode}`
        : o.exitCode !== null
          ? `exit ${o.exitCode}`
          : 'no exit within the timeout',
  ])

  console.error('\n=== RESULT ===')
  for (const [name, verdict, note] of rows)
    console.error(`${name.padEnd(34)} ${verdict.padEnd(22)} ${note}`)

  // One line per case, greppable from the workflow log whatever else is printed.
  for (const o of outcomes)
    console.error(`PROBE ${label} | ${o.name} | ${o.loaded ? 'WEBVIEW_LOADED' : 'NO_WEBVIEW'}`)

  const summary = process.env.GITHUB_STEP_SUMMARY
  if (summary) {
    const lines = [
      `### ${label}`,
      '',
      '| invocation | result | note |',
      '| --- | --- | --- |',
      ...rows.map(([name, verdict, note]) => `| \`${name}\` | ${verdict} | ${note} |`),
      '',
    ]
    fs.appendFileSync(summary, `${lines.join('\n')}\n`)
  }

  const loaded = outcomes.filter(o => o.loaded).length
  console.error(`\n${loaded} of ${outcomes.length} invocations produced a webview.`)
}

main().catch((error) => {
  console.error(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
