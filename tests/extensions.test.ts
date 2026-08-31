import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { HOME } from '../packages/core/src/paths'
import { extensionSize, extensionsPage, isExtensionPath, isWebStoreId, removeExtensions } from '../packages/clean/src/extensions'
import { blockedByRunningBrowser } from '../packages/clean/src/browser'

/**
 * Extension removal deletes files inside a browser profile, so the tests that
 * matter are the guards: where a path is allowed to be, and what happens to an
 * id that no scan produced.
 */

const TMP_ROOT = fs.realpathSync(os.tmpdir())
let ROOT: string

const CHROME_BASE = path.join(HOME, 'Library/Application Support/Google/Chrome')

beforeAll(() => {
  ROOT = fs.mkdtempSync(path.join(TMP_ROOT, 'system-cleaner-extensions-'))
})

afterAll(() => {
  const resolved = fs.realpathSync(ROOT)
  if (!resolved.startsWith(`${TMP_ROOT}${path.sep}`))
    throw new Error(`refusing to rm outside tmpdir: ${resolved}`)
  fs.rmSync(resolved, { recursive: true, force: true })
})

describe('isWebStoreId', () => {
  // Exactly 32 characters from a–p. Anything else was sideloaded or loaded
  // unpacked, which means there is no sync entry to bring it back.
  it('recognises a Web Store id', () => {
    expect(isWebStoreId('cjpalhdlnbpafiamejdnhcphjbkeiagm')).toBe(true)
  })

  it('rejects ids that are not Web Store ids', () => {
    expect(isWebStoreId('cjpalhdlnbpafiamejdnhcphjbkeiag')).toBe(false)
    expect(isWebStoreId('cjpalhdlnbpafiamejdnhcphjbkeiagmm')).toBe(false)
    expect(isWebStoreId('CJPALHDLNBPAFIAMEJDNHCPHJBKEIAGM')).toBe(false)
    expect(isWebStoreId('uBlock0@raymondhill.net')).toBe(false)
    expect(isWebStoreId('{d10d0bf8-f5b5-c8b4-a8b2-2b9879e08c5d}')).toBe(false)
    // 'z' is outside the a–p alphabet Chromium uses.
    expect(isWebStoreId('zjpalhdlnbpafiamejdnhcphjbkeiagm')).toBe(false)
  })
})

describe('isExtensionPath', () => {
  it('accepts a path inside the browser profile', () => {
    expect(isExtensionPath('Chrome', path.join(CHROME_BASE, 'Default/Extensions/abc'))).toBe(true)
    expect(isExtensionPath('Chrome', path.join(CHROME_BASE, 'Profile 2/Extensions/abc'))).toBe(true)
  })

  // The second gate, and the one that does not depend on the scan being right.
  it('refuses anything outside it', () => {
    expect(isExtensionPath('Chrome', path.join(HOME, 'Documents/taxes'))).toBe(false)
    expect(isExtensionPath('Chrome', '/etc/passwd')).toBe(false)
    expect(isExtensionPath('Chrome', HOME)).toBe(false)
  })

  it('refuses a path that traverses back out of the profile', () => {
    expect(isExtensionPath('Chrome', path.join(CHROME_BASE, 'Default/Extensions/../../../../../Documents'))).toBe(false)
  })

  it('refuses the profile root itself', () => {
    expect(isExtensionPath('Chrome', CHROME_BASE)).toBe(false)
  })

  it('does not let one browser reach into another', () => {
    expect(isExtensionPath('Firefox', path.join(CHROME_BASE, 'Default/Extensions/abc'))).toBe(false)
  })

  it('refuses a browser it does not know', () => {
    expect(isExtensionPath('Netscape', path.join(CHROME_BASE, 'Default/Extensions/abc'))).toBe(false)
  })
})

describe('extensionSize', () => {
  it('sums a directory tree', () => {
    const dir = path.join(ROOT, 'ext/1.2.3')
    fs.mkdirSync(path.join(dir, 'js'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'manifest.json'), '{"a":1}')
    fs.writeFileSync(path.join(dir, 'js/background.js'), 'x'.repeat(100))

    expect(extensionSize(path.join(ROOT, 'ext'))).toBe(107)
  })

  it('reports a single file for a Firefox xpi', () => {
    const xpi = path.join(ROOT, 'addon.xpi')
    fs.writeFileSync(xpi, Buffer.alloc(2048))
    expect(extensionSize(xpi)).toBe(2048)
  })

  it('is zero for a path that is not there', () => {
    expect(extensionSize(path.join(ROOT, 'nothing'))).toBe(0)
  })
})

describe('removeExtensions', () => {
  // Ids are resolved against a fresh scan, so a caller cannot name something
  // the scan never produced and have it deleted.
  it('skips an id no scan produced rather than acting on it', async () => {
    const outcome = await removeExtensions(['chrome-notarealextensionidatall'])

    expect(outcome.removed).toEqual([])
    expect(outcome.failed).toEqual([])
    expect(outcome.skipped).toHaveLength(1)
    expect(outcome.skipped[0].reason).toContain('No longer installed')
  })

  it('does nothing when given nothing', async () => {
    const outcome = await removeExtensions([])
    expect(outcome.removed).toEqual([])
    expect(outcome.skipped).toEqual([])
    expect(outcome.freedBytes).toBe(0)
  })
})

describe('extensionsPage', () => {
  it('knows where each browser keeps its extensions page', () => {
    expect(extensionsPage('Chrome')).toEqual({ app: 'Google Chrome', url: 'chrome://extensions' })
    expect(extensionsPage('Firefox')).toEqual({ app: 'Firefox', url: 'about:addons' })
  })

  it('returns null for a browser it does not know', () => {
    expect(extensionsPage('Netscape')).toBeNull()
  })
})

/**
 * The rule that stops both the privacy clean and the extension remover writing
 * into a browser that is open.
 *
 * Deleting an extension or a cookie database out from under a running browser
 * does not uninstall or clear anything — it corrupts the profile, and the
 * damage only surfaces at the next launch, long after anyone would connect it
 * to this app. The check takes the running set as an argument precisely so it
 * can be proven here without a browser open.
 */
describe('blockedByRunningBrowser', () => {
  it('blocks the browser that is open', () => {
    expect(blockedByRunningBrowser('Chrome', ['Chrome'], 'remove')).toContain('Quit Chrome first')
    expect(blockedByRunningBrowser('Chrome', ['Chrome'], 'clear')).toContain('Quit Chrome first')
  })

  it('lets every other browser through', () => {
    expect(blockedByRunningBrowser('Firefox', ['Chrome', 'Safari'], 'remove')).toBeNull()
    expect(blockedByRunningBrowser('Chrome', [], 'clear')).toBeNull()
  })

  it('explains the consequence rather than just refusing', () => {
    expect(blockedByRunningBrowser('Brave', ['Brave'], 'remove')).toContain('corrupts it')
    expect(blockedByRunningBrowser('Brave', ['Brave'], 'clear')).toContain('corrupts it')
  })

  // The two callers say different things because they are doing different
  // things, and a message about clearing data on an uninstall reads as a bug.
  it('words the reason for what the caller is doing', () => {
    expect(blockedByRunningBrowser('Edge', ['Edge'], 'remove')).toContain('removing an extension')
    expect(blockedByRunningBrowser('Edge', ['Edge'], 'clear')).toContain('writing to a live profile')
  })

  it('matches on the exact browser, not a prefix', () => {
    expect(blockedByRunningBrowser('Chrome', ['Chromium'], 'remove')).toBeNull()
  })
})
