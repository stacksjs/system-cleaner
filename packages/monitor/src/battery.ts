import { exec } from '@system-cleaner/core'
import type { BatteryMetrics } from './types'

/**
 * Collect battery metrics
 */
export async function getBatteryMetrics(): Promise<BatteryMetrics | null> {
  // Check if battery is present
  const pmResult = await exec('pmset -g batt 2>/dev/null', { timeout: 3000 })
  if (!pmResult.ok || !pmResult.stdout.includes('InternalBattery'))
    return null

  const output = pmResult.stdout

  // Parse charge percentage
  const chargeMatch = output.match(/(\d+)%/)
  const chargePercent = chargeMatch ? Number.parseInt(chargeMatch[1]) : 0

  // Parse charging state
  // "discharging" contains "charging" as substring — must exclude it explicitly
  const isCharging = output.includes('charging') && !output.includes('not charging') && !output.includes('discharging')
  const isPowerConnected = output.includes('AC Power')

  // Parse time remaining
  let timeRemainingMinutes = 0
  const timeMatch = output.match(/(\d+):(\d+) remaining/)
  if (timeMatch) {
    timeRemainingMinutes = Number.parseInt(timeMatch[1]) * 60 + Number.parseInt(timeMatch[2])
  }

  // Get detailed health info from system_profiler
  const healthInfo = await getBatteryHealth()

  const healthPercent = healthInfo.healthPercent
  let healthStatus: 'normal' | 'warning' | 'critical' = 'normal'
  if (healthPercent < 60)
    healthStatus = 'critical'
  else if (healthPercent < 80)
    healthStatus = 'warning'

  return {
    isPresent: true,
    chargePercent,
    isCharging,
    isPowerConnected,
    cycleCount: healthInfo.cycleCount,
    healthPercent,
    healthStatus,
    timeRemainingMinutes,
    temperature: healthInfo.temperature,
  }
}

async function getBatteryHealth(): Promise<{
  cycleCount: number
  healthPercent: number
  temperature?: number
}> {
  const result = await exec(
    'system_profiler SPPowerDataType 2>/dev/null',
    { timeout: 10_000 },
  )

  if (!result.ok) {
    return { cycleCount: 0, healthPercent: 100 }
  }

  const output = result.stdout

  // Cycle count
  const cycleMatch = output.match(/Cycle Count:\s*(\d+)/i)
  const cycleCount = cycleMatch ? Number.parseInt(cycleMatch[1]) : 0

  // Maximum capacity / condition
  const capacityMatch = output.match(/Maximum Capacity:\s*(\d+)%/i)
  const healthPercent = capacityMatch ? Number.parseInt(capacityMatch[1]) : 100

  // Temperature (in centidegrees)
  const tempMatch = output.match(/Temperature:\s*([\d.]+)/i)
  const temperature = tempMatch ? Number.parseFloat(tempMatch[1]) / 100 : undefined

  return { cycleCount, healthPercent, temperature }
}
