import type { CleanCategory } from '@system-cleaner/core'

export interface CleanTarget {
  id: string
  name: string
  path: string
  description: string
  category: CleanCategory
  icon: string
  /** If true, clean contents only (don't remove the directory itself) */
  contentsOnly: boolean
  /** If true, requires elevated permissions */
  requiresSudo: boolean
  /** Glob patterns for files to skip within this target */
  skipPatterns?: string[]
}

export interface CleanScanResult {
  target: CleanTarget
  sizeBytes: number
  sizeFormatted: string
  exists: boolean
  itemCount: number
}

export interface CleanResult {
  targetId: string
  targetName: string
  freedBytes: number
  freedFormatted: string
  errors: string[]
  skipped: string[]
  success: boolean
}

export interface CleanOptions {
  dryRun?: boolean
  verbose?: boolean
  categories?: CleanCategory[]
  skipTargets?: string[]
  onProgress?: (targetId: string, status: string) => void
}

export interface BrowserProfile {
  browser: string
  browserIcon: string
  profilePath: string
  cachePaths: string[]
  cookiePaths: string[]
  historyPaths: string[]
  serviceWorkerPaths: string[]
  localStoragePaths: string[]
}
