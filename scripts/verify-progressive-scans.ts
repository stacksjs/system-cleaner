/* eslint-disable no-console, ts/no-top-level-await */
import assert from 'node:assert/strict'
import process from 'node:process'
import puppeteer from 'puppeteer'

// BASE_URL=http://127.0.0.1:<agent-port> node --experimental-strip-types scripts/verify-progressive-scans.ts
const base = process.env.BASE_URL || 'http://127.0.0.1:3457'
const browser = await puppeteer.launch({ headless: true })
const page = await browser.newPage()
await page.setViewport({ width: 1400, height: 900 })
const errors: string[] = []
page.on('pageerror', error => errors.push(String(error)))
let kind = 'large-files'
let snapshot: Record<string, unknown> = {}
let scanning = false
let finish: (() => void) | undefined
let revealed = ''
await page.setRequestInterception(true)
page.on('request', async request => {
  const route = new URL(request.url()).pathname
  const json = (data: unknown) => request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
  if (route === '/api/last-scan') return json({ success: true, result: null })
  if (route === '/api/scan-progress') return json({ scanning, kind, scanned: 1500, path: '/Users/test/Documents', elapsedMs: 1500, snapshot })
  if (['/api/large-files', '/api/duplicates-scan', '/api/disk-scan'].includes(route)) {
    scanning = true
    await new Promise<void>(resolve => { finish = resolve })
    scanning = false
    return json({ success: true, ...snapshot, scanTime: '2s' })
  }
  if (route === '/api/reveal-in-finder') {
    revealed = JSON.parse(request.postData()!).path
    return json({ success: true })
  }
  return request.continue()
})
const file = (name: string, bytes: number) => ({ name, path: `/Users/test/${name}`, sizeBytes: bytes, sizeFormatted: `${bytes / 1024 / 1024} MB`, category: 'other', label: 'Other', icon: 'i-f7-doc', color: '#0088ff', protected: false })
try {
  console.log('Checking live largest files and stable selection')
  const first = file('first.bin', 200 * 1024 * 1024)
  const largest = file('largest.bin', 500 * 1024 * 1024)
  snapshot = { files: [first], matched: 1, totalBytes: first.sizeBytes }
  await page.goto(`${base}/app/large-files`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-rescan]')
  await page.click('[data-rescan]')
  await page.waitForSelector('[aria-label="Select first.bin"]', { visible: true })
  await page.click('[aria-label="Select first.bin"]')
  assert.equal(await page.$$eval('button', buttons => buttons.some(button => button.textContent?.includes('Move to Trash') && button.disabled)), true)
  snapshot = { files: [largest, first], matched: 2, totalBytes: first.sizeBytes + largest.sizeBytes }
  await page.waitForSelector('[aria-label="Select largest.bin"]', { visible: true })
  assert.equal(await page.$eval('tbody tr', row => row.textContent?.includes('largest.bin')), true)
  assert.equal(await page.$eval('[aria-label="Select first.bin"]', element => (element as HTMLInputElement).checked), true)
  assert.match(await page.$eval('.tbl-count', element => element.textContent || ''), /2 largest so far/)
  finish!()
  await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('[data-rescan]')!.disabled)

  console.log('Checking confirmed duplicates appear before completion')
  kind = 'duplicates'
  snapshot = { groups: [{ id: 'same-content', sizeBytes: 1024, sizeFormatted: '1 KB', count: 2, wastedBytes: 1024, wastedFormatted: '1 KB', files: [{ path: '/Users/test/original', name: 'original', directory: '/Users/test', sizeBytes: 1024, keep: true }, { path: '/Users/test/copy', name: 'copy', directory: '/Users/test', sizeBytes: 1024, keep: false }] }], groupCount: 1, duplicateCount: 1, wastedBytes: 1024, wastedFormatted: '1 KB' }
  await page.goto(`${base}/app/duplicates`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-rescan]')
  await page.click('[data-rescan]')
  await page.waitForFunction(() => document.body.innerText.includes('original') && document.body.innerText.includes('copy'))
  assert.equal(scanning, true)
  finish!()
  await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('[data-rescan]')!.disabled)

  console.log('Checking live disk chart, native context actions, and remount')
  kind = 'tree'
  const tree = { name: 'test', path: '/Users/test', sizeBytes: 900, isDirectory: true, children: [{ name: 'Movies', path: '/Users/test/Movies', sizeBytes: 600, isDirectory: true, children: [{ name: 'clip', path: '/Users/test/Movies/clip', sizeBytes: 600, isDirectory: false }] }, { name: 'Documents', path: '/Users/test/Documents', sizeBytes: 300, isDirectory: true }] }
  snapshot = { tree, totalBytes: tree.sizeBytes, folderCount: 2, fileCount: 1 }
  await page.goto(`${base}/app/disk`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => typeof (window as unknown as { startDiskScan: unknown }).startDiskScan === 'function')
  await page.evaluate(() => localStorage.removeItem('systemcleaner:disk-scan'))
  await page.evaluate(() => (window as unknown as { startDiskScan: () => void }).startDiskScan())
  await page.waitForSelector('#sunburst .segment', { visible: true })
  assert.equal(scanning, true)
  assert.match(await page.$eval('.disk-live-status', element => element.textContent || ''), /Updating disk usage/)
  // The actual host emits this event after displaying a native context menu.
  let revealRequest = page.waitForRequest(request => new URL(request.url()).pathname === '/api/reveal-in-finder')
  await page.evaluate(() => {
    const host = window as unknown as { craft: { nativeUI: { showContextMenu: (options: unknown) => void } } }
    host.craft = { nativeUI: { showContextMenu() {} } }
    document.querySelector('.segment')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
    window.dispatchEvent(new CustomEvent('craft:contextmenu:action', { detail: { id: 'sc.reveal', targetId: '/Users/test/Movies', targetType: 'general' } }))
  })
  await revealRequest
  console.log('Native context action reached the reveal endpoint')
  assert.equal(revealed, '/Users/test/Movies')
  console.log('Finishing disk scan')
  finish!()
  await page.waitForFunction(() => !document.querySelector<HTMLElement>('.disk-live-status')!.checkVisibility())
  console.log('Navigating away from disk chart')
  await page.evaluate(() => document.querySelector<HTMLAnchorElement>('[data-rail-item="large-files"]')!.click())
  await page.waitForSelector('[aria-label="Select every listed item"]')
  await page.evaluate(() => document.querySelector<HTMLAnchorElement>('[data-rail-item="disk"]')!.click())
  await page.waitForSelector('#sunburst .segment', { visible: true })
  revealed = ''
  revealRequest = page.waitForRequest(request => new URL(request.url()).pathname === '/api/reveal-in-finder')
  await page.evaluate(() => {
    document.querySelector('.segment')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
    window.dispatchEvent(new CustomEvent('craft:contextmenu:action', { detail: { id: 'sc.reveal', targetId: '/Users/test/Movies', targetType: 'general' } }))
  })
  await revealRequest
  assert.equal(revealed, '/Users/test/Movies')
  assert.deepEqual(errors, [])
  console.log('Progressive scans, stable selection, and native context actions passed')
}
catch (error) {
  console.error('Page errors:', errors)
  console.error('Disk state:', await page.evaluate(() => ({ url: location.href, segments: document.querySelectorAll('.segment').length, body: document.body.innerText.slice(-2500) })))
  throw error
}
finally {
  finish?.()
  await browser.close()
}
