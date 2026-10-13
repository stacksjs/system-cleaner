#!/usr/bin/env bun
/**
 * Round two: which *spawn* denies Craft a COM apartment.
 *
 * Round one (`windows-webview-probe.ts`) tried six argument lists against the
 * shipped `craft.exe` on a Windows runner and all six produced a webview,
 * including this app's exact one. So the invocation is not the difference and
 * neither is the cross-compiled binary — what is left is how
 * `app/Desktop/launcher.ts` starts it.
 *
 * The launcher differs from round one's spawn in three ways, and this varies
 * them one at a time with the argument list held at the app's real one:
 *
 *  - **stdio**: the launcher inherits, round one piped.
 *  - **`windowsHide: true`**, which is `CREATE_NO_WINDOW`. Round one did not
 *    set it. It exists so Windows does not put a console window beside the app.
 *  - **the parent**: the launcher is a GUI-subsystem binary owning no console,
 *    so the handles it tells craft to inherit are not a console's. Round one's
 *    parent was `bun` with a console. This case compiles
 *    `windows-webview-gui-parent.ts` with `--windows-hide-console` and lets it
 *    do the spawning, so the condition is reproduced rather than described.
 *
 * The signal is the same as round one: the page fetches `/hit` when it runs,
 * which can only happen from inside a live webview. The GUI-parent case also
 * reports its own progress to `/parent`, because a process with no console
 * cannot tell us anything any other way — without that, "no webview" and
 * "the parent never managed to spawn anything" look identical.
 *
 * Every case is reported and none fail the run.
 *
 * Usage: bun scripts/windows-webview-spawn-probe.ts --exe <craft.exe> --label <name>
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import process from 'node:process'

const CASE_TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS || 45_000)
const POLL_MS = 200

/** The argument list `windowArgs` builds on Windows, held constant here. */
const APP_ARGS = ['{URL}', '--title', 'SystemCleaner', '--persistent-storage', '--width', '1400', '--height', '900', '--no-devtools']

type Spawn = 'piped' | 'inherit' | 'gui-parent'

interface Case {
  name: string
  spawn: Spawn
  windowsHide: boolean
  /**
   * What `--guard` requires of this case against the Craft the bundle ships.
   *
   * `loaded` is a promise to this app: these spawns work today and a change
   * that breaks one is a regression in something we control, so the guard
   * fails. `no-webview` only records the upstream bug — craft-native/craft#342
   * is unmerged, so `CREATE_NO_WINDOW` still costs the apartment. The day that
   * lands these start loading, which is good news and must not turn CI red; it
   * is reported as the news it is.
   */
  expect: 'loaded' | 'no-webview'
}

const CASES: Case[] = [
  // Round one's spawn, repeated here so this run carries its own control. If
  // this one stops loading, the machine changed and nothing else below means
  // what it would otherwise mean.
  { name: 'control: piped, no windowsHide', spawn: 'piped', windowsHide: false, expect: 'loaded' },
  { name: 'piped + windowsHide', spawn: 'piped', windowsHide: true, expect: 'no-webview' },
  { name: 'inherit + windowsHide', spawn: 'inherit', windowsHide: true, expect: 'no-webview' },
  { name: 'inherit, no windowsHide', spawn: 'inherit', windowsHide: false, expect: 'loaded' },
  // The launcher, as a binary with the launcher's own subsystem.
  { name: 'GUI parent (the launcher)', spawn: 'gui-parent', windowsHide: true, expect: 'no-webview' },
]

interface Outcome {
  name: string
  loaded: boolean
  elapsedMs: number
  exitCode: number | null
  signalCode: string | null
  comFailure: boolean
  /** Set when the case never ran, which must never read as a result. */
  skipped: string | null
  /** What the GUI parent managed to report about itself. */
  parentNotes: string[]
  detail: string
}

function usage(message: string): never {
  console.error(`${message}\nusage: bun scripts/windows-webview-spawn-probe.ts --exe <craft.exe> --label <name>`)
  process.exit(2)
}

