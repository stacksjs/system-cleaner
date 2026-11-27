import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import process from 'node:process'
import { isMacOS } from '@system-cleaner/core'

const RELEASE = 'v0.3.2'
const ASSETS = {
  arm64: 'f481429cf7cb8ff7304e34cef789798a5c1f232ad407b4e29944b39e3b22b222',
  x64: '968db7cb15359b7ec5db267fce454e912eb9f8d20c3a2cc0fd738a3d389caff1',
}

function installRoot(): string {
  return path.join(os.homedir(), 'Library', 'Application Support', 'SystemCleaner', 'Localtunnels')
}

export function installedVpnCli(release = RELEASE): string {
  return path.join(installRoot(), release, 'localtunnels')
}

export async function installVpnCore(): Promise<void> {
  const arch = process.arch
  if (!isMacOS || (arch !== 'arm64' && arch !== 'x64'))
    throw new Error('Localtunnels setup is available on macOS.')

  const root = installRoot()
  await fs.mkdir(root, { recursive: true, mode: 0o700 })
  const staging = await fs.mkdtemp(path.join(root, 'download-'))
  const filename = `localtunnels-darwin-${arch}`
  try {
    const response = await fetch(`https://github.com/stacksjs/localtunnels/releases/download/${RELEASE}/${filename}.zip`, {
      signal: AbortSignal.timeout(90_000),
    })
    if (!response.ok || !response.body)
      throw new Error(`Localtunnels download failed (HTTP ${response.status}).`)
    const archive = path.join(staging, 'release.zip')
    await Bun.write(archive, response)
    const digest = new Bun.CryptoHasher('sha256')
    for await (const chunk of Bun.file(archive).stream())
      digest.update(chunk)
    if (digest.digest('hex') !== ASSETS[arch])
      throw new Error('The Localtunnels download failed its integrity check.')

    const payload = path.join(staging, 'payload')
    await fs.mkdir(payload)
    const unpack = Bun.spawn(['/usr/bin/unzip', '-q', archive, filename, 'libltvpn.dylib', '-d', payload], {
      stderr: 'pipe',
    })
    const stderr = await new Response(unpack.stderr).text()
    if (await unpack.exited !== 0)
      throw new Error(stderr.trim() || 'Could not unpack Localtunnels.')
    const cli = path.join(payload, 'localtunnels')
    await fs.rename(path.join(payload, filename), cli)
    await fs.chmod(cli, 0o755)
    const check = Bun.spawn([cli, 'vpn:selftest'], { cwd: staging, stdout: 'pipe', stderr: 'ignore' })
    const output = await new Response(check.stdout).text()
    if (await check.exited !== 0 || !output.includes('VPN core is healthy.'))
      throw new Error('The downloaded Localtunnels core failed its self-test.')

    const target = path.dirname(installedVpnCli())
    // Publish only after the executable and its adjacent library both work.
    await fs.rename(payload, target).catch(async (error) => {
      if (error.code !== 'EEXIST' && error.code !== 'ENOTEMPTY')
        throw error
      // Repairs a previous installation without removing it until the replacement is ready.
      const backup = path.join(staging, 'previous')
      await fs.rename(target, backup)
      try {
        await fs.rename(payload, target)
      }
      catch (error) {
        await fs.rename(backup, target)
        throw error
      }
    })
  }
  finally {
    await fs.rm(staging, { recursive: true, force: true })
  }
}
