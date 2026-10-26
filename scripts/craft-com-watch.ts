#!/usr/bin/env bun
/**
 * Watch for the day Craft stops initialising COM, so nobody has to remember to
 * look.
 *
 * Craft's Windows runtime opens no window unless it puts the calling thread in
 * a COM apartment: `CreateCoreWebView2EnvironmentWithOptions` returns
 * `CO_E_NOTINITIALIZED` because `launcher.ts` spawns it with
 * `CREATE_NO_WINDOW`, which takes the console away. Measured in run
 * 38393332113, where building Craft with and without the call turned every
 * such failure into a loaded webview. craft-native/craft@e2fc920f added it and
 * v0.0.175 shipped it, which is what `MIN_WINDOWS_CRAFT` pins.
 *
 * This watched for that arriving and now watches for it leaving. The regression
 * guard in `ci.yml` cannot: it probes the version `build-desktop-windows.ts`
 * pins, so it will stay green through any number of releases that drop the
 * call, and the news would arrive as a broken window the first time anyone
 * raised the floor. This reads the newest release instead, and says something
 * only when that release is at or above the floor and the symbol is gone.
 *
 * Proof by import table rather than by running anything. A Windows binary
 * records every function it imports by name, so `ole32.dll: CoTaskMemFree`
 * alone means no call to `CoInitializeEx` exists anywhere in it — which is how
 * the bug was diagnosed in the first place, and it needs no Windows machine.
 *
 * Usage: bun scripts/craft-com-watch.ts [--repo owner/name] [--release tag]
 *                                        [--open-issue]
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import process from 'node:process'

/** The upstream repository, overridable so a fork can be checked. */
const DEFAULT_REPO = 'craft-native/craft'

/** The asset holding the Windows runtime. */
const ASSET = 'craft-windows-x64.zip'

/** Where the floor this app pins is written, so there is only one of it. */
const FLOOR_SOURCE = 'scripts/build-desktop-windows.ts'

/**
 * The import this binary has always had from `ole32`.
 *
 * Used as a control. If the parser cannot find even this, the answer is not
 * "COM is still uninitialised" — it is that the parse went wrong, or the
 * archive no longer holds what it used to, and a watcher that cannot tell
 * those apart from the news it exists to report is worse than no watcher. So
 * its absence fails the run rather than reading as a regression.
 */
const CONTROL_IMPORT = 'CoTaskMemFree'

/** The call that earns the runtime a COM apartment. Shipped since v0.0.175. */
const REQUIRED_IMPORT = 'CoInitializeEx'

interface Args { repo: string, openIssue: boolean, release: string | null }

function readArgs(): Args {
  const argv = process.argv.slice(2)
  let repo = DEFAULT_REPO
  let openIssue = false
  // A specific tag, for reading a release that is not the newest — the only
  // way to watch this script reach a verdict it cannot otherwise reach, since
  // no release at or above the floor has dropped the call.
  let release: string | null = null
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--repo')
      repo = argv[i += 1] ?? DEFAULT_REPO
    else if (argv[i] === '--release')
      release = argv[i += 1] ?? null
    else if (argv[i] === '--open-issue')
      openIssue = true
    else {
      console.error(`unexpected argument ${argv[i]}`)
      process.exit(2)
    }
  }
  return { repo, openIssue, release }
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
const TITLE_SUFFIX = `dropped ${REQUIRED_IMPORT} — the Windows window will not open`

/**
 * The release is named in the title on purpose.
 *
 * The first version of this watcher deduplicated on open issues alone, so
 * closing its issue — which is what finishing the work looks like — let it
 * file the same one again the next morning (#24, then #25). A title naming the
 * release makes closing final for that release, and a later one that regresses
 * again gets an issue of its own.
 */
function titleFor(tag: string): string {
  return `Craft ${tag} ${TITLE_SUFFIX}`
}

/**
 * The Craft version `build-desktop-windows.ts` will accept, read out of the
 * source rather than copied here, so the two cannot drift apart.
 */
function floorPatch(): number {
  const source = fs.readFileSync(path.join(import.meta.dir, '..', FLOOR_SOURCE), 'utf8')
  const match = /^const MIN_WINDOWS_CRAFT = (\d+)$/m.exec(source)
  if (!match)
    throw new Error(`could not read MIN_WINDOWS_CRAFT from ${FLOOR_SOURCE}`)
  return Number(match[1])
}

/**
 * `v0.0.247` → 247. Craft has only ever moved the patch.
 *
 * A tag this cannot read fails the run. The floor comparison is the whole
 * judgement here, and a watcher that has quietly stopped understanding its
 * subject's version numbers would report good news for ever.
 */
function patchOf(tag: string): number {
  const match = /^v?0\.0\.(\d+)$/.exec(tag.trim())
  if (!match)
    throw new Error(`cannot read a patch version out of ${tag}; this script assumes Craft's 0.0.x scheme`)
  return Number(match[1])
}

/**
 * `regressed` is the only verdict worth waking anyone for.
 *
 * Pure and exported because it is the whole judgement, and no release at or
 * above the floor has dropped the call — so `tests/craft-com-watch.test.ts` is
 * the only place the regression verdict can actually be reached.
 */
export type Verdict = 'regressed' | 'initialises-com' | 'below-floor'

export function verdict(patch: number, floor: number, imports: string[]): Verdict {
  if (patch < floor)
    return 'below-floor'
  return imports.includes(REQUIRED_IMPORT) ? 'initialises-com' : 'regressed'
}

