import { chmodSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

const cwd = resolve(import.meta.dir, '..')
const build = Bun.spawnSync(['./buddy', 'build:desktop'], { cwd, stdout: 'inherit', stderr: 'inherit' })
if (build.exitCode !== 0) process.exit(build.exitCode)

// Buddy copies the generated migrations from a private temporary directory.
// Installer owns the installed bundle, so its migrations must be traversable by the app user.
chmodSync(resolve(cwd, 'storage/framework/desktop-dist/resources/migrations'), 0o755)

const store = Bun.spawnSync(['./buddy', 'desktop:apple:package', '--skip-build', ...process.argv.slice(2)], {
  cwd,
  stdout: 'inherit',
  stderr: 'inherit',
})
process.exit(store.exitCode)
