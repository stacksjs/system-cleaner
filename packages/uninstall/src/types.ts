import type { AppInfo, AppRemnant, RemnantType } from '@system-cleaner/core'

export type { AppInfo, AppRemnant, RemnantType }

export interface UninstallScanResult {
  app: AppInfo
  remnants: AppRemnant[]
  totalRemnantSize: number
  totalRemnantSizeFormatted: string
  totalSize: number
  totalSizeFormatted: string
}

export interface UninstallResult {
  app: AppInfo
  removedPaths: string[]
  errors: string[]
  totalFreed: number
  totalFreedFormatted: string
  success: boolean
}

export interface UninstallOptions {
  dryRun?: boolean
  includeSystemApps?: boolean
  deep?: boolean
  onProgress?: (step: string) => void
}

export interface StartupItem {
  id: string
  name: string
  label: string
  vendor: string
  icon: string
  category: 'system' | 'vendor' | 'dev' | 'other'
  scope: 'user' | 'system'
  /**
   * What kind of thing starts this.
   *
   * `agent` and `daemon` are launchd's; `registry` and `startup-folder` are
   * the two places Windows looks. Kept in one field rather than split per
   * platform because every consumer wants the same thing from it — a label
   * and a count — and a second field would mean every one of them learning
   * which to read.
   */
  type: 'agent' | 'daemon' | 'registry' | 'startup-folder'
  runAtLoad: boolean
  keepAlive: boolean
  disabled: boolean
  filepath: string
  program: string
  /**
   * `program` is an absolute path that does not exist, so launchd cannot
   * execute this entry — it is what an uninstall left registered.
   *
   * This is the one state on the startup list that is safe to act on without
   * knowing what the item does: every other row might be load-bearing, but a
   * missing binary cannot run whatever happens. It stays `false` whenever the
   * answer is unknown rather than no — an empty `program` (launchd also
   * accepts `BundleProgram`, or an on-demand entry with only `MachServices`)
   * and a bare command resolved through `PATH` are both unknown, not dead.
   */
  targetMissing: boolean
}
