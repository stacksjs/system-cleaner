import type { GitDisposition } from '@system-cleaner/core'
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

export interface ProjectArtifact {
  path: string
  type: string
  sizeBytes: number
  sizeFormatted: string
  projectName: string
  lastModified: Date
  /** Human label for the pattern that matched, e.g. "Node.js dependencies". */
  label: string
  /**
   * See PROJECT_ARTIFACT_PATTERNS: `caution` is excluded from Select All.
   *
   * `blocked` is not a pattern risk at all - it is git overruling the pattern.
   * A directory whose contents are tracked is not build output whatever it is
   * called, so no amount of confidence in the name should let it be deleted.
   */
  risk: 'safe' | 'caution' | 'blocked'
  /**
   * What version control says about this path.
   *
   * `ignored` is the project declaring it disposable, which is stronger
   * evidence than the directory's name. `tracked` means deleting it destroys
   * committed files. `unversioned` means no repository owns it and nothing
   * can distinguish output from source.
   */
  git: GitDisposition
}
