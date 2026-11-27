import type { ScanKind } from '../../Workers/scan-jobs'

interface ActivityAction {
  label: string
  category: string
  scan?: ScanKind
  manualFlag?: string
}

/** Only deliberate operations belong here. Read models and polling stay out. */
export const activityActions: Record<string, ActivityAction> = {
  'disk-scan': { label: 'Scan disk usage', category: 'Storage', scan: 'tree' },
  'large-files': { label: 'Scan for large files', category: 'Storage', scan: 'large-files' },
  'duplicates-scan': { label: 'Find duplicate files', category: 'Storage', scan: 'duplicates' },
  'similar-images-scan': { label: 'Find similar images', category: 'Storage', scan: 'similar' },
  'cancel-scan': { label: 'Cancel a scan', category: 'Storage' },
  'project-artifacts': { label: 'Scan developer projects', category: 'Cleanup', manualFlag: 'refresh' },
  'disk-remove-worktrees': { label: 'Remove AI worktrees', category: 'Cleanup' },
  'delete-path': { label: 'Delete an item from Disk Usage', category: 'Cleanup' },
  'clean-dir': { label: 'Clean a folder', category: 'Cleanup' },
  'bulk-delete': { label: 'Remove selected items', category: 'Cleanup' },
  'delete-similar': { label: 'Remove similar images', category: 'Cleanup' },
  'clean-safe': { label: 'Run Quick Clean', category: 'Cleanup' },
  'clean-orphans': { label: 'Remove leftover app data', category: 'Cleanup' },
  'clean-ds-store': { label: 'Remove Finder metadata files', category: 'Cleanup' },
  'clean-incomplete-downloads': { label: 'Remove incomplete downloads', category: 'Cleanup' },
  'empty-trash': { label: 'Empty Trash', category: 'Cleanup' },
  'delete-snapshots': { label: 'Delete local snapshots', category: 'Cleanup' },
  'schedule-save': { label: 'Change cleanup schedule', category: 'Cleanup' },
  'schedule-run': { label: 'Run scheduled cleanup', category: 'Cleanup' },
  'protect-path': { label: 'Protect a folder or file', category: 'Cleanup' },
  'unprotect-path': { label: 'Remove path protection', category: 'Cleanup' },
  'kill-process': { label: 'Stop a process', category: 'Performance' },
  'toggle-startup': { label: 'Change a startup item', category: 'Performance' },
  'remove-startup': { label: 'Remove a startup item', category: 'Performance' },
  'remove-dead-startup': { label: 'Remove missing startup items', category: 'Performance' },
  'run-maintenance': { label: 'Run maintenance', category: 'Performance' },
  'app-scan': { label: 'Scan an installed app', category: 'Applications' },
  'app-uninstall': { label: 'Uninstall an app', category: 'Applications' },
  'remove-extensions': { label: 'Remove browser extensions', category: 'Applications' },
  'updates-check': { label: 'Check for updates', category: 'Updates', manualFlag: 'forceRefresh' },
  'brew-update': { label: 'Update a Homebrew package', category: 'Updates' },
  'brew-update-all': { label: 'Update all Homebrew packages', category: 'Updates' },
  'pantry-update': { label: 'Update a Pantry package', category: 'Updates' },
  'app-update': { label: 'Update an installed app', category: 'Updates' },
  'self-update/download': { label: 'Download a SystemCleaner update', category: 'Updates' },
  'self-update/install': { label: 'Install a SystemCleaner update', category: 'Updates' },
  'privacy-clean': { label: 'Clear browser traces', category: 'Protection' },
  'keep-cookie': { label: 'Keep a site’s cookies', category: 'Protection' },
  'unkeep-cookie': { label: 'Remove a cookie exception', category: 'Protection' },
  'reset-permission': { label: 'Reset an app permission', category: 'Protection' },
  'shred-paths': { label: 'Shred selected files', category: 'Protection' },
  'vpn-install': { label: 'Set up VPN', category: 'Protection' },
  'vpn-connect': { label: 'Connect to VPN', category: 'Protection' },
  'vpn-disconnect': { label: 'Disconnect VPN', category: 'Protection' },
  'app-preferences-save': { label: 'Change app settings', category: 'Settings' },
  'reveal-in-finder': { label: 'Reveal an item in the file manager', category: 'System' },
  'reveal-app-data': { label: 'Reveal application data', category: 'System' },
  'open-extensions-page': { label: 'Open browser extensions settings', category: 'System' },
  'open-software-update': { label: 'Open Software Update', category: 'System' },
  'open-privacy-settings': { label: 'Open Privacy & Security', category: 'System' },
  'open-permission-pane': { label: 'Open a permission pane', category: 'System' },
  'open-app-store-updates': { label: 'Open App Store updates', category: 'System' },
}
