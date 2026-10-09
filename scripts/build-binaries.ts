#!/usr/bin/env bun
/* eslint-disable ts/no-top-level-await */
// Compiles the `system-cleaner` CLI into standalone binaries and zips each one
// for the GitHub release.
//
// The release workflow attaches exactly what this produces, so adding a target
// here is the only place that needs editing.
//
// macOS is the only RELEASE target. The CLI reads `~/Library`, `/Applications`
// and `df -k`, so a build for anywhere else compiles and then finds nothing on
// the first command.
//
// Windows is built but not released, behind --preview. Now that the CLI
// refuses a command the platform cannot carry out, that binary fails honestly:
// `system-cleaner clean` on Windows names the missing feature and exits 1,
// rather than reporting 0 B reclaimable and looking like a clean machine. That
// makes it worth compiling in CI, where it guards the toolchain and catches
// the next change that assumes a POSIX path. It is not worth shipping until
// the capability flags in @system-cleaner/core turn true.
// See stacksjs/system-cleaner#23.
//
// Apple silicon only, also on purpose: Bun stopped publishing a
// `bun-darwin-x64` runtime as of 1.4, so `--target=bun-darwin-x64` fails at
// the download step rather than producing an Intel binary. Re-add the target
// here if that ever comes back.

import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import process from 'node:process'

const RELEASE_TARGETS = [
  { target: 'bun-darwin-arm64', name: 'system-cleaner-darwin-arm64' },
] as const

const PREVIEW_TARGETS = [
  { target: 'bun-windows-x64', name: 'system-cleaner-windows-x64' },
] as const

const all: readonly { target: string, name: string }[]
  = process.argv.includes('--preview') ? [...RELEASE_TARGETS, ...PREVIEW_TARGETS] : RELEASE_TARGETS

// `--only <substring>` narrows to one target. The Windows CI leg builds only
// the Windows binary: cross-compiling the macOS one there costs a runtime
// download and proves nothing the macOS job has not already proven.
const onlyAt = process.argv.indexOf('--only')
const only = onlyAt === -1 ? null : process.argv[onlyAt + 1]
const TARGETS = only ? all.filter(t => t.target.includes(only)) : all

if (only && TARGETS.length === 0) {
  console.error(`[binaries] --only ${only} matched none of: ${all.map(t => t.target).join(', ')}`)
  process.exit(1)
}

const ROOT = process.cwd()
const ENTRY = path.join(ROOT, 'packages/cli/bin/system-cleaner.ts')
const OUT_DIR = path.join(ROOT, 'packages/cli/bin')

if (!fs.existsSync(ENTRY)) {
  console.error(`[binaries] entry not found: ${ENTRY}`)
  process.exit(1)
}

function run(cmd: string, args: string[]): void {
  const result = spawnSync(cmd, args, { stdio: 'inherit', cwd: ROOT })
  // `status` is null when the command could not be spawned at all, which reads
  // as "exited with undefined" and is how a missing `zip` first showed up.
  if (result.status !== 0)
    throw new Error(`${cmd} ${args.join(' ')} exited with ${result.status ?? `${result.error?.message ?? 'spawn failed'}`}`)
}

/**
 * Zip one file into a flat archive, with whatever this machine has.
 *
 * `zip` is not installed on windows-latest, and the failure is quiet: spawnSync
 * returns status null rather than throwing, so the build reported "exited with
 * undefined" after having compiled the binary successfully. PowerShell's
 * Compress-Archive ships with the runner and produces the same flat layout.
 */
function archiveFlat(file: string, archive: string): void {
  if (process.platform === 'win32') {
    run('powershell', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
      `Compress-Archive -Path '${file}' -DestinationPath '${archive}' -Force`,
    ])
    return
  }
  run('zip', ['-j', '-q', archive, file])
}

let built = 0

for (const { target, name } of TARGETS) {
  // Windows will not execute a file without the extension, and `bun build`
  // does not add one.
  const binary = path.join(OUT_DIR, target.includes('windows') ? `${name}.exe` : name)
  const archive = `${path.join(OUT_DIR, name)}.zip`

  console.warn(`[binaries] building ${name}`)
  run('bun', ['build', ENTRY, '--compile', `--target=${target}`, '--outfile', binary])

  // Flat archive, so extracting drops the binary in place rather than
  // recreating `packages/cli/bin/`.
  fs.rmSync(archive, { force: true })
  archiveFlat(binary, archive)
  fs.rmSync(binary, { force: true })

  const { size } = fs.statSync(archive)
  console.warn(`[binaries] ${path.basename(archive)} (${(size / 1e6).toFixed(1)} MB)`)
  built++
}

console.warn(`[binaries] ${built} archive(s) written to packages/cli/bin`)
