/* eslint-disable no-console, ts/no-top-level-await */
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import process from 'node:process'
import puppeteer from 'puppeteer'

const base = process.env.BASE_URL || 'http://127.0.0.1:3457'
const browser = await puppeteer.launch({ headless: true, executablePath: process.env.PUPPETEER_EXECUTABLE_PATH })
mkdirSync('.shots', { recursive: true })
const page = await browser.newPage()
await page.setViewport({ width: 715, height: 640 })
let stage = 'ready'
let checkCalls = 0
let checkResult = 'ready'
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
    if (route.endsWith('/check')) {
      checkCalls++
      stage = checkResult
    }
    if (route.endsWith('/download')) stage = 'downloading'
    return request.respond({ status: failInstall && route.endsWith('/install') ? 500 : 200,
      contentType: 'application/json', body: JSON.stringify({ success: stage !== 'error', stage, currentVersion: '0.3.19', latestVersion: '0.3.20',
        error: stage === 'error' ? 'The installer could not replace this copy.' : null,
        percent: stage === 'downloading' ? 40 : 100,
        bytesDownloaded: stage === 'downloading' ? 14000000 : 35000000, bytesTotal: 35000000 }) })
  }
  // The product update should stay usable even if the separate system scan
  // never finishes.
  if (route === '/api/updates-check') return
  return request.continue()
})
try {
  await page.goto(`${base}/app/settings`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.set-row[data-pane-link="software-update"]')
  await page.click('.set-row[data-pane-link="software-update"]')
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
      const heading = document.querySelector('.self-update-summary')!.getBoundingClientRect()
      const actions = document.querySelector('.self-update-actions')!.getBoundingClientRect()
      const card = document.querySelector('.self-update-card')!.getBoundingClientRect()
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
  await page.waitForSelector('.set-row[data-pane-link="software-update"]')
  await page.click('.set-row[data-pane-link="software-update"]')
  await page.waitForSelector('[data-install-update]', { visible: true })
  await page.evaluate(() => { window.nativeConfirm = async () => true })
  await page.click('[data-install-update]')
  await page.waitForSelector('.self-update-error', { visible: true })
  assert.match(await page.$eval('.self-update-error', element => element.textContent || ''), /could not replace/)
  assert.equal(installCalls, 2)

  stage = 'idle'
  checkResult = 'available'
  await page.setViewport({ width: 720, height: 760 })
  await page.goto(`${base}/app/updates`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.self-update-primary', { visible: true })
  assert.equal(checkCalls, 1)
  assert.match(await page.$eval('.self-update-primary', element => element.textContent || ''), /Download Update/)
  await page.click('.self-update-primary')
  await page.waitForSelector('progress[aria-label="Update download progress"]', { visible: true })
  await page.waitForFunction(() => document.querySelector<HTMLProgressElement>('progress[aria-label="Update download progress"]')?.value === 40)
  await page.waitForFunction(() => document.querySelector('.self-update-reading')?.textContent?.includes('40%'))
  stage = 'ready'
  await page.waitForSelector('[data-install-update]', { visible: true })
  assert.deepEqual(errors, [])
  console.log('Update layout, confirmation, error recovery, progress, and independence from the system scan passed')
}
finally { await browser.close() }
