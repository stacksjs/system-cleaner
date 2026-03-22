import type { CLI } from '@stacksjs/clapp'
import { exec, formatBytes, formatPercent, getSystemInfo } from '@system-cleaner/core'
import { getMemoryMetrics } from '@system-cleaner/monitor'

interface CheckResult {
  name: string
  status: 'pass' | 'warn' | 'fail' | 'info'
  message: string
}

export function registerCheckCommand(app: CLI): void {
  app.command('check', 'System health and security checks (FileVault, Firewall, SIP, disk, memory, updates)')
    .option('--json', 'Output as JSON')
    .action(async (options: any) => {
      const { spinner, log, intro, outro } = await import('@stacksjs/clapp')

      intro('System Cleaner — System Check')

      const s = spinner()
      s.start('Running system checks...')

      const checks: CheckResult[] = []

      // Run all checks concurrently
      const results = await Promise.allSettled([
        checkFileVault(),
        checkFirewall(),
        checkSip(),
        checkGatekeeper(),
        checkDiskSpace(),
        checkMemory(),
        checkSwap(),
        checkHomebrewUpdates(),
        checkMacosUpdates(),
        checkTouchIdSudo(),
        checkRosetta(),
        checkGitConfig(),
      ])

      for (const result of results) {
        if (result.status === 'fulfilled')
          checks.push(result.value)
      }

      s.stop(`Completed ${checks.length} checks`)

      if (options.json) {
        console.log(JSON.stringify({ checks }, null, 2))
        return
      }

      const icons = { pass: '✓', warn: '⚠', fail: '✗', info: '●' }
      const colors = { pass: '\x1b[32m', warn: '\x1b[33m', fail: '\x1b[31m', info: '\x1b[36m' }
      const reset = '\x1b[0m'

      log.info('')

      // Security
      log.info('──── Security ────────────────────────')
      for (const c of checks.filter(c => ['FileVault', 'Firewall', 'SIP', 'Gatekeeper'].includes(c.name))) {
        console.log(`  ${colors[c.status]}${icons[c.status]}${reset} ${c.name}: ${c.message}`)
      }

      // Health
      log.info('')
      log.info('──── Health ──────────────────────────')
      for (const c of checks.filter(c => ['Disk Space', 'Memory', 'Swap'].includes(c.name))) {
        console.log(`  ${colors[c.status]}${icons[c.status]}${reset} ${c.name}: ${c.message}`)
      }

      // Config
      log.info('')
      log.info('──── Configuration ───────────────────')
      for (const c of checks.filter(c => ['Touch ID sudo', 'Rosetta', 'Git Config'].includes(c.name))) {
        console.log(`  ${colors[c.status]}${icons[c.status]}${reset} ${c.name}: ${c.message}`)
      }

      // Updates
      log.info('')
      log.info('──── Updates ─────────────────────────')
      for (const c of checks.filter(c => ['Homebrew Updates', 'macOS Updates'].includes(c.name))) {
        console.log(`  ${colors[c.status]}${icons[c.status]}${reset} ${c.name}: ${c.message}`)
      }

      const passCount = checks.filter(c => c.status === 'pass').length
      const warnCount = checks.filter(c => c.status === 'warn').length
      const failCount = checks.filter(c => c.status === 'fail').length

      log.info('')
      outro(`${passCount} passed, ${warnCount} warnings, ${failCount} issues`)
    })
}

async function checkFileVault(): Promise<CheckResult> {
  const r = await exec('fdesetup status 2>/dev/null', { timeout: 5000 })
  const on = r.ok && r.stdout.includes('FileVault is On')
  return { name: 'FileVault', status: on ? 'pass' : 'warn', message: on ? 'Encryption enabled' : 'Disk encryption is OFF' }
}

async function checkFirewall(): Promise<CheckResult> {
  // Check for third-party firewalls first (ERE alternation uses | not \|)
  const thirdParty = await exec('pgrep -x "LuLu|Little Snitch Agent|Radio Silence" 2>/dev/null', { timeout: 2000 })
  if (thirdParty.ok)
    return { name: 'Firewall', status: 'pass', message: 'Third-party firewall detected' }

  const r = await exec('defaults read /Library/Preferences/com.apple.alf globalstate 2>/dev/null', { timeout: 3000 })
  const state = Number.parseInt(r.stdout) || 0
  if (state >= 1)
    return { name: 'Firewall', status: 'pass', message: 'macOS firewall enabled' }
  return { name: 'Firewall', status: 'warn', message: 'macOS firewall is OFF' }
}

async function checkSip(): Promise<CheckResult> {
  const r = await exec('csrutil status 2>/dev/null', { timeout: 3000 })
  const enabled = r.ok && r.stdout.includes('enabled')
  return { name: 'SIP', status: enabled ? 'pass' : 'fail', message: enabled ? 'System Integrity Protection enabled' : 'SIP is DISABLED' }
}

async function checkGatekeeper(): Promise<CheckResult> {
  const r = await exec('spctl --status 2>/dev/null', { timeout: 3000 })
  const enabled = r.ok && r.stdout.includes('assessments enabled')
  return { name: 'Gatekeeper', status: enabled ? 'pass' : 'warn', message: enabled ? 'App notarization enabled' : 'Gatekeeper is disabled' }
}

