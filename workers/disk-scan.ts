/// Disk scan worker — runs in a separate thread to avoid blocking the server

import { scanDirectory } from '@system-cleaner/disk'

declare const self: Worker

interface ScanRequest {
  home: string
  maxDepth?: number
  timeoutMs?: number
}

function isValidRequest(value: unknown): value is ScanRequest {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Partial<ScanRequest>
  if (typeof v.home !== 'string' || v.home.length === 0) return false
  if (v.maxDepth !== undefined && (!Number.isInteger(v.maxDepth) || v.maxDepth! < 1)) return false
  if (v.timeoutMs !== undefined && (!Number.isFinite(v.timeoutMs) || v.timeoutMs! < 0)) return false
  return true
}

self.onmessage = (event: MessageEvent) => {
  // Validate at the trust boundary: anything coming over postMessage is
  // structured-cloned data we shouldn't pass straight to scanDirectory.
  if (!isValidRequest(event.data)) {
    self.postMessage({ success: false, error: 'Invalid scan request' })
    return
  }

  const { home, maxDepth, timeoutMs } = event.data

  try {
    const result = scanDirectory(home, { maxDepth, timeoutMs })

    self.postMessage({
      success: true,
      tree: result.tree,
      folderCount: result.totalFolders,
      fileCount: result.totalFiles,
      scanTime: result.scanTimeMs < 1000 ? `${result.scanTimeMs}ms` : `${(result.scanTimeMs / 1000).toFixed(1)}s`,
    })
  }
  catch (e: any) {
    self.postMessage({
      success: false,
      error: e.message || 'Scan failed',
    })
  }
}

// Surface structured-clone failures (huge result tree → can't be
// transferred). Without this they silently hung the request until the
// route's 60s timeout fired.
;(self as Worker & { onmessageerror?: (e: MessageEvent) => void }).onmessageerror = () => {
  self.postMessage({
    success: false,
    error: 'Worker received a message it could not deserialize',
  })
}
