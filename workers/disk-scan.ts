/// Disk scan worker — runs in a separate thread to avoid blocking the server

import { scanDirectory } from '@system-cleaner/disk'

declare const self: Worker

self.onmessage = (event: MessageEvent) => {
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
