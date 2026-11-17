import { describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * The privacy page promises the app goes online only when you ask it to. The
 * preloader runs on its own (on hover and when the window is idle), so it
 * may warm only requests that read this Mac. `updates-check` asks Pantry's
 * registry and the App Store; `updates-summary` is the local half and is the
 * only update request the preloader may make.
 */
describe('preloader stays off the network', () => {
  const source = fs.readFileSync(path.resolve(import.meta.dir, '../resources/scripts/prefetch.ts'), 'utf8')
  const screens = source.slice(source.indexOf('const SCREENS'), source.indexOf('const IDLE_LANES'))

  it('never warms a request that asks an update server', () => {
    expect(screens).not.toContain("'updates-check'")
    expect(screens).not.toContain("'self-update")
  })

  it('warms the local update summary where screens show it', () => {
    expect(screens).toContain("'updates-summary'")
  })
})
