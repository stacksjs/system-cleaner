import { cli } from '@stacksjs/clapp'
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

export function createCLI() {
  const app = cli('system-cleaner')
    .version('0.1.0')
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
