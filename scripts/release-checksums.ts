#!/usr/bin/env bun
/**
 * Rebuild a release's checksums over every asset actually attached to it.
 *
 * The release workflow attaches files from two jobs — the CLI archives from
 * `release`, the signed .dmg and `update.json` from `desktop` — and each asks
 * the pantry action for checksums. The action writes `checksums.txt` for the
 * files *it* uploaded, so the second job's two-asset file replaced the first
 * job's, and both v0.3.5 and v0.3.6 shipped with no published hash for the CLI
 * archives at all:
 *
 *     Release      Generated checksums.txt (sha256) for 2 asset(s)
 *     Desktop app  Generated checksums.txt (sha256) for 2 asset(s)   <- won
 *
 * `release-manifest.json` has the same hole for the same reason, so both are
 * rebuilt here.
 *
 * Deliberately re-uploads only those two small files. Re-attaching the
 * archives would be simpler — one more call to the action, with everything
 * listed — but it would churn 110 MB of release assets to fix 500 bytes, and a
 * partial failure there would cost a download rather than a hash.
 *
 * Usage: bun run scripts/release-checksums.ts <tag> [--dry-run]
 */

import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import process from 'node:process'

/** Files that describe the other assets, so they are never inputs to themselves. */
const MANIFESTS = new Set(['checksums.txt', 'release-manifest.json'])

const tag = process.argv[2]
const dryRun = process.argv.includes('--dry-run')

if (!tag || tag.startsWith('-')) {
  console.error('usage: bun run scripts/release-checksums.ts <tag> [--dry-run]')
  process.exit(1)
}

function gh(args: string[], cwd?: string): string {
  const proc = spawnSync('gh', args, { encoding: 'utf8', cwd })
  if (proc.status !== 0)
    throw new Error(`gh ${args.join(' ')} failed: ${proc.stderr?.trim() || `exit ${proc.status}`}`)
  return proc.stdout
}

const repo = process.env.GITHUB_REPOSITORY || JSON.parse(
  gh(['repo', 'view', '--json', 'nameWithOwner']),
).nameWithOwner

const release = JSON.parse(gh([
  'release', 'view', tag, '--repo', repo, '--json', 'assets,tagName',
])) as { assets: { name: string }[], tagName: string }

/**
 * The commit the tag points at.
 *
 * Resolved from the tag rather than taken from `targetCommitish`, which is the
 * *branch* a release was cut from and comes back as the literal string "main".
 * The first rebuilt manifest recorded `"commit": "main"` where the action had
 * written the real SHA — a manifest naming a moving branch instead of the
 * commit it describes is worse than one with a missing hash.
 */
function commitOf(): string {
  if (process.env.GITHUB_SHA)
    return process.env.GITHUB_SHA
  try {
    return JSON.parse(gh(['api', `repos/${repo}/commits/${tag}`, '--jq', '{sha:.sha}'])).sha
  }
  catch {
    return tag
  }
}

const subjects = release.assets.map(a => a.name).filter(n => !MANIFESTS.has(n)).sort()
if (subjects.length === 0) {
  console.error(`[checksums] ${tag} has no assets to checksum`)
  process.exit(1)
}

console.error(`[checksums] ${tag}: ${subjects.length} asset(s) to cover`)

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-checksums-'))

try {
  // One download call per asset rather than a bare `gh release download`: the
  // manifests must not come down, and re-hashing a stale local copy of one
  // would be the same bug in a new place.
  for (const name of subjects)
    gh(['release', 'download', tag, '--repo', repo, '-p', name, '-D', work, '--clobber'])

  function sha256(file: string): string {
    const hasher = new Bun.CryptoHasher('sha256')
    hasher.update(fs.readFileSync(file))
    return hasher.digest('hex')
  }

  interface Entry { name: string, size: number, sha256: string }
  const entries: Entry[] = subjects.map((name) => {
    const file = path.join(work, name)
    return { name, size: fs.statSync(file).size, sha256: sha256(file) }
  })

  // Two spaces between hash and name, sorted by name — the shape `sha256sum`
  // prints and the action produced, so an existing verification habit still
  // works.
  const checksumsPath = path.join(work, 'checksums.txt')
  fs.writeFileSync(checksumsPath, `${entries.map(e => `${e.sha256}  ${e.name}`).join('\n')}\n`)

  // The manifest lists `checksums.txt` too, which means it has to be hashed
  // after that file is written and before the manifest is.
  const manifest = {
    schemaVersion: 1,
    repository: repo,
    tag: release.tagName,
    commit: commitOf(),
    generatedAt: new Date().toISOString(),
    assets: [
      ...entries,
      {
        name: 'checksums.txt',
        size: fs.statSync(checksumsPath).size,
        sha256: sha256(checksumsPath),
      },
    ],
  }
  const manifestPath = path.join(work, 'release-manifest.json')
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  console.error('[checksums] checksums.txt')
  for (const e of entries) console.error(`  ${e.sha256}  ${e.name}`)

  if (dryRun) {
    console.error('[checksums] dry run: nothing uploaded')
    process.exit(0)
  }

  gh(['release', 'upload', tag, checksumsPath, manifestPath, '--repo', repo, '--clobber'])
  console.error(`[checksums] uploaded checksums.txt and release-manifest.json to ${tag}`)
}
finally {
  fs.rmSync(work, { recursive: true, force: true })
}
