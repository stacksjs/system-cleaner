import type { PickierOptions } from 'pickier'

/**
 * Lint scope for SystemCleaner.
 *
 * Without a config, pickier walked 1063 files: the gitignored `pantry/`
 * dependency tree, the vendored browser runtimes under `public/`, the
 * framework defaults in `storage/framework/`, and the docs. CI failed on
 * every push against code this project does not own.
 *
 * Everything listed below is either not ours or not source:
 *   - `pantry/`               machine-local dependency checkout, gitignored
 *   - `storage/framework/`    framework internals, read-only per AGENTS.md
 *   - `public/*.js`           hand-minified browser runtimes shipped as-is
 *   - `docs/`, `*.md`         prose, linted by the docs build instead
 *   - `packages/cli/bin/`     compiled release artifacts
 */
const config: PickierOptions = {
  ignores: [
    '**/node_modules/**',
    '**/dist/**',
    '**/pantry/**',
    '**/storage/framework/**',
    'public/**',
    '**/public/**',
    '**/docs/**',
    '**/*.md',
    'packages/cli/bin/system-cleaner-*',
    '.shots/**',
  ],
}

export default config
