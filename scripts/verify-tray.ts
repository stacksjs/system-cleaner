/* eslint-disable no-console, ts/no-top-level-await */
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import process from 'node:process'
import puppeteer from 'puppeteer'

const base = process.env.BASE_URL || 'http://127.0.0.1:50297'
const browser = await puppeteer.launch({ headless: true })
const page = await browser.newPage()
await page.setViewport({ width: 360, height: 460 })
const errors: string[] = []
page.on('pageerror', error => errors.push(String(error)))
mkdirSync('.shots/tray', { recursive: true })
let fail = false
let requests = 0
let cpu = 23
await page.evaluateOnNewDocument(() => {
  const calls: { method: string, value?: unknown }[] = []
  const record = (method: string) => async (value?: unknown) => { calls.push({ method, value }) }
  Object.assign(window, { trayCalls: calls, craft: {
    window: { open: async (options: { name: string }) => { calls.push({ method: 'open', value: options }); return { name: options.name } }, hide: record('hide'), show: record('show'), setAppearance: record('appearance') },
    app: { showDockIcon: record('dock'), quit: record('quit') },
    menu: { set: record('app-menu') },
    tray: { setIcon: record('icon'), setTitle: record('title'), setTooltip: record('tooltip'), setMenu: record('menu'), onMenuAction: () => {} },
  } })
})
await page.setRequestInterception(true)
page.on('request', request => {
  const path = new URL(request.url()).pathname
  if (path === '/api/platform') return request.respond({ contentType: 'application/json', body: JSON.stringify({ platform: 'macos' }) })
  if (path === '/api/system-status') {
    requests++
    return request.respond({ status: fail ? 503 : 200, contentType: 'application/json', body: JSON.stringify(fail ? { success: false } : {
      success: true, sampledAt: Date.now(), hostname: 'Chris’s MacBook', uptimeSeconds: 186000,
      cpu: { percent: cpu, model: 'Apple M3 Pro', cores: 11 },
      memory: { totalBytes: 18000000000, usedBytes: 12000000000, availableBytes: 6000000000, usedPercent: 67 },
      disk: { totalBytes: 500000000000, usedBytes: 380000000000, freeBytes: 120000000000, usedPercent: 76 },
    }) })
  }
  return request.continue()
})
try {
  await page.goto(`${base}/app/tray`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.querySelector('[data-stat="cpu"]')?.textContent === '23%')
  await page.waitForFunction(() => (window as unknown as { trayCalls: { method: string }[] }).trayCalls.some(call => call.method === 'app-menu'))
  await page.evaluate(() => {
    const calls = (window as unknown as { trayCalls: { method: string, value?: { menus: { items: { label?: string, id?: string }[] }[] } }[] }).trayCalls
    const overview = calls.find(call => call.method === 'app-menu')?.value?.menus.flatMap(menu => menu.items).find(item => item.label === 'System Overview')
    if (!overview?.id) throw new Error('Missing native overview command')
    window.dispatchEvent(new CustomEvent('craft:menu:action', { detail: { id: overview.id } }))
  })
  await page.waitForFunction(() => (window as unknown as { trayCalls: { method: string }[] }).trayCalls.some(call => call.method === 'show'))
  assert.equal(await page.$eval('[data-stat="disk-free"]', el => el.textContent), '120.0 GB')
  assert.equal(await page.$eval('[data-stat="memory-used"]', el => el.textContent), '12.0 GB')
  const calls = await page.evaluate(() => (window as unknown as { trayCalls: { method: string, value?: unknown }[] }).trayCalls)
  assert(calls.some(call => call.method === 'icon' && typeof call.value === 'string' && call.value.startsWith('data:image/png;base64,')))
  assert(calls.some(call => call.method === 'title' && call.value === ''))
  assert(calls.some(call => call.method === 'open' && (call.value as { name?: string }).name === 'dashboard'))
  assert(calls.some(call => call.method === 'tooltip' && String(call.value).includes('120.0 GB free')))
  await page.evaluate(() => window.dispatchEvent(new Event('craft:window:focus')))
  cpu = 61
  await page.waitForFunction(() => document.querySelector('[data-stat="cpu"]')?.textContent === '61%')
  await page.evaluate(() => window.dispatchEvent(new Event('craft:window:blur')))
  const before = requests
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 3400)))
  assert.equal(requests, before, 'The hidden popover stops polling')
  fail = true
  await page.click('[aria-label="Refresh stats"]')
  await page.waitForFunction(() => document.body.innerText.includes('Connection lost'))
  assert.equal(await page.$eval('[data-stat="cpu"]', el => el.textContent), '61%', 'Offline retains the last measurement')
  fail = false
  await page.click('[aria-label="Refresh stats"]')
  await page.waitForFunction(() => !document.body.innerText.includes('Connection lost'))
  await page.click('[aria-label="Settings"]')
  await page.click('.tray-open')
  await page.keyboard.press('Escape')
  await page.evaluate(() => {
    const channel = new BroadcastChannel('systemcleaner-tray')
    channel.postMessage({ action: 'show' })
    channel.close()
  })
  await page.waitForFunction(() => (window as unknown as { trayCalls: { method: string }[] }).trayCalls.some(call => call.method === 'show'))
  const after = await page.evaluate(() => (window as unknown as { trayCalls: { method: string, value?: unknown }[] }).trayCalls)
  assert(after.some(call => call.method === 'open' && (call.value as { name?: string }).name === 'settings'))
  assert(after.some(call => call.method === 'hide'))
  for (const mode of ['light', 'dark']) {
    await page.evaluate(mode => document.documentElement.classList.toggle('dark', mode === 'dark'), mode)
    await page.screenshot({ path: `.shots/tray/${mode}.png` })
    const box = await page.$eval('.tray-panel', el => ({ content: el.scrollHeight, height: el.clientHeight }))
    assert(box.content <= box.height + 1, `All metrics and actions fit the native panel: ${JSON.stringify(box)}`)
  }
  const dashboard = await browser.newPage()
  await dashboard.setRequestInterception(true)
  dashboard.on('request', request => new URL(request.url()).pathname === '/api/platform'
    ? request.respond({ contentType: 'application/json', body: JSON.stringify({ platform: 'macos' }) })
    : request.continue())
  await dashboard.goto(`${base}/__health`)
  await dashboard.setContent(`<a data-rail-item href='/app'>Dashboard</a>`)
  await dashboard.evaluate(() => {
    Object.assign(window, { craft: { menu: { set: () => { throw new Error('Only the tray owns the macOS menu') } } } })
    document.querySelector('a')?.addEventListener('click', event => {
      event.preventDefault()
      document.body.dataset.navigated = 'true'
    })
  })
  dashboard.on('pageerror', error => errors.push(String(error)))
  await dashboard.addScriptTag({ url: `${base}/app-menu.js` })
  await page.evaluate(() => {
    const calls = (window as unknown as { trayCalls: { method: string, value?: { menus: { items: { label?: string, id?: string }[] }[] } }[] }).trayCalls
    const item = calls.find(call => call.method === 'app-menu')?.value?.menus.flatMap(menu => menu.items).find(item => item.label === 'Dashboard')
    window.dispatchEvent(new CustomEvent('craft:menu:action', { detail: { id: item?.id } }))
  })
  await dashboard.waitForFunction(() => document.body.dataset.navigated === 'true')
  await dashboard.close()
  assert.deepEqual(errors, [])
  console.log('Tray icon, startup, live stats, hidden polling, offline recovery, actions, and both appearances passed')
}
finally { await browser.close() }
