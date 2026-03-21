/**
 * Format bytes into a human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes < 0)
    return '0 B'
  if (bytes >= 1e12)
    return `${(bytes / 1e12).toFixed(1)} TB`
  if (bytes >= 1e9)
    return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6)
    return `${(bytes / 1e6).toFixed(1)} MB`
  if (bytes >= 1e3)
    return `${(bytes / 1e3).toFixed(1)} KB`
  return `${bytes} B`
}

/**
 * Format bytes into a compact string (no space)
 */
export function formatBytesCompact(bytes: number): string {
  if (bytes < 0)
    return '0B'
  if (bytes >= 1e12)
    return `${(bytes / 1e12).toFixed(1)}TB`
  if (bytes >= 1e9)
    return `${(bytes / 1e9).toFixed(1)}GB`
  if (bytes >= 1e6)
    return `${(bytes / 1e6).toFixed(1)}MB`
  if (bytes >= 1e3)
    return `${(bytes / 1e3).toFixed(1)}KB`
  return `${bytes}B`
}

/**
 * Parse a human-readable byte string back to bytes
 */
export function parseBytes(str: string): number {
  const match = str.trim().match(/^([\d.]+)\s*(TB|GB|MB|KB|B)?$/i)
  if (!match)
    return 0
  const value = Number.parseFloat(match[1])
  const unit = (match[2] || 'B').toUpperCase()
  const multipliers: Record<string, number> = { TB: 1e12, GB: 1e9, MB: 1e6, KB: 1e3, B: 1 }
  return Math.round(value * (multipliers[unit] || 1))
}

/**
 * Format seconds into a human-readable duration
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60)
    return `${Math.round(seconds)}s`
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60)
    const s = Math.round(seconds % 60)
    return s > 0 ? `${m}m ${s}s` : `${m}m`
  }
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

/**
 * Format uptime into a readable string
 */
export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)

  if (days > 0)
    return `${days}d ${hours}h`
  if (hours > 0)
    return `${hours}h ${minutes}m`
  return `${minutes}m`
}

/**
 * Format a percentage value
 */
export function formatPercent(value: number, decimals = 0): string {
  return `${value.toFixed(decimals)}%`
}

/**
 * Format a number with comma separators
 */
export function formatNumber(value: number): string {
  return value.toLocaleString('en-US')
}

/**
 * Format a date to a relative time string
 */
export function formatRelativeTime(date: Date): string {
  const now = Date.now()
  const diff = now - date.getTime()

  if (diff < 60_000)
    return 'just now'
  if (diff < 3_600_000)
    return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000)
    return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 604_800_000)
    return `${Math.floor(diff / 86_400_000)}d ago`
  if (diff < 2_592_000_000)
    return `${Math.floor(diff / 604_800_000)}w ago`
  return `${Math.floor(diff / 2_592_000_000)}mo ago`
}

/**
 * Format a rate (e.g., network speed) per second
 */
export function formatRate(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`
}

/**
 * Escape a string for safe display in HTML
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Truncate a string to a maximum length with ellipsis
 */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen)
    return str
  return `${str.slice(0, maxLen - 1)}…`
}