function readArgs(): { exe: string, label: string, guard: boolean } {
  const argv = process.argv.slice(2)
  let exe = ''
  let label = ''
  let guard = false
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--exe')
      exe = argv[i += 1] ?? ''
    else if (argv[i] === '--label')
      label = argv[i += 1] ?? ''
    else if (argv[i] === '--guard')
      guard = true
    else
      usage(`unexpected argument ${argv[i]}`)
  }
  if (!exe)
    usage('--exe is required')
  if (!fs.existsSync(exe))
    usage(`no such file: ${exe}`)
  return { exe: path.resolve(exe), label: label || path.basename(exe), guard }
}

async function drain(stream: ReadableStream<Uint8Array> | undefined | null, into: string[]): Promise<void> {
  if (!stream)
    return
  const decoder = new TextDecoder()
  try {
    for await (const chunk of stream as AsyncIterable<Uint8Array>)
      into.push(decoder.decode(chunk, { stream: true }))
  }
  catch {
    // Closed under us when the child is killed.
  }
}

function killStrays(): void {
  for (const image of ['craft.exe', 'craft-runtime.exe', 'msedgewebview2.exe', 'gui-parent.exe']) {
    try {
      Bun.spawnSync(['taskkill', '/F', '/IM', image], { stdout: 'ignore', stderr: 'ignore' })
    }
    catch {
      // Nothing of that name, or not Windows.
    }
  }
}

