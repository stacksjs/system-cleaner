import type { CLI } from '@stacksjs/clapp'
import { exec } from '@system-cleaner/core'
import * as fs from 'node:fs'

export function registerTouchIdCommand(app: CLI): void {
  app.command('touchid [action]', 'Configure Touch ID for sudo (enable/disable/status)')
    .action(async (action: string | undefined) => {
      const { select, confirm, log, intro, outro } = await import('@stacksjs/clapp')

      intro('System Cleaner — Touch ID for sudo')

      // Check support
      const archResult = await exec('uname -m', { timeout: 2000 })
      const isArm = archResult.ok && archResult.stdout.includes('arm64')
      const bioutilResult = await exec('bioutil -rs 2>/dev/null', { timeout: 2000 })
      const hasBioutil = bioutilResult.ok

      if (!isArm && !hasBioutil) {
        log.warn('Touch ID not supported on this hardware')
        outro('Done')
        return
      }

      // Check current status
      const sudoLocalExists = fs.existsSync('/etc/pam.d/sudo_local')
      const sudoLocalHasTid = sudoLocalExists && fs.readFileSync('/etc/pam.d/sudo_local', 'utf8').includes('pam_tid.so')
      const sudoHasTid = fs.readFileSync('/etc/pam.d/sudo', 'utf8').includes('pam_tid.so')
      const isEnabled = sudoLocalHasTid || sudoHasTid

      if (!action) {
        action = await select({
          message: `Touch ID for sudo is ${isEnabled ? 'ENABLED' : 'DISABLED'}. What would you like to do?`,
          options: [
            { value: 'status', label: 'Show status' },
            { value: isEnabled ? 'disable' : 'enable', label: isEnabled ? 'Disable Touch ID for sudo' : 'Enable Touch ID for sudo' },
          ],
        }) as string
      }

      if (action === 'status') {
        log.info(`Touch ID for sudo: ${isEnabled ? 'ENABLED' : 'DISABLED'}`)
        if (sudoLocalHasTid) log.info('  Configured via /etc/pam.d/sudo_local (modern)')
        else if (sudoHasTid) log.info('  Configured via /etc/pam.d/sudo (legacy)')
        outro('Done')
        return
      }

      if (action === 'enable') {
        if (isEnabled) {
          log.info('Touch ID for sudo is already enabled')
          outro('Done')
          return
        }

        const ok = await confirm({ message: 'Enable Touch ID for sudo? (requires admin password)' })
        if (!ok) {
          outro('Cancelled')
          return
        }

        // Modern approach: /etc/pam.d/sudo_local (macOS Sonoma+)
        const pamLine = 'auth       sufficient     pam_tid.so'

        if (sudoLocalExists) {
          const result = await exec(`echo '${pamLine}' | sudo tee -a /etc/pam.d/sudo_local > /dev/null`, { timeout: 30_000 })
          if (result.ok) {
            log.success('Touch ID enabled for sudo (via sudo_local)')
          }
          else {
            // Try creating the file
            const result2 = await exec(`echo '${pamLine}' | sudo tee /etc/pam.d/sudo_local > /dev/null`, { timeout: 30_000 })
            if (result2.ok) log.success('Touch ID enabled for sudo')
            else log.error('Failed to enable Touch ID. Try manually: sudo nano /etc/pam.d/sudo_local')
          }
        }
        else {
          // Create sudo_local with the line
          const result = await exec(`echo '${pamLine}' | sudo tee /etc/pam.d/sudo_local > /dev/null`, { timeout: 30_000 })
          if (result.ok) log.success('Touch ID enabled for sudo (created sudo_local)')
          else log.error('Failed to enable. Try: sudo nano /etc/pam.d/sudo_local')
        }
      }

      if (action === 'disable') {
        if (!isEnabled) {
          log.info('Touch ID for sudo is already disabled')
          outro('Done')
          return
        }

        const ok = await confirm({ message: 'Disable Touch ID for sudo? (requires admin password)' })
        if (!ok) {
          outro('Cancelled')
          return
        }

        if (sudoLocalHasTid) {
          await exec(`sudo sed -i '' '/pam_tid.so/d' /etc/pam.d/sudo_local`, { timeout: 10_000 })
          log.success('Touch ID disabled for sudo')
        }
        else if (sudoHasTid) {
          await exec(`sudo sed -i '' '/pam_tid.so/d' /etc/pam.d/sudo`, { timeout: 10_000 })
          log.success('Touch ID disabled for sudo (legacy file)')
        }
      }

      outro('Done')
    })
}
