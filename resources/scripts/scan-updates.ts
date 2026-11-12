/** Consume complete NDJSON records, including records split across network chunks. */
async function streamMeasurements(endpoint: string, data: Record<string, unknown>, onUpdate: (sizes: Record<string, number>) => void) {
  const response = await fetch(endpoint, {
    method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...data, stream: true }),
  })
  if (!response.ok || !response.body) throw new Error(`Measurement failed (HTTP ${response.status})`)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  let result: { success?: boolean, complete?: boolean, sizes?: Record<string, number>, stale?: boolean, error?: string } | undefined
  const sizes: Record<string, number> = {}
  try {
    while (true) {
      const { value, done } = await reader.read()
      pending += decoder.decode(value, { stream: !done })
      let end: number
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end)
        pending = pending.slice(end + 1)
        if (!line.trim()) continue
        const record = JSON.parse(line)
        if (record.sizes) {
          Object.assign(sizes, record.sizes)
          onUpdate({ ...sizes })
        }
        if (record.complete) result = record
      }
      if (done) break
    }
  }
  finally { reader.releaseLock() }
  if (!result?.success) throw new Error(result?.error || 'Measurement stream ended before completion')
  return result
}

declare global {
  interface Window {
    streamMeasurements: typeof streamMeasurements
  }
}
window.streamMeasurements = streamMeasurements
export {}
