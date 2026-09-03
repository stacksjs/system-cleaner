export interface ExecOptions {
  timeout?: number
  encoding?: BufferEncoding
  cwd?: string
  env?: Record<string, string>
}

export interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number
  ok: boolean
}

export interface PathSafetyCheck {
  safe: boolean
  reason?: string
}

export interface PlistEntry {
  label: string
  program: string
  runAtLoad: boolean
  keepAlive: boolean
  disabled: boolean
  filepath: string
}

export interface SystemInfo {
  hostname: string
  username: string
  macosVersion: string
  cpuModel: string
  cpuCores: number
  cpuPhysicalCores: number
  totalMemoryBytes: number
  totalMemoryGB: number
  uptimeSeconds: number
  serialNumber: string
  modelName: string
}

export interface DiskInfo {
  mountPoint: string
  filesystem: string
  totalBytes: number
  usedBytes: number
  freeBytes: number
  usedPercent: number
}

export interface SizeResult {
  bytes: number
  formatted: string
}

export interface OperationResult<T = void> {
  success: boolean
  data?: T
  error?: string
}

export interface CleanableItem {
  id: string
  name: string
  path: string
  description: string
  category: CleanCategory
  icon: string
  sizeBytes: number
  sizeFormatted: string
  exists: boolean
}

export type CleanCategory =
  | 'cache'
  | 'log'
  | 'browser'
  | 'developer'
  | 'system'
  | 'application'
  | 'trash'
  | 'homebrew'
  | 'project-artifact'

export interface AppInfo {
  name: string
  bundleId: string
  version: string
  path: string
  iconPath: string
  sizeBytes: number
  installDate: Date | null
  isSystemApp: boolean
}

export interface AppRemnant {
  path: string
  type: RemnantType
  sizeBytes: number
  exists: boolean
}

export type RemnantType =
  | 'application-support'
  | 'preferences'
  | 'caches'
  | 'logs'
  | 'cookies'
  | 'launch-agent'
  | 'launch-daemon'
  | 'saved-state'
  | 'http-storage'
  | 'webkit'
  | 'containers'
  | 'group-containers'
  | 'crash-reports'
  | 'receipts'
  | 'other'

export interface DiskEntry {
  name: string
  path: string
  sizeBytes: number
  isDirectory: boolean
  children?: DiskEntry[]
  fileCount?: number
  modifiedAt?: Date
  /**
   * True when this directory's size is the exact size of its whole subtree,
   * rather than the sum of the children that happened to be measured.
   *
   * A scan that runs out of time has to say which folders it never got to:
   * a folder reported at zero because nobody looked is not the same claim as
   * a folder that is genuinely empty, and the chart cannot tell them apart.
   */
  unmeasured?: boolean
  /**
   * True for a stand-in node covering what its siblings do not: the loose
   * files in a folder `du` measured whole, plus any folder too small to draw.
   * It is a bucket, not a file, so anything looking for real files skips it.
   */
  aggregate?: boolean
}

export interface ScanOptions {
  maxDepth?: number
  timeoutMs?: number
  /**
   * Hard cap on total entries (files + folders) processed in a single
   * scan. Prevents heap exhaustion on directories with millions of
   * entries — `timeoutMs` alone isn't enough because `readdirSync` loads
   * the entries synchronously before the timer can fire.
   */
  maxEntries?: number
  skipPatterns?: Set<string>
  /**
   * How deep the directory walk itself goes before `du` takes over sizing
   * the rest. Shallow on purpose — see `scanDirectory`.
   */
  structureDepth?: number
  /** How many `du` processes may run at once. */
  concurrency?: number
  onProgress?: (scanned: number, currentPath: string, measuredBytes?: number) => void
}

export interface ScanResult {
  tree: DiskEntry
  totalFiles: number
  totalFolders: number
  /** Folders whose size the scan never got to measure. */
  unmeasuredFolders: number
  /** Folders the OS refused to read. Almost always a Full Disk Access gap. */
  unreadableFolders: number
  scanTimeMs: number
  aborted: boolean
}

export interface LargeFile {
  path: string
  name: string
  sizeBytes: number
  sizeFormatted: string
  modifiedAt: Date
  category: FileCategory
  /**
   * True when the entry is a directory macOS presents as one document (a
   * `.app`, a `.photoslibrary`, a `.sparsebundle`). Deleting one removes the
   * whole tree, so the UI has to say so before the user confirms.
   */
  isBundle?: boolean
}

export type FileCategory =
  | 'archive'
  | 'disk-image'
  | 'video'
  | 'audio'
  | 'image'
  | 'document'
  | 'database'
  | 'code'
  | 'build-artifact'
  | 'package-cache'
  | 'log'
  | 'other'

export interface CpuMetrics {
  modelName: string
  logicalCores: number
  physicalCores: number
  performanceCores: number
  efficiencyCores: number
  usagePercent: number
  perCoreUsage: number[]
  loadAvg1: number
  loadAvg5: number
  loadAvg15: number
  temperature?: number
}

export interface MemoryMetrics {
  totalBytes: number
  usedBytes: number
  freeBytes: number
  activeBytes: number
  wiredBytes: number
  compressedBytes: number
  swapUsedBytes: number
  swapTotalBytes: number
  usagePercent: number
  pressure: 'nominal' | 'warning' | 'critical'
}

export interface DiskIoMetrics {
  partitions: DiskPartitionMetrics[]
}

export interface DiskPartitionMetrics {
  name: string
  mountPoint: string
  totalBytes: number
  usedBytes: number
  freeBytes: number
  usedPercent: number
  readBytesPerSec: number
  writeBytesPerSec: number
}

export interface NetworkMetrics {
  interfaces: NetworkInterfaceMetrics[]
}

export interface NetworkInterfaceMetrics {
  name: string
  ipAddress: string
  rxBytesPerSec: number
  txBytesPerSec: number
  rxTotalBytes: number
  txTotalBytes: number
  isUp: boolean
}

export interface GpuMetrics {
  model: string
  vendor: string
  vramMB: number
  usagePercent: number
  temperature?: number
}

export interface BatteryMetrics {
  isPresent: boolean
  chargePercent: number
  isCharging: boolean
  isPowerConnected: boolean
  cycleCount: number
  healthPercent: number
  healthStatus: 'normal' | 'warning' | 'critical'
  timeRemainingMinutes: number
  temperature?: number
}

export interface ProcessInfo {
  pid: number
  name: string
  fullCommand: string
  user: string
  cpuPercent: number
  memoryPercent: number
  memoryMB: number
  isSystem: boolean
}

export interface HealthScore {
  score: number
  label: 'Excellent' | 'Good' | 'Fair' | 'Poor' | 'Critical'
  color: string
  factors: HealthFactor[]
}

export interface HealthFactor {
  name: string
  impact: number
  description: string
}

export interface SystemSnapshot {
  timestamp: Date
  cpu: CpuMetrics
  memory: MemoryMetrics
  diskIo: DiskIoMetrics
  network: NetworkMetrics
  gpu: GpuMetrics | null
  battery: BatteryMetrics | null
  processes: ProcessInfo[]
  health: HealthScore
}
