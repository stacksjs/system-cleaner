import { describe, expect, it } from 'bun:test'
import { version as rootVersion } from '../package.json'
import { createCLI } from '../packages/cli/src/index'

describe('cli version', () => {
  // The v0.1.2 binary shipped reporting 0.1.0 because the CLI hardcoded its
  // version string while `buddy release` only ever bumps the root manifest.
  it('reports the version the release actually tagged', () => {
    const registered = (createCLI() as { globalCommand: { versionNumber: string } }).globalCommand.versionNumber
    expect(registered).toBe(rootVersion)
  })

  it('does not hardcode a version literal', async () => {
    const source = await Bun.file('packages/cli/src/index.ts').text()
    expect(source).not.toMatch(/\.version\(\s*['"`]\d+\.\d+\.\d+/)
  })

  it('has a root version to read', () => {
    expect(rootVersion).toMatch(/^\d+\.\d+\.\d+/)
  })
})
