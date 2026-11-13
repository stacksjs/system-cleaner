/* eslint-disable no-console, ts/no-top-level-await */
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import process from 'node:process'
import puppeteer from 'puppeteer'

const base = process.env.BASE_URL || 'http://127.0.0.1:50297'
const browser = await puppeteer.launch({ headless: true })
const page = await browser.newPage()
const errors: string[] = []
page.on('pageerror', error => errors.push(String(error)))
mkdirSync('.shots/toolbar', { recursive: true })
const disabled = (selector: string) => page.$eval(selector, el => (el as HTMLButtonElement).disabled)
const back = '[data-toolbar-back]'
const forward = '[data-toolbar-forward]'
async function click(selector: string): Promise<void> {
  // Wait for the SPA view transition to hand pointer input back to the page.
  await page.waitForFunction((selector) => {
    const el = document.querySelector(selector)
    if (!el) return false
    const box = el.getBoundingClientRect()
    return el.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
  }, {}, selector)
  await page.click(selector)
}
async function route(path: string): Promise<void> {
  await page.waitForFunction(path => location.pathname === path, {}, path)
  await page.waitForSelector('.main-header')
}
try {
  await page.setViewport({ width: 1400, height: 900 })
  await page.goto(`${base}/app`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-toolbar-sidebar][aria-expanded="true"]')
  assert(await disabled(back))
  assert(await disabled(forward))
  await click('.rail-item[href="/app/startup"]')
  await route('/app/startup')
  await page.waitForFunction(() => !(document.querySelector('[data-toolbar-back]') as HTMLButtonElement).disabled)
  assert(await disabled(forward))
  await click(back)
  await route('/app')
  await page.waitForFunction(() => !(document.querySelector('[data-toolbar-forward]') as HTMLButtonElement).disabled)
  assert(await disabled(back))
  await click(forward)
  await route('/app/startup')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-toolbar-sidebar]')
  assert.equal(await disabled(back), false, 'Reload preserves history availability')
  assert(await disabled(forward))
  await click(back)
  await route('/app')
  await click('.rail-item[href="/app/processes"]')
  await route('/app/processes')
  assert(await disabled(forward), 'New navigation clears the forward boundary')
  await click('[data-toolbar-sidebar]')
  await page.waitForSelector('html[data-sidebar-collapsed]')
  assert.equal(await page.$eval('[data-toolbar-sidebar]', el => el.getAttribute('aria-expanded')), 'false')
  await click('[data-toolbar-sidebar]')
  await page.waitForSelector('html:not([data-sidebar-collapsed])')
  await click('[data-profile-chip]')
  await page.waitForSelector('[data-profile-menu]', { visible: true })
  await page.keyboard.press('ArrowUp')
  assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute('data-open-settings')), true)
  await page.keyboard.press('Escape')
  assert.equal(await page.$eval('[data-profile-chip]', el => el.getAttribute('aria-expanded')), 'false')
  for (const mode of ['light', 'dark']) {
    await page.evaluate(mode => localStorage.setItem('systemcleaner-appearance', JSON.stringify({ colorMode: mode, sidebarStyle: 'macos' })), mode)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForFunction(mode => document.documentElement.dataset.colorMode === mode, {}, mode)
    await page.waitForFunction(() => document.querySelector('[data-profile-name]')?.textContent !== 'This Mac')
    for (const width of [1400, 660, 480]) {
      await page.setViewport({ width, height: 900 })
      const geometry = await page.evaluate(() => {
        const toolbar = document.querySelector('.topnav')!.getBoundingClientRect()
        const navigation = document.querySelector('.toolbar-navigation')!.getBoundingClientRect()
        const account = document.querySelector('[data-profile-chip]')!.getBoundingClientRect()
        return { height: toolbar.height, navigationRight: navigation.right, accountLeft: account.left, accountRight: account.right, width: innerWidth }
      })
      assert.equal(geometry.height, 32)
      assert(geometry.navigationRight < geometry.accountLeft)
      assert(geometry.accountRight < geometry.width)
      await page.screenshot({ path: `.shots/toolbar/${mode}-${width}.png` })
    }
  }
  assert.deepEqual(errors, [])
  console.log('Toolbar history, reload, branching, sidebar, keyboard menu, and responsive light/dark layout passed')
}
finally { await browser.close() }
