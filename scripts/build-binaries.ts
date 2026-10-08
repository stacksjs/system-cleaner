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

const TARGETS: readonly { target: string, name: string }[]
  = process.argv.includes('--preview') ? [...RELEASE_TARGETS, ...PREVIEW_TARGETS] : RELEASE_TARGETS

const ROOT = process.cwd()
const ENTRY = path.join(ROOT, 'packages/cli/bin/system-cleaner.ts')
const OUT_DIR = path.join(ROOT, 'packages/cli/bin')

if (!fs.existsSync(ENTRY)) {
  console.error(`[binaries] entry not found: ${ENTRY}`)
  process.exit(1)
}

function run(cmd: string, args: string[]): void {
  const result = spawnSync(cmd, args, { stdio: 'inherit', cwd: ROOT })
  if (result.status !== 0)
    throw new Error(`${cmd} ${args.join(' ')} exited with ${result.status}`)
}

let built = 0

for (const { target, name } of TARGETS) {
  // Windows will not execute a file without the extension, and `bun build`
  // does not add one.
  const binary = path.join(OUT_DIR, target.includes('windows') ? `${name}.exe` : name)
  const archive = `${path.join(OUT_DIR, name)}.zip`

  console.warn(`[binaries] building ${name}`)
  run('bun', ['build', ENTRY, '--compile', `--target=${target}`, '--outfile', binary])

  // `zip -j` keeps the archive flat so extracting drops the binary in place
  // rather than recreating `packages/cli/bin/`.
  fs.rmSync(archive, { force: true })
  run('zip', ['-j', '-q', archive, binary])
  fs.rmSync(binary, { force: true })

  const { size } = fs.statSync(archive)
  console.warn(`[binaries] ${path.basename(archive)} (${(size / 1e6).toFixed(1)} MB)`)
  built++
}

console.warn(`[binaries] ${built} archive(s) written to packages/cli/bin`)
