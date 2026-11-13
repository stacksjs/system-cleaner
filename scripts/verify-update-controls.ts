/* eslint-disable no-console, ts/no-top-level-await */
import assert from 'node:assert/strict'
import process from 'node:process'
import puppeteer from 'puppeteer'

const base = process.env.BASE_URL || 'http://127.0.0.1:3457'
const browser = await puppeteer.launch({ headless: true })
const page = await browser.newPage()
await page.setViewport({ width: 715, height: 640 })
let stage = 'ready'
let installCalls = 0
let failInstall = false
let confirmCalls = 0
const errors: string[] = []
page.on('pageerror', error => errors.push(String(error)))
await page.setRequestInterception(true)
page.on('request', request => {
  const route = new URL(request.url()).pathname
  if (route.startsWith('/api/self-update/')) {
    if (route.endsWith('/install')) {
      installCalls++
      stage = failInstall ? 'error' : 'installing'
    }
    if (route.endsWith('/check')) stage = 'ready'
    return request.respond({ status: failInstall && route.endsWith('/install') ? 500 : 200,
      contentType: 'application/json', body: JSON.stringify({ success: stage !== 'error', stage, currentVersion: '0.3.19', latestVersion: '0.3.20',
        error: stage === 'error' ? 'The installer could not replace this copy.' : null, percent: 100, bytesDownloaded: 35000000, bytesTotal: 35000000 }) })
  }
  return request.continue()
})
try {
  await page.goto(`${base}/app/settings`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-pane-link="software-update"]')
  await page.click('[data-pane-link="software-update"]')
  await page.waitForSelector('[data-install-update]', { visible: true })
  assert.equal(await page.evaluate(() => typeof window.nativeConfirm), 'function')
  await page.exposeFunction('recordConfirmation', () => { confirmCalls++ })
  await page.evaluate(() => {
    window.nativeConfirm = async () => {
      await (window as unknown as { recordConfirmation: () => Promise<void> }).recordConfirmation()
      return true
    }
  })
  for (const mode of ['light', 'dark']) {
    await page.evaluate(mode => { document.documentElement.classList.toggle('dark', mode === 'dark') }, mode)
    const boxes = await page.evaluate(() => {
      const heading = document.querySelector('.set-update-summary')!.getBoundingClientRect()
      const actions = document.querySelector('.set-update-actions')!.getBoundingClientRect()
      const card = document.querySelector('.set-update-card')!.getBoundingClientRect()
      return { headingBottom: heading.bottom, actionsTop: actions.top, actionsRight: actions.right, cardRight: card.right }
    })
    assert(boxes.actionsTop > boxes.headingBottom, 'Actions have their own row')
    assert(boxes.actionsRight <= boxes.cardRight, 'Actions fit the card')
    await page.screenshot({ path: `.shots/update-${mode}.png` })
  }
  await page.click('[data-install-update]')
  await page.waitForFunction(() => document.querySelector('[data-install-update]')!.textContent?.includes('Installing'))
  assert.equal(installCalls, 1)
  assert.equal(confirmCalls, 1)
  assert.equal(await page.$eval('[data-install-update]', element => (element as HTMLButtonElement).disabled), true)

  stage = 'ready'
  failInstall = true
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-pane-link="software-update"]')
  await page.click('[data-pane-link="software-update"]')
  await page.waitForSelector('[data-install-update]', { visible: true })
  await page.evaluate(() => { window.nativeConfirm = async () => true })
  await page.click('[data-install-update]')
  await page.waitForSelector('.set-update-error', { visible: true })
  assert.match(await page.$eval('.set-update-error', element => element.textContent || ''), /could not replace/)
  assert.equal(installCalls, 2)
  assert.deepEqual(errors, [])
  console.log('Update layout, native dialog dependency, restart submission, busy state, and visible install errors passed')
}
finally { await browser.close() }
