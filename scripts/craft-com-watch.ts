#!/usr/bin/env bun
/**
 * Watch for the day Craft initialises COM, so nobody has to remember to look.
 *
 * The Windows desktop bundle builds and serves correctly and then opens no
 * window: `CreateCoreWebView2EnvironmentWithOptions` returns
 * `CO_E_NOTINITIALIZED` because `launcher.ts` spawns the runtime with
 * `CREATE_NO_WINDOW`, which takes away the console, and Craft never puts the
 * thread in a COM apartment itself. Measured in run 38393332113: building
 * Craft at craft-native/craft#342 and at its parent commit turns every
 * `CREATE_NO_WINDOW` failure into a loaded webview.
 *
 * So the app waits on that patch reaching a release. The regression guard in
 * `ci.yml` cannot announce it, because it probes the version
 * `build-desktop-windows.ts` pins — v0.0.100 — and will go on probing it
 * however many releases Craft cuts. This closes that gap from the other side:
 * it reads the newest release's `craft.exe` and answers whether the symbol is
 * there yet.
 *
 * Proof by import table rather than by running anything. A Windows binary
 * records every function it imports by name, so `ole32.dll: CoTaskMemFree`
 * alone means no call to `CoInitializeEx` exists anywhere in it — which is how
 * the bug was diagnosed in the first place, and it needs no Windows machine.
 *
 * Usage: bun scripts/craft-com-watch.ts [--repo owner/name] [--open-issue]
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import process from 'node:process'

/** The upstream repository, overridable so a fork can be checked. */
const DEFAULT_REPO = 'craft-native/craft'

/** The asset holding the Windows runtime. */
const ASSET = 'craft-windows-x64.zip'

/** The pull request that adds the call, reported alongside the release. */
const PATCH_PR = 342

/**
 * The import this binary has always had from `ole32`.
 *
 * Used as a control. If the parser cannot find even this, the answer is not
 * "COM is still uninitialised" — it is that the parse went wrong, or the
 * archive no longer holds what it used to, and a watcher that cannot tell
 * those apart from the news it exists to report is worse than no watcher. So
 * its absence fails the run rather than reading as "not fixed yet".
 */
const CONTROL_IMPORT = 'CoTaskMemFree'

/** What we are waiting for. */
const WANTED_IMPORT = 'CoInitializeEx'

interface Args { repo: string, openIssue: boolean }

function readArgs(): Args {
  const argv = process.argv.slice(2)
  let repo = DEFAULT_REPO
  let openIssue = false
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--repo')
      repo = argv[i += 1] ?? DEFAULT_REPO
    else if (argv[i] === '--open-issue')
      openIssue = true
    else {
      console.error(`unexpected argument ${argv[i]}`)
      process.exit(2)
    }
  }
  return { repo, openIssue }
}

async function api<T>(url: string): Promise<T> {
  const headers: Record<string, string> = {
    'accept': 'application/vnd.github+json',
    'user-agent': 'system-cleaner-craft-com-watch',
  }
  // Only to stay clear of the unauthenticated rate limit; every endpoint used
  // here is public.
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
  if (token)
    headers.authorization = `Bearer ${token}`
  const response = await fetch(url, { headers })
  if (!response.ok)
    throw new Error(`GET ${url} → ${response.status} ${response.statusText}`)
  return await response.json() as T
}

/**
 * The names a PE imports from one DLL.
 *
 * Walks the import directory: section headers to map a virtual address to a
 * file offset, then each descriptor's lookup table. Ordinal imports come back
 * as `#13` — they carry no name — which is worth seeing rather than hiding,
 * since a symbol imported by ordinal would not match a name search.
 */
