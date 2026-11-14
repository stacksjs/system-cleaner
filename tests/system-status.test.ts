import { describe, expect, it } from 'bun:test'
import { getSystemStatus, memoryUsage } from '../app/Support/Monitor/system-status'

describe('tray system status', () => {
  it('keeps memory accounting bounded and internally consistent', () => {
    expect(memoryUsage(16000, 4000)).toEqual({ totalBytes: 16000, availableBytes: 4000, usedBytes: 12000, usedPercent: 75 })
    expect(memoryUsage(16000, 20000).usedBytes).toBe(0)
    expect(memoryUsage(16000, -1).usedPercent).toBe(100)
    expect(memoryUsage(0, 0).usedPercent).toBe(0)
  })
  it('joins concurrent refreshes and returns kernel measurements', async () => {
    const started = Date.now()
    const first = getSystemStatus()
    expect(getSystemStatus()).toBe(first)
    const status = await first
    expect(status.sampledAt).toBeGreaterThanOrEqual(started)
    expect(status.cpu.percent).toBeGreaterThanOrEqual(0)
    expect(status.cpu.percent).toBeLessThanOrEqual(100)
    expect(status.cpu.cores).toBeGreaterThan(0)
    expect(status.memory.usedBytes + status.memory.availableBytes).toBe(status.memory.totalBytes)
    if (status.disk) expect(status.disk.usedBytes + status.disk.freeBytes).toBe(status.disk.totalBytes)
    expect(status.uptimeSeconds).toBeGreaterThan(0)
    const next = getSystemStatus()
    expect(next).not.toBe(first)
    await next
  })
})
