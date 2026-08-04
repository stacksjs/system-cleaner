#!/usr/bin/env bun
/* eslint-disable ts/no-top-level-await */
// Compiles the `system-cleaner` CLI into standalone binaries and zips each one
// for the GitHub release.
//
// macOS targets only, on purpose: the CLI reads `~/Library`, `/Applications`,
// and `df -k` output, so a linux or windows build would compile and then fail
// on the first command. The release workflow attaches exactly what this
// produces, so adding a target here is the only place that needs editing.
//
// Apple silicon only, also on purpose: Bun stopped publishing a
// `bun-darwin-x64` runtime as of 1.4, so `--target=bun-darwin-x64` fails at
// the download step rather than producing an Intel binary. Re-add the target
// here if that ever comes back.

import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

const TARGETS = [
  { target: 'bun-darwin-arm64', name: 'system-cleaner-darwin-arm64' },
] as const

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
  const binary = path.join(OUT_DIR, name)
  const archive = `${binary}.zip`

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
