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
}
