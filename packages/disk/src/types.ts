import type { DiskEntry, FileCategory, LargeFile, ScanOptions, ScanResult } from '@system-cleaner/core'

export type { DiskEntry, FileCategory, LargeFile, ScanOptions, ScanResult }

export interface DiskUsageByCategory {
  category: string
  label: string
  icon: string
  sizeBytes: number
  sizeFormatted: string
  fileCount: number
  percentage: number
  color: string
}

export interface DuplicateGroup {
  hash: string
  sizeBytes: number
  files: string[]
}

export interface ProjectArtifact {
  path: string
  type: string
  sizeBytes: number
  sizeFormatted: string
  projectName: string
  lastModified: Date
}
