import { execSync, HOME, TtlCache } from '@system-cleaner/core'
import * as fs from 'node:fs'
import { CLEAN_TARGETS, getAllExtensions } from '@system-cleaner/clean'
import { discoverStartupItems } from '@system-cleaner/uninstall'

const startupCache = new TtlCache<ReturnType<typeof discoverStartupItems>>(60_000)
const extensionsCache = new TtlCache<ReturnType<typeof getAllExtensions>>(60_000)
const diskInfoCache = new TtlCache<Record<string, unknown>>(30_000)
const cleanupTargetsCache = new TtlCache<Array<{
  id: string
  name: string
  path: string
  icon: string
  desc: string
}>>(5 * 60_000)

function safeExec(cmd: string, fallback = ''): string {
  try {
    return execSync(cmd, { timeout: 5000 })
  }
  catch {
    return fallback
  }
}

export function getStartupItemsCached() {
  const hit = startupCache.get('items')
  if (hit) return { items: hit, cached: true }
  const items = discoverStartupItems()
  startupCache.set('items', items)
  return { items, cached: false }
}

export function getExtensionsCached() {
  const hit = extensionsCache.get('list')
  if (hit) return { extensions: hit, cached: true }
  const extensions = getAllExtensions()
  extensionsCache.set('list', extensions)
  return { extensions, cached: false }
}

export function invalidateStartupCache(): void {
  startupCache.clear()
}

export function getSystemDiskInfoCached() {
  const hit = diskInfoCache.get('disk')
  if (hit) return { ...hit, cached: true }

  let diskTotal = 0
  let diskFree = 0
  let diskUsed = 0
  let diskPct = 0
  let diskPurgeable = 0

  try {
    const dfOut = safeExec('df -k / 2>/dev/null')
    const parts = dfOut.split('\n')[1]?.split(/\s+/)
    if (parts) {
      diskTotal = Number.parseInt(parts[1], 10) * 1024
      diskFree = Number.parseInt(parts[3], 10) * 1024
      diskUsed = diskTotal - diskFree
      diskPct = diskTotal > 0 ? Math.round((diskUsed / diskTotal) * 100) : 0
    }
    const diskInfo = safeExec('diskutil info / 2>/dev/null')
    const purgeMatch = diskInfo.match(/Purgeable.*?(\d[\d.]*)\s*(GB|MB|TB)/i)
    if (purgeMatch) {
      const val = Number.parseFloat(purgeMatch[1])
      const unit = purgeMatch[2].toUpperCase()
      diskPurgeable = val * (unit === 'TB' ? 1e12 : unit === 'GB' ? 1e9 : 1e6)
    }
  }
  catch {}

  const fmt = (bytes: number) => {
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`
    if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`
    if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)} KB`
    return `${bytes} B`
  }

  const payload = {
    diskTotal,
    diskFree,
    diskUsed,
    diskPct,
    diskPurgeable,
    fDiskUsed: fmt(diskUsed),
    fDiskFree: fmt(diskFree),
    fDiskTotal: fmt(diskTotal),
    fDiskPurgeable: fmt(diskPurgeable),
    fDiskPct: String(diskPct),
    fDiskBarStyle: `width: ${diskPct}%;${diskPct > 90 ? ' background: linear-gradient(90deg, #ff453a, #ff453a);' : diskPct > 75 ? ' background: linear-gradient(90deg, #ff9f0a, #ff9f0a);' : ''}`,
    cached: false,
  }
  diskInfoCache.set('disk', payload)
  return payload
}

export function getCleanupTargetsCached() {
  const hit = cleanupTargetsCache.get('targets')
  if (hit) return { targets: hit, cached: true }

  const targets = CLEAN_TARGETS
    .filter(t => !t.requiresSudo)
    .filter((t) => {
      try {
        const st = fs.statSync(t.path)
        return st.isDirectory() || !t.contentsOnly
      }
      catch {
        return false
      }
    })
    .map(t => ({
      id: t.id,
      name: t.name,
      path: t.path,
      icon: t.icon,
      desc: t.description,
    }))

  cleanupTargetsCache.set('targets', targets)
  return { targets, cached: false }
}

export function getDashboardStatsCached() {
  const { items: startupItems, cached: startupCached } = getStartupItemsCached()
  const { extensions, cached: extCached } = getExtensionsCached()

  return {
    enabledStartup: startupItems.filter(i => !i.disabled).length,
    disabledStartup: startupItems.filter(i => i.disabled).length,
    totalStartup: startupItems.length,
    extensions: extensions.length,
    cached: startupCached && extCached,
  }
}
