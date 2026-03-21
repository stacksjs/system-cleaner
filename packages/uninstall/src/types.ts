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
  type: 'agent' | 'daemon'
  runAtLoad: boolean
  keepAlive: boolean
  disabled: boolean
  filepath: string
  program: string
}