function probePage(caseName: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>probe</title></head>
<body style="font:28px system-ui;padding:3rem">
<p>WebView2 spawn probe</p>
<p>${caseName.replace(/[<&]/g, '')}</p>
<script>fetch('/hit', { method: 'POST' })</script>
</body></html>`
}

/**
 * Compile the GUI-subsystem parent once.
 *
 * `--windows-hide-console` is what makes the resulting binary own no console,
 * which is the condition under test; it is also what the real launcher is
 * built with.
 */
function buildGuiParent(): string {
  const out = path.join(os.tmpdir(), 'gui-parent.exe')
  const source = path.join(import.meta.dir, 'windows-webview-gui-parent.ts')
  const built = Bun.spawnSync([
    process.execPath,
    'build',
    source,
    '--compile',
    // Explicit, because `--windows-hide-console` is refused unless the compile
    // target is Windows — it is not merely a hint the host can ignore. On the
    // Windows runner this is the host target anyway; naming it means the flag
    // combination cannot fail for that reason wherever this is run from.
    '--target=bun-windows-x64',
    '--windows-hide-console',
    '--outfile',
    out,
  ], { stdout: 'pipe', stderr: 'pipe' })
  if (!built.success) {
    const why = new TextDecoder().decode(built.stderr).trim() || new TextDecoder().decode(built.stdout).trim()
    throw new Error(`could not compile the GUI parent: ${why}`)
  }
  return out
}

async function runCase(exe: string, probe: Case, guiParent: string | null): Promise<Outcome> {
  let hitAt = 0
  const parentNotes: string[] = []
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
      if (url.pathname === '/parent') {
        parentNotes.push(url.searchParams.get('status') ?? '')
        return new Response('ok')
      }
      return new Response(probePage(probe.name), { headers: { 'content-type': 'text/html; charset=utf-8' } })
    },
  })

  const url = `http://127.0.0.1:${server.port}/probe`
  const command = probe.spawn === 'gui-parent'
    ? [guiParent as string, exe, url]
    : [exe, ...APP_ARGS.map(a => a.replace('{URL}', url))]

  const stdout: string[] = []
  const stderr: string[] = []

  console.error(`\n--- ${probe.name}`)
  console.error(`    ${command.map(c => path.basename(c)).join(' ')}`)
  console.error(`    stdio=${probe.spawn} windowsHide=${probe.windowsHide}`)

  // The GUI parent sets the launcher's options itself; for the direct cases
  // this is where they are varied.
  const stdio = probe.spawn === 'inherit' ? 'inherit' : 'pipe'
  // A spawn that throws is a case that could not be tested, not a case that
  // produced no webview, and the difference matters: the first is this
  // harness's problem and the second is the finding. Running the probe from a
  // non-Windows host hits exactly this, since the GUI parent now compiles to a
  // Windows binary that will not execute there.
  let child: Bun.Subprocess
  try {
    child = Bun.spawn(command, {
      cwd: path.dirname(exe),
      stdin: 'inherit',
      stdout: probe.spawn === 'gui-parent' ? 'pipe' : stdio,
      stderr: probe.spawn === 'gui-parent' ? 'pipe' : stdio,
      windowsHide: probe.windowsHide,
    })
  }
  catch (error) {
    server.stop(true)
    const why = error instanceof Error ? error.message : String(error)
    console.error(`    => COULD NOT SPAWN: ${why}`)
    return {
      name: probe.name,
      loaded: false,
      elapsedMs: 0,
      exitCode: null,
      signalCode: null,
      comFailure: false,
      skipped: `could not spawn: ${why}`,
      parentNotes: [],
      detail: why.slice(0, 160),
    }
  }
  void drain(child.stdout as ReadableStream<Uint8Array>, stdout)
  void drain(child.stderr as ReadableStream<Uint8Array>, stderr)

  const deadline = started + CASE_TIMEOUT_MS
  while (!hitAt && Date.now() < deadline) {
    // For the GUI-parent case the child exiting is not the end: it exits when
    // craft does, and craft exiting early is itself the failure being hunted.
    if (child.exitCode !== null || child.signalCode !== null) {
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
  const comFailure = /0x800401f0|CO_E_NOTINITIALIZED/i.test(output) || parentNotes.some(n => /0x800401f0/i.test(n))
  const interesting = output.split('\n').map(l => l.trim())
    .filter(l => /WebView2|CoInitializeEx|Loading URL/i.test(l)).slice(-1)[0] ?? ''
  const lastLine = output.split('\n').map(l => l.trim()).filter(Boolean).slice(-1)[0] ?? ''

  const outcome: Outcome = {
    name: probe.name,
    loaded: hitAt > 0,
    elapsedMs: hitAt ? hitAt - started : 0,
    exitCode,
    signalCode,
    comFailure,
    skipped: null,
    parentNotes,
    detail: (interesting || lastLine).slice(0, 160),
  }

  console.error(`    => ${outcome.loaded ? `WEBVIEW LOADED in ${outcome.elapsedMs}ms` : 'NO WEBVIEW'}`)
  for (const note of parentNotes)
    console.error(`    parent: ${note}`)
  if (output.trim()) {
    console.error('    --- child output ---')
    for (const line of output.split('\n').map(l => l.trimEnd()).filter(Boolean))
      console.error(`    ${line}`)
  }
  return outcome
}

async function main(): Promise<void> {
  const { exe, label, guard } = readArgs()

  // Compiled once, before any case runs: a failure here is a problem with this
  // harness, and it should not be mistaken for a failure of the last case.
  let guiParent: string | null = null
  try {
    guiParent = buildGuiParent()
    console.error(`GUI parent compiled to ${guiParent}`)
  }
  catch (error) {
    console.error(`${error instanceof Error ? error.message : String(error)}`)
  }

  console.error(`probing ${exe}`)
  console.error(`${CASES.length} cases, ${CASE_TIMEOUT_MS / 1000}s each\n`)

  const outcomes: Outcome[] = []
  for (const probe of CASES) {
    if (probe.spawn === 'gui-parent' && !guiParent) {
      outcomes.push({
        name: probe.name,
        loaded: false,
        elapsedMs: 0,
        exitCode: null,
        signalCode: null,
        comFailure: false,
        skipped: 'the GUI parent would not compile',
        parentNotes: [],
        detail: 'harness could not build the GUI parent',
      })
      continue
    }
    outcomes.push(await runCase(exe, probe, guiParent))
  }

  const rows = outcomes.map(o => [
    o.name,
    o.skipped ? 'NOT RUN' : o.loaded ? `loaded in ${o.elapsedMs}ms` : 'no webview',
    o.skipped
      ? o.skipped
      : o.comFailure
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
    console.error(`${name.padEnd(32)} ${verdict.padEnd(22)} ${note}`)

  for (const o of outcomes)
    console.error(`SPAWN ${label} | ${o.name} | ${o.skipped ? 'NOT_RUN' : o.loaded ? 'WEBVIEW_LOADED' : 'NO_WEBVIEW'}`)

  const summary = process.env.GITHUB_STEP_SUMMARY
  if (summary) {
    const lines = [
      `### spawn probe: ${label}`,
      '',
      '| spawn | result | note |',
      '| --- | --- | --- |',
      ...rows.map(([name, verdict, note]) => `| \`${name}\` | ${verdict} | ${note} |`),
      '',
    ]
    fs.appendFileSync(summary, `${lines.join('\n')}\n`)
  }

  const loaded = outcomes.filter(o => o.loaded).length
  const ran = outcomes.filter(o => !o.skipped).length
  console.error(`\n${loaded} of ${ran} spawns that ran produced a webview.`)

  if (guard)
    applyGuard(outcomes)
  // The case this exists for. If it could not run, the run proved nothing
  // about the launcher and should not be read as though it had.
  const launcher = outcomes.find(o => o.name.startsWith('GUI parent'))
  if (launcher?.skipped)
    console.error(`::error::the launcher case did not run: ${launcher.skipped}`)
}

/**
 * Hold the shipped runtime to what is known about it.
 *
 * Two different kinds of divergence, deliberately not treated alike:
 *
 *  - A case expected to load and did not. Those spawns work today; something
 *    this app controls has broken, or the Craft version it pins has regressed.
 *    That fails.
 *  - A case expected to fail and loaded. That is craft-native/craft#342 having
 *    landed in whatever Craft the bundle now pins, measured rather than
 *    assumed. Failing CI for it would be failing for good news, so it is
 *    reported as news — loudly, because several things should then change:
 *    this expectation, the `0x800401f0` tolerance in the window step, and the
 *    release notes that say the desktop app is macOS-only.
 *  - A case that could not run at all is a broken harness, not evidence, and
 *    fails too.
 */
function applyGuard(outcomes: Outcome[]): void {
  const byName = new Map(outcomes.map(o => [o.name, o]))
  const regressions: string[] = []
  const fixed: string[] = []

  for (const probe of CASES) {
    const outcome = byName.get(probe.name)
    if (!outcome || outcome.skipped) {
      regressions.push(`${probe.name}: did not run (${outcome?.skipped ?? 'no outcome'})`)
      continue
    }
    const expected = probe.expect === 'loaded'
    if (expected && !outcome.loaded)
      regressions.push(`${probe.name}: expected a webview, got none (${outcome.detail || 'no output'})`)
    if (!expected && outcome.loaded)
      fixed.push(`${probe.name}: loaded in ${outcome.elapsedMs}ms, where CO_E_NOTINITIALIZED was expected`)
  }

  for (const line of fixed) {
    console.error(`::warning::Craft now opens a webview under CREATE_NO_WINDOW — ${line}`)
  }
  if (fixed.length > 0) {
    console.error('::warning::craft-native/craft#342 appears to have landed. Drop the windowsHide expectations here, remove the 0x800401f0 tolerance from the window step, and the desktop app can ship on Windows.')
  }

  const summary = process.env.GITHUB_STEP_SUMMARY
  if (summary && (fixed.length > 0 || regressions.length > 0)) {
    const lines = [
      '### Windows webview guard',
      '',
      ...fixed.map(f => `- **Fixed upstream**: ${f}`),
      ...regressions.map(r => `- **Regression**: ${r}`),
      '',
    ]
    fs.appendFileSync(summary, `${lines.join('\n')}\n`)
  }

  if (regressions.length > 0) {
    for (const line of regressions)
      console.error(`::error::${line}`)
    throw new Error(`${regressions.length} spawn(s) that should work do not`)
  }
  console.error(fixed.length > 0
    ? 'guard: nothing regressed, and the upstream fix has landed.'
    : 'guard: the shipped runtime behaves exactly as recorded.')
}

main().catch((error) => {
  console.error(`spawn probe failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