export function importsFrom(binary: Uint8Array, dll: string): string[] {
  const view = new DataView(binary.buffer, binary.byteOffset, binary.byteLength)
  const peOffset = view.getUint32(0x3C, true)
  if (binary[peOffset] !== 0x50 || binary[peOffset + 1] !== 0x45)
    throw new Error('not a PE binary: no PE signature at e_lfanew')

  const sectionCount = view.getUint16(peOffset + 6, true)
  const optionalSize = view.getUint16(peOffset + 20, true)
  const optional = peOffset + 24
  const plus = view.getUint16(optional, true) === 0x20B
  const directories = optional + (plus ? 112 : 96)
  const importRva = view.getUint32(directories + 8, true)
  if (importRva === 0)
    return []

  const sections: { va: number, size: number, raw: number }[] = []
  let cursor = optional + optionalSize
  for (let i = 0; i < sectionCount; i += 1) {
    sections.push({
      size: Math.max(view.getUint32(cursor + 8, true), view.getUint32(cursor + 16, true)),
      va: view.getUint32(cursor + 12, true),
      raw: view.getUint32(cursor + 20, true),
    })
    cursor += 40
  }

  const offsetOf = (rva: number): number => {
    for (const s of sections) {
      if (rva >= s.va && rva < s.va + s.size)
        return s.raw + (rva - s.va)
    }
    throw new Error(`no section contains rva 0x${rva.toString(16)}`)
  }

  const stringAt = (offset: number): string => {
    let end = offset
    while (end < binary.length && binary[end] !== 0)
      end += 1
    return new TextDecoder().decode(binary.subarray(offset, end))
  }

  const names: string[] = []
  let descriptor = offsetOf(importRva)
  for (;;) {
    const lookup = view.getUint32(descriptor, true)
    const nameRva = view.getUint32(descriptor + 12, true)
    const address = view.getUint32(descriptor + 16, true)
    if (nameRva === 0 && address === 0)
      break

    if (stringAt(offsetOf(nameRva)).toLowerCase() === dll.toLowerCase()) {
      const step = plus ? 8 : 4
      let thunk = offsetOf(lookup || address)
      for (;;) {
        const value = plus ? view.getBigUint64(thunk, true) : BigInt(view.getUint32(thunk, true))
        if (value === 0n)
          break
        const ordinalFlag = plus ? 1n << 63n : 1n << 31n
        if (value & ordinalFlag)
          names.push(`#${value & 0xFFFFn}`)
        else
          // Past the two-byte hint that precedes the name.
          names.push(stringAt(offsetOf(Number(value)) + 2))
        thunk += step
      }
    }
    descriptor += 20
  }
  return names.sort()
}

/** Pull `craft.exe` out of the release archive. */
async function downloadRuntime(url: string): Promise<string> {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-com-watch-'))
  const archive = path.join(work, ASSET)
  const response = await fetch(url, { headers: { 'user-agent': 'system-cleaner-craft-com-watch' } })
  if (!response.ok)
    throw new Error(`GET ${url} → ${response.status}`)
  fs.writeFileSync(archive, new Uint8Array(await response.arrayBuffer()))

  const unzip = Bun.spawnSync(['unzip', '-o', '-q', archive, '-d', work])
  if (!unzip.success)
    throw new Error(`unzip failed: ${new TextDecoder().decode(unzip.stderr).trim()}`)

  const exe = path.join(work, 'craft.exe')
  if (!fs.existsSync(exe))
    throw new Error(`${ASSET} holds no craft.exe (${fs.readdirSync(work).join(', ')})`)
  return exe
}

interface Release { tag_name: string, html_url: string, assets: { name: string, browser_download_url: string }[] }
interface Pull { state: string, merged_at: string | null, html_url: string }

const TITLE = 'Craft initialises COM — bump the pin and ship the Windows desktop app'

function issueBody(tag: string, imports: string[], pull: Pull | null): string {
  return [
    `Craft **${tag}** imports \`${WANTED_IMPORT}\`, so its Windows runtime now puts the`,
    'calling thread in a COM apartment and the desktop window should open.',
    '',
    `    ole32.dll: ${imports.join(', ')}`,
    '',
    pull
      ? `craft-native/craft#${PATCH_PR} is ${pull.merged_at ? `merged (${pull.merged_at})` : pull.state.toLowerCase()}.`
      : `craft-native/craft#${PATCH_PR} could not be read.`,
    '',
    'What this unblocks, and what to change:',
    '',
    `1. Bump \`craft-native.org\` in \`deps.yaml\` to \`^${tag.replace(/^v/, '')}\`. Until then`,
    '   `scripts/build-desktop-windows.ts` keeps pinning v0.0.100 and nothing changes.',
    '2. CI\'s `Guard why the window does not open` will report the `windowsHide`',
    '   spawns loading where `CO_E_NOTINITIALIZED` was expected. Drop those',
    '   expectations in `scripts/windows-webview-spawn-probe.ts`.',
    '3. Remove the `0x800401f0` tolerance from the `Open the window and',
    '   photograph it` step, so a window failing to open is a hard failure again.',
    '4. Update `CHANGELOG.md` and the v0.3.7 release notes, which say the desktop',
    '   app is macOS-only pending craft-native/craft#335.',
    '',
    'Opened by `scripts/craft-com-watch.ts`, which reads the import table of each',
    'new release rather than running anything.',
  ].join('\n')
}

