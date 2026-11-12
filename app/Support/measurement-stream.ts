/** Stream completed measurements; the final record is the complete cacheable result. */
export function measurementStream(work: (publish: (sizes: Record<string, number>) => void) => Promise<Record<string, unknown>>): Response {
  const encoder = new TextEncoder()
  let cancelled = false
  return new Response(new ReadableStream({
    async start(controller) {
      const send = (record: Record<string, unknown>) => {
        if (!cancelled) controller.enqueue(encoder.encode(`${JSON.stringify(record)}\n`))
      }
      try {
        const result = await work(sizes => send({ sizes }))
        send({ ...result, complete: true })
      }
      catch (error) {
        send({ success: false, complete: true, error: error instanceof Error ? error.message : 'Measurement failed' })
      }
      finally {
        if (!cancelled) controller.close()
      }
    },
    cancel() { cancelled = true },
  }), { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'private, no-store' } })
}