async function checkDiskSpace(): Promise<CheckResult> {
  const r = await exec('df -k / 2>/dev/null | tail -1', { timeout: 3000 })
  if (!r.ok)
    return { name: 'Disk Space', status: 'info', message: 'Could not check' }
  const parts = r.stdout.split(/\s+/)
  const freeKB = Number.parseInt(parts[3]) || 0
  const freeGB = freeKB / 1e6
  if (freeGB < 20)
    return { name: 'Disk Space', status: 'fail', message: `Critical: only ${freeGB.toFixed(1)} GB free` }
  if (freeGB < 50)
    return { name: 'Disk Space', status: 'warn', message: `Low: ${freeGB.toFixed(1)} GB free` }
  return { name: 'Disk Space', status: 'pass', message: `${freeGB.toFixed(1)} GB free` }
}

async function checkMemory(): Promise<CheckResult> {
  const mem = await getMemoryMetrics()
  if (mem.usagePercent > 90)
    return { name: 'Memory', status: 'fail', message: `${formatPercent(mem.usagePercent)} used — ${formatBytes(mem.freeBytes)} free` }
  if (mem.usagePercent > 75)
    return { name: 'Memory', status: 'warn', message: `${formatPercent(mem.usagePercent)} used` }
  return { name: 'Memory', status: 'pass', message: `${formatPercent(mem.usagePercent)} used — ${formatBytes(mem.freeBytes)} free` }
}

async function checkSwap(): Promise<CheckResult> {
  const r = await exec('sysctl -n vm.swapusage 2>/dev/null', { timeout: 3000 })
  if (!r.ok)
    return { name: 'Swap', status: 'info', message: 'Could not check' }
  const usedMatch = r.stdout.match(/used\s*=\s*([\d.]+)(\w)/)
  if (usedMatch) {
    let usedMB = Number.parseFloat(usedMatch[1])
    if (usedMatch[2] === 'G')
      usedMB *= 1024
    if (usedMB > 2048)
      return { name: 'Swap', status: 'warn', message: `${(usedMB / 1024).toFixed(1)} GB swap used` }
    return { name: 'Swap', status: 'pass', message: usedMB > 0 ? `${usedMB.toFixed(0)} MB swap used` : 'No swap usage' }
  }
  return { name: 'Swap', status: 'pass', message: 'No swap usage' }
}

async function checkHomebrewUpdates(): Promise<CheckResult> {
  const r = await exec('brew outdated 2>/dev/null | wc -l', { timeout: 60_000 })
  if (!r.ok)
    return { name: 'Homebrew Updates', status: 'info', message: 'Homebrew not installed or unavailable' }
  const count = Number.parseInt(r.stdout.trim()) || 0
  if (count > 10)
    return { name: 'Homebrew Updates', status: 'warn', message: `${count} outdated packages` }
  if (count > 0)
    return { name: 'Homebrew Updates', status: 'info', message: `${count} outdated packages` }
  return { name: 'Homebrew Updates', status: 'pass', message: 'All packages up to date' }
}

async function checkMacosUpdates(): Promise<CheckResult> {
  // --no-scan uses cached results (fast but may be stale)
  const r = await exec('softwareupdate -l --no-scan 2>&1', { timeout: 15_000 })
  if (!r.ok || r.stdout.includes('No new software available'))
    return { name: 'macOS Updates', status: 'pass', message: 'System up to date (cached check)' }
  const count = (r.stdout.match(/\*/g) || []).length
  if (count > 0)
    return { name: 'macOS Updates', status: 'warn', message: `${count} update(s) available` }
  return { name: 'macOS Updates', status: 'pass', message: 'System up to date' }
}

async function checkTouchIdSudo(): Promise<CheckResult> {
  const r = await exec('grep -q pam_tid /etc/pam.d/sudo_local 2>/dev/null || grep -q pam_tid /etc/pam.d/sudo 2>/dev/null', { timeout: 2000 })
  return { name: 'Touch ID sudo', status: r.ok ? 'pass' : 'info', message: r.ok ? 'Touch ID enabled for sudo' : 'Touch ID not configured for sudo' }
}

async function checkRosetta(): Promise<CheckResult> {
  const r = await exec('pgrep -q oahd 2>/dev/null', { timeout: 2000 })
  return { name: 'Rosetta', status: 'info', message: r.ok ? 'Rosetta 2 is installed' : 'Rosetta 2 not installed (native ARM)' }
}

async function checkGitConfig(): Promise<CheckResult> {
  const [name, email] = await Promise.all([
    exec('git config --global user.name 2>/dev/null', { timeout: 2000 }),
    exec('git config --global user.email 2>/dev/null', { timeout: 2000 }),
  ])
  if (name.ok && name.stdout && email.ok && email.stdout)
    return { name: 'Git Config', status: 'pass', message: `${name.stdout} <${email.stdout}>` }
  return { name: 'Git Config', status: 'warn', message: 'Git user.name or user.email not set' }
}
