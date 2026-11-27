import { describe, expect, it } from 'bun:test'
import { grantedFolders, homeIsGranted, isMacAppStoreBackend, realHomeFolder, SANDBOX_LIMITS } from '@system-cleaner/core'

/**
 * The App Store edition starts with `HOME` pointing at its container. These
 * pin how the launcher finds the real home folder and decides whether the
 * folder Craft holds open is enough to point the agent at it.
 */
const container = {
  HOME: '/Users/someone/Library/Containers/org.example.app/Data',
  APP_SANDBOX_CONTAINER_ID: 'org.example.app',
}

describe('the App Store edition home folder', () => {
  it('recovers the real home folder from the container path', () => {
    expect(realHomeFolder(container)).toBe('/Users/someone')
  })

  it('recognizes the Store backend and container without the sandbox environment flag', () => {
    const folder = '/Applications/SystemCleaner.app/Contents/MacOS'
    expect(isMacAppStoreBackend(folder + '/craft-backend', 'darwin')).toBe(true)
    expect(isMacAppStoreBackend(folder + '/SystemCleaner', 'darwin')).toBe(false)
    expect(isMacAppStoreBackend('/home/someone/craft-backend', 'linux')).toBe(false)

    const containerHome = { HOME: '/Users/someone/Library/Containers/org.stacksjs.system-cleaner/Data' }
    expect(realHomeFolder(containerHome)).toBe('/Users/someone')
    expect(homeIsGranted({ ...containerHome, CRAFT_SECURITY_SCOPED_PATHS: '/Users/someone' })).toBe(true)
    expect(homeIsGranted({ ...containerHome, CRAFT_SECURITY_SCOPED_PATHS: containerHome.HOME })).toBe(false)
  })

  it('leaves HOME alone outside the sandbox', () => {
    expect(realHomeFolder({ HOME: '/Users/someone' })).toBe('/Users/someone')
  })

  it('reads the folders Craft holds, one per line, absolute only', () => {
    expect(grantedFolders({ CRAFT_SECURITY_SCOPED_PATHS: '/Users/someone\nrelative\n/Volumes/Data\n' }))
      .toEqual(['/Users/someone', '/Volumes/Data'])
  })

  it('counts a grant of the home folder or a folder above it', () => {
    expect(homeIsGranted({ ...container, CRAFT_SECURITY_SCOPED_PATHS: '/Users/someone' })).toBe(true)
    expect(homeIsGranted({ ...container, CRAFT_SECURITY_SCOPED_PATHS: '/Users' })).toBe(true)
  })

  it('does not count a folder inside home, or a sibling sharing its prefix', () => {
    expect(homeIsGranted({ ...container, CRAFT_SECURITY_SCOPED_PATHS: '/Users/someone/Downloads' })).toBe(false)
    expect(homeIsGranted({ ...container, CRAFT_SECURITY_SCOPED_PATHS: '/Users/some' })).toBe(false)
    expect(homeIsGranted(container)).toBe(false)
  })

  it('gives every limit a reason without an em dash', () => {
    for (const [key, reason] of Object.entries(SANDBOX_LIMITS)) {
      expect(reason.length, key).toBeGreaterThan(20)
      expect(reason, key).not.toContain('—')
    }
  })
})
