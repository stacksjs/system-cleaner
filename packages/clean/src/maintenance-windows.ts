import type { MaintenanceTask } from './maintenance'

/**
 * Windows upkeep.
 *
 * Most of what people mean by "maintenance" on Windows needs administrator
 * rights — `sfc`, `DISM`, `chkdsk`, `defrag` all refuse without them — and
 * this agent has none and no way to ask for any. That is not a reason to leave
 * the screen empty: it is a reason to be exact about which half is which.
 *
 * So the tasks that genuinely run as the signed-in user run from here, and the
 * rest are listed with the command to paste into an elevated PowerShell. That
 * is the same arrangement the macOS tasks already use for `sudo`, and the
 * reason the capability could be turned on at all: a screen that says "here is
 * what to run, and why" is worth more than one that hides the work or offers a
 * button that can only fail.
 *
 * See stacksjs/system-cleaner#23.
 */
export const WINDOWS_MAINTENANCE_TASKS: MaintenanceTask[] = [
  // ── Runs as the signed-in user ────────────────────────────────
  {
    id: 'win-store-cache',
    name: 'Reset Microsoft Store cache',
    description: 'Clear the Store\'s local cache and reopen it',
    effect: 'Fixes a Store that will not load, shows stale listings, or fails downloads with no reason given',
    command: 'wsreset.exe',
    requiresSudo: false,
    elevationLabel: 'an Administrator PowerShell',
    category: 'caches',
    icon: 'i-f7-app-fill',
  },
  {
    id: 'win-icon-cache',
    name: 'Rebuild icon cache',
    description: 'Delete the cached icon database and restart Explorer so it is rebuilt',
    effect: 'Fixes blank, stretched or wrong icons on the desktop and in Explorer',
    // Explorer holds the file open, so it has to go down first and come back
    // after. `start` returns immediately rather than waiting on the shell.
    command: 'taskkill /f /im explorer.exe & del /a /q "%LOCALAPPDATA%\\IconCache.db" & del /a /f /q "%LOCALAPPDATA%\\Microsoft\\Windows\\Explorer\\iconcache*" & start explorer.exe',
    requiresSudo: false,
    elevationLabel: 'an Administrator PowerShell',
    category: 'caches',
    icon: 'i-f7-photo-fill',
  },
  {
    id: 'win-explorer',
    name: 'Restart Explorer',
    description: 'Relaunch the Windows shell',
    effect: 'Clears a taskbar that has stopped responding, or a desktop that will not redraw',
    command: 'taskkill /f /im explorer.exe & start explorer.exe',
    requiresSudo: false,
    elevationLabel: 'an Administrator PowerShell',
    category: 'services',
    icon: 'i-f7-desktopcomputer',
  },
  {
    id: 'win-temp',
    name: 'Clear your temp directory',
    description: 'Delete what is left in %TEMP%',
    effect: 'Reclaims space installers and toolchains leave behind and nothing clears automatically',
    command: 'del /q /f /s "%TEMP%\\*"',
    requiresSudo: false,
    elevationLabel: 'an Administrator PowerShell',
    category: 'storage',
    icon: 'i-f7-trash-fill',
  },

  // ── Needs an elevated prompt ──────────────────────────────────
  {
    id: 'win-sfc',
    name: 'Check system files',
    description: 'Verify every protected system file against its known-good copy and repair what differs',
    effect: 'Fixes crashes and features that stopped working after a bad update or a disk error',
    command: 'sfc /scannow',
    requiresSudo: true,
    elevationLabel: 'an Administrator PowerShell',
    category: 'services',
    icon: 'i-f7-checkmark-shield-fill',
  },
  {
    id: 'win-dism',
    name: 'Repair the component store',
    description: 'Have Windows Update supply fresh copies of anything corrupt in the component store',
    effect: 'The step that makes a failing system-file check succeed — run it first when sfc cannot repair',
    command: 'DISM /Online /Cleanup-Image /RestoreHealth',
    requiresSudo: true,
    elevationLabel: 'an Administrator PowerShell',
    category: 'services',
    icon: 'i-f7-wrench-fill',
  },
  {
    id: 'win-dism-cleanup',
    name: 'Shrink the component store',
    description: 'Remove superseded component versions kept for uninstalling old updates',
    effect: 'Reclaims several gigabytes in WinSxS, at the cost of being unable to uninstall earlier updates',
    command: 'DISM /Online /Cleanup-Image /StartComponentCleanup /ResetBase',
    requiresSudo: true,
    elevationLabel: 'an Administrator PowerShell',
    category: 'storage',
    icon: 'i-f7-archivebox-fill',
  },
  {
    id: 'win-flushdns',
    name: 'Flush the DNS cache',
    description: 'Discard every cached name lookup',
    effect: 'Fixes a site that resolves to the wrong address after a DNS change',
    command: 'ipconfig /flushdns',
    requiresSudo: true,
    elevationLabel: 'an Administrator PowerShell',
    category: 'network',
    icon: 'i-f7-globe',
  },
  {
    id: 'win-winsock',
    name: 'Reset the network stack',
    description: 'Return Winsock and TCP/IP to their defaults',
    effect: 'Last resort for a machine that connects to the network but cannot reach anything. Needs a restart',
    command: 'netsh winsock reset & netsh int ip reset',
    requiresSudo: true,
    elevationLabel: 'an Administrator PowerShell',
    category: 'network',
    icon: 'i-f7-antenna-radiowaves-left-right',
  },
  {
    id: 'win-optimize',
    name: 'Optimise drives',
    description: 'Retrim an SSD, or defragment a mechanical disk — Windows picks per drive',
    effect: 'Restores write performance on an SSD that has been full for a long time',
    command: 'defrag %SystemDrive% /O',
    requiresSudo: true,
    elevationLabel: 'an Administrator PowerShell',
    category: 'storage',
    icon: 'i-f7-speedometer',
  },
  {
    id: 'win-chkdsk',
    name: 'Check the disk',
    description: 'Scan the boot volume for filesystem damage and schedule a repair at the next restart',
    effect: 'Finds the corruption behind files that will not open and folders that cannot be deleted',
    command: 'chkdsk %SystemDrive% /scan',
    requiresSudo: true,
    elevationLabel: 'an Administrator PowerShell',
    category: 'storage',
    icon: 'i-f7-doc-text-fill',
  },
]
