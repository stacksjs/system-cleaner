import { cli } from '@stacksjs/clapp'
import { capabilities, supports, unsupportedReason } from '@system-cleaner/core'
// The root manifest is the version `buddy release` bumps. Hardcoding it here
// meant every compiled binary reported 0.1.0 no matter which tag built it.
import { version } from '../../../package.json'
import { registerCleanCommand } from './commands/clean'
import { registerUninstallCommand } from './commands/uninstall'
import { registerDiskCommand } from './commands/disk'
import { registerMonitorCommand } from './commands/monitor'
import { registerScanCommand } from './commands/scan'
import { registerOptimizeCommand } from './commands/optimize'
import { registerPurgeCommand } from './commands/purge'
import { registerInstallerCommand } from './commands/installer'
import { registerCheckCommand } from './commands/check'
import { registerTouchIdCommand } from './commands/touchid'

/**
 * Which capability each command needs to do anything useful.
 *
 * A command missing from this map runs anywhere - `check` and `touchid` either
 * carry their own platform handling or have nothing to scan.
 */
const COMMAND_CAPABILITY: Record<string, keyof typeof capabilities> = {
  clean: 'cleanTargets',
  uninstall: 'appUninstall',
  disk: 'diskScan',
  monitor: 'processes',
  scan: 'diskScan',
  optimize: 'maintenance',
  purge: 'developerJunk',
}

/**
 * Refuse a command this platform cannot carry out, before it runs.
 *
 * Without this, a Windows build compiles and then every command quietly finds
 * nothing: `launchctl`, `mdfind` and `df -k` are not there, exec swallows the
 * failure, and `system-cleaner clean` reports 0 B reclaimable. In a tool whose
 * only claim is what it can reclaim, "nothing" is indistinguishable from
 * "already clean", and in a binary there is no UI to explain the difference.
 *
 * The desktop app has carried this since 0fce3ad; the CLI shipped without it,
 * which is the thing that has to be true before a .exe is worth producing.
 */
function refuseUnsupported(argv: string[]): boolean {
  const command = argv.find(a => !a.startsWith('-'))
  if (!command) return false

  const needs = COMMAND_CAPABILITY[command]
  if (!needs || supports(needs)) return false

  // stderr is the interface here. This runs before the CLI framework is built,
  // so clapp's logger does not exist yet, and the refusal has to reach the user
  // either way.
  // eslint-disable-next-line no-console
  console.error(`${unsupportedReason(needs)}\nSee https://github.com/stacksjs/system-cleaner/issues/23 for what is implemented where.`)
  return true
}

export function createCLI() {
  const app = cli('system-cleaner')
    .version(version)
    .help()

  // Register all commands
  registerCleanCommand(app)
  registerUninstallCommand(app)
  registerDiskCommand(app)
  registerMonitorCommand(app)
  registerScanCommand(app)
  registerOptimizeCommand(app)
  registerPurgeCommand(app)
  registerInstallerCommand(app)
  registerCheckCommand(app)
  registerTouchIdCommand(app)

  return app
}

export { refuseUnsupported }

export {
  registerCleanCommand,
  registerUninstallCommand,
  registerDiskCommand,
  registerMonitorCommand,
  registerScanCommand,
  registerOptimizeCommand,
  registerPurgeCommand,
  registerInstallerCommand,
  registerCheckCommand,
  registerTouchIdCommand,
}