function issueBody(tag: string, imports: string[], floor: number): string {
  return [
    `Craft **${tag}** does not import \`${REQUIRED_IMPORT}\`, which its Windows runtime`,
    `has imported since v0.0.${floor}. Without it the runtime leaves the calling thread`,
    'outside any COM apartment, `CreateCoreWebView2EnvironmentWithOptions` returns',
    '`CO_E_NOTINITIALIZED` (0x800401f0) under the `CREATE_NO_WINDOW` spawn the',
    'launcher uses, and the desktop window never opens.',
    '',
    `    ole32.dll: ${imports.join(', ') || '(nothing)'}`,
    '',
    'Nothing is broken yet, which is the point of hearing it now:',
    `\`scripts/build-desktop-windows.ts\` pins v0.0.${floor}, so the shipped bundle is`,
    'unaffected until someone raises that floor past this release.',
    '',
    'What to check:',
    '',
    '1. Whether it is deliberate upstream. The call arrived in',
    '   craft-native/craft@e2fc920f, which closed craft-native/craft#335.',
    `2. \`MIN_WINDOWS_CRAFT\` in \`${FLOOR_SOURCE}\` — leave it below ${patchOf(tag)} until`,
    '   the runtime initialises COM again.',
    '3. `ci.yml`\'s spawn guard, which probes the pinned version and will stay',
    '   green through this. It is not a second opinion on this release.',
    '',
    'Opened by `scripts/craft-com-watch.ts`, which reads the import table of each',
    'new release rather than running anything.',
  ].join('\n')
}

async function main(): Promise<void> {
  const { repo, openIssue, release: wanted } = readArgs()
  const floor = floorPatch()

  const release = await api<Release>(wanted
    ? `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(wanted)}`
    : `https://api.github.com/repos/${repo}/releases/latest`)
  const asset = release.assets.find(a => a.name === ASSET)
  if (!asset)
    throw new Error(`${release.tag_name} has no ${ASSET} (${release.assets.map(a => a.name).join(', ')})`)

  const patch = patchOf(release.tag_name)
  const exe = await downloadRuntime(asset.browser_download_url)
  const imports = importsFrom(new Uint8Array(fs.readFileSync(exe)), 'ole32.dll')

  console.error(`${repo} ${release.tag_name} (floor v0.0.${floor})`)
  console.error(`  ole32.dll: ${imports.join(', ') || '(nothing)'}`)

  if (!imports.includes(CONTROL_IMPORT)) {
    throw new Error(
      `${release.tag_name} does not import ${CONTROL_IMPORT} from ole32 either, which it always has. `
      + 'Read this as a broken parse or a changed archive, not as an answer.',
    )
  }

  // A release below the floor says nothing about what this app ships.
  const answer = verdict(patch, floor, imports)
  const regressed = answer === 'regressed'

  const summary = process.env.GITHUB_STEP_SUMMARY
  if (summary) {
    fs.appendFileSync(summary, `${[
      '### Craft COM watch',
      '',
      `| | |`,
      `| --- | --- |`,
      `| release | [${release.tag_name}](${release.html_url}) |`,
      `| floor \`MIN_WINDOWS_CRAFT\` | v0.0.${floor} |`,
      `| \`ole32.dll\` imports | \`${imports.join(', ') || '(nothing)'}\` |`,
      `| \`${REQUIRED_IMPORT}\` | ${imports.includes(REQUIRED_IMPORT) ? '**present**' : '**gone**'} |`,
      '',
      regressed
        ? `${release.tag_name} would break the Windows window. The pin still holds it back.`
        : answer === 'initialises-com'
          ? 'The release initialises COM, as it has since the floor. Nothing to do.'
          : `${release.tag_name} is below the floor, so it decides nothing here.`,
      '',
    ].join('\n')}\n`)
  }

  if (!regressed) {
    console.error(answer === 'initialises-com'
      ? `${REQUIRED_IMPORT} is present, as expected. Nothing to do.`
      : `${release.tag_name} is below the v0.0.${floor} floor; nothing to judge.`)
    return
  }

  // An annotation rather than a failing exit: the issue is the thing that has
  // to be acted on, and it outlives a red run on a page nobody opens.
  console.error(`::error::Craft ${release.tag_name} dropped ${REQUIRED_IMPORT}. Do not raise MIN_WINDOWS_CRAFT past v0.0.${floor}.`)

  if (!openIssue) {
    console.error('(--open-issue not given, so no issue was filed)')
    return
  }

  // One issue per regressed release, closed or open — see `titleFor`. The
  // search is a prefilter; the title has to match exactly, so the issues from
  // this watcher's earlier life cannot pass for it.
  const title = titleFor(release.tag_name)
  const existing = Bun.spawnSync(['gh', 'issue', 'list', '--state', 'all', '--search', `in:title ${title}`, '--json', 'number,title,state', '--limit', '50'])
  const found = existing.success
    ? (JSON.parse(new TextDecoder().decode(existing.stdout) || '[]') as { number: number, title: string, state: string }[])
        .find(issue => issue.title === title)
    : undefined
  if (found) {
    console.error(`already filed as #${found.number} (${found.state.toLowerCase()})`)
    return
  }

  const created = Bun.spawnSync(['gh', 'issue', 'create', '--title', title, '--body', issueBody(release.tag_name, imports, floor)])
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