async function main(): Promise<void> {
  const { repo, openIssue } = readArgs()

  const release = await api<Release>(`https://api.github.com/repos/${repo}/releases/latest`)
  const asset = release.assets.find(a => a.name === ASSET)
  if (!asset)
    throw new Error(`${release.tag_name} has no ${ASSET} (${release.assets.map(a => a.name).join(', ')})`)

  const pull = await api<Pull>(`https://api.github.com/repos/${repo}/pulls/${PATCH_PR}`).catch(() => null)
  const exe = await downloadRuntime(asset.browser_download_url)
  const imports = importsFrom(new Uint8Array(fs.readFileSync(exe)), 'ole32.dll')

  console.error(`${repo} ${release.tag_name}`)
  console.error(`  ole32.dll: ${imports.join(', ') || '(nothing)'}`)
  if (pull)
    console.error(`  #${PATCH_PR}: ${pull.merged_at ? `merged ${pull.merged_at}` : pull.state}`)

  if (!imports.includes(CONTROL_IMPORT)) {
    throw new Error(
      `${release.tag_name} does not import ${CONTROL_IMPORT} from ole32 either, which it always has. `
      + 'Read this as a broken parse or a changed archive, not as an answer.',
    )
  }

  const fixed = imports.includes(WANTED_IMPORT)
  const summary = process.env.GITHUB_STEP_SUMMARY
  if (summary) {
    fs.appendFileSync(summary, `${[
      '### Craft COM watch',
      '',
      `| | |`,
      `| --- | --- |`,
      `| release | [${release.tag_name}](${release.html_url}) |`,
      `| \`ole32.dll\` imports | \`${imports.join(', ')}\` |`,
      `| \`${WANTED_IMPORT}\` | ${fixed ? '**present**' : 'not yet'} |`,
      `| craft-native/craft#${PATCH_PR} | ${pull ? (pull.merged_at ? 'merged' : pull.state.toLowerCase()) : 'unknown'} |`,
      '',
      fixed
        ? 'The Windows desktop app is unblocked: bump the pin in `deps.yaml`.'
        : 'Still waiting. Nothing to do.',
      '',
    ].join('\n')}\n`)
  }

  if (!fixed) {
    console.error('still waiting: no CoInitializeEx in the newest release.')
    return
  }

  console.error(`::notice::Craft ${release.tag_name} imports ${WANTED_IMPORT}. The Windows desktop app is unblocked.`)

  if (!openIssue) {
    console.error('(--open-issue not given, so no issue was filed)')
    return
  }

  // One issue, not one per day. A closed issue is a decision already taken, so
  // a search over open ones is what keeps this quiet afterwards.
  const existing = Bun.spawnSync(['gh', 'issue', 'list', '--state', 'open', '--search', `in:title ${TITLE}`, '--json', 'number'])
  const open = existing.success ? JSON.parse(new TextDecoder().decode(existing.stdout) || '[]') as { number: number }[] : []
  if (open.length > 0) {
    console.error(`already tracked in #${open[0].number}`)
    return
  }

  const created = Bun.spawnSync(['gh', 'issue', 'create', '--title', TITLE, '--body', issueBody(release.tag_name, imports, pull)])
  if (!created.success)
    throw new Error(`could not open an issue: ${new TextDecoder().decode(created.stderr).trim()}`)
  console.error(new TextDecoder().decode(created.stdout).trim())
}

// Only when run, never when imported: `importsFrom` is exported so it can be
// tested, and importing this file used to fetch a release as a side effect.
if (import.meta.main) {
  main().catch((error) => {
    console.error(`craft-com-watch failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  })
}
