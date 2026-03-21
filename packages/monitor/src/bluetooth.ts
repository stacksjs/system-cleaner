import { exec } from '@system-cleaner/core'

export interface BluetoothDevice {
  name: string
  connected: boolean
  batteryPercent: number | null
}

let cachedDevices: BluetoothDevice[] | null = null
let cacheTime = 0
const CACHE_TTL = 30_000 // 30 seconds (slow system_profiler call)

/**
 * Detect connected Bluetooth devices with battery levels.
 * Uses system_profiler SPBluetoothDataType (cached 30s).
 */
export async function getBluetoothDevices(): Promise<BluetoothDevice[]> {
  if (cachedDevices && Date.now() - cacheTime < CACHE_TTL)
    return cachedDevices

  const result = await exec('system_profiler SPBluetoothDataType 2>/dev/null', { timeout: 10_000 })
  if (!result.ok) {
    cachedDevices = []
    cacheTime = Date.now()
    return []
  }

  const devices: BluetoothDevice[] = []
  const lines = result.stdout.split('\n')

  let currentName = ''
  let currentConnected = false
  let currentBattery: number | null = null

  for (const line of lines) {
    const trimmed = line.trim()

    // Device name: indented with 6+ spaces, ends with colon, not a known key
    if (/^\s{6,}\S/.test(line) && trimmed.endsWith(':') && !trimmed.startsWith('Connected:') && !trimmed.startsWith('Battery') && !trimmed.startsWith('Address:') && !trimmed.startsWith('Major Type:') && !trimmed.startsWith('Minor Type:') && !trimmed.startsWith('Services:') && !trimmed.startsWith('Firmware')) {
      // Save previous device
      if (currentName) {
        devices.push({ name: currentName, connected: currentConnected, batteryPercent: currentBattery })
      }
      currentName = trimmed.replace(/:$/, '')
      currentConnected = false
      currentBattery = null
    }

    if (trimmed.startsWith('Connected: Yes'))
      currentConnected = true
    if (trimmed.startsWith('Connected: No'))
      currentConnected = false

    const batteryMatch = trimmed.match(/Battery Level:\s*(\d+)/)
    if (batteryMatch)
      currentBattery = Number.parseInt(batteryMatch[1])
  }

  // Save last device
  if (currentName) {
    devices.push({ name: currentName, connected: currentConnected, batteryPercent: currentBattery })
  }

  cachedDevices = devices
  cacheTime = Date.now()
  return devices
}
