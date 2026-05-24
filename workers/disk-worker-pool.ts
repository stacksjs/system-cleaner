/** Reusable disk-scan worker — avoids spawn overhead on every scan. */

type ScanRequest = {
  home: string
  maxDepth?: number
  timeoutMs?: number
}

type ScanResult = {
  success: boolean
  tree?: unknown
  folderCount?: number
  fileCount?: number
  scanTime?: string
  error?: string
}

let worker: Worker | null = null
let busy = false
const queue: Array<{
  request: ScanRequest
  resolve: (result: ScanResult) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}> = []

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./disk-scan.ts', import.meta.url).href)
    worker.onmessage = (e: MessageEvent<ScanResult>) => {
      const job = queue.shift()
      if (!job) {
        busy = false
        return
      }
      clearTimeout(job.timer)
      busy = false
      job.resolve(e.data)
      drainQueue()
    }
    worker.onerror = (e: ErrorEvent) => {
      const job = queue.shift()
      if (job) {
        clearTimeout(job.timer)
        job.reject(new Error(e.message || 'Worker error'))
      }
      busy = false
      terminateWorker()
      drainQueue()
    }
    ;(worker as Worker & { onmessageerror?: (e: MessageEvent) => void }).onmessageerror = () => {
      const job = queue.shift()
      if (job) {
        clearTimeout(job.timer)
        job.reject(new Error('Worker message could not be deserialized'))
      }
      busy = false
      terminateWorker()
      drainQueue()
    }
  }
  return worker
}

function terminateWorker(): void {
  try {
    worker?.terminate()
  }
  catch {}
  worker = null
}

function drainQueue(): void {
  if (busy || queue.length === 0) return
  const job = queue[0]
  busy = true
  getWorker().postMessage(job.request)
}

export function runDiskScan(request: ScanRequest, hardTimeoutMs: number): Promise<ScanResult> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const idx = queue.findIndex(j => j.timer === timer)
      if (idx !== -1) queue.splice(idx, 1)
      terminateWorker()
      busy = false
      reject(new Error(`Scan exceeded ${hardTimeoutMs / 1000}s`))
      drainQueue()
    }, hardTimeoutMs)

    queue.push({ request, resolve, reject, timer })
    drainQueue()
  })
}
