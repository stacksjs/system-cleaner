/* eslint-disable no-console, ts/no-top-level-await */
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import process from 'node:process'
import puppeteer from 'puppeteer'
import type { ScanSession } from '../app/Workers/scan-jobs'

const base = process.env.BASE_URL || 'http://127.0.0.1:50297'
const browser = await puppeteer.launch({ headless: true })
const page = await browser.newPage()
await page.setViewport({ width: 1400, height: 900 })
const errors: string[] = []
page.on('pageerror', error => errors.push(String(error)))
mkdirSync('.shots/disk-motion', { recursive: true })
const root = '/Users/test'
const key = (path: string) => JSON.stringify([`${root}/${path}`, false])
const node = (name: string, sizeBytes: number, children: unknown[] = []) => ({ name, path: `${root}/${name}`, sizeBytes, isDirectory: true, children })
function tree(movies: number, documents: number, extra = false) {
  const children = [node('Movies', movies, [node('Movies/Clips', movies * .8, [node('Movies/Clips/Archive', movies * .8, [node('Movies/Clips/Archive/Deep', movies * .8, [node('Movies/Clips/Archive/Deep/Deeper', movies * .8)])])]), node('Movies/Other', movies * .2)]), node('Documents', documents)]
  if (extra) children.push(node('Music', 200))
  children.sort((a, b) => b.sizeBytes - a.sizeBytes)
  return { name: 'test', path: root, sizeBytes: movies + documents + (extra ? 200 : 0), isDirectory: true, children }
}
let model = tree(600, 300)
const session: ScanSession = { id: 'motion-test', kind: 'tree', status: 'running', parameters: {}, createdAt: Date.now(), startedAt: Date.now() - 13000,
  progress: { scanned: 22000, path: '/Users/test/Code/Libraries/a-long-folder-being-measured', measuredBytes: 900 } }
await page.setRequestInterception(true)
page.on('request', request => {
  if (new URL(request.url()).pathname === '/api/scan-state') {
    session.progress.snapshot = { success: true, tree: model, totalBytes: model.sizeBytes, folderCount: 5, fileCount: 1 }
    return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, scans: [session] }) })
  }
  return request.continue()
})
async function refresh(): Promise<void> {
  await page.evaluate(() => (window as unknown as { scanSessions: { refresh: () => Promise<void> } }).scanSessions.refresh())
}
async function settled(): Promise<void> {
  await page.waitForFunction(() => !document.querySelector('#segments-group')?.hasAttribute('data-transitioning'))
}
async function moving(): Promise<void> {
  await page.waitForSelector('#segments-group[data-transitioning]')
}
async function segment(path: string) {
  return page.evaluate((key) => {
    const path = [...document.querySelectorAll<SVGPathElement>('.segment:not(.is-exiting)')].find(el => el.dataset.key === key)!
    return { d: path.getAttribute('d'), fill: path.getAttribute('fill'), title: path.textContent, idx: path.dataset.idx }
  }, key(path))
}
try {
  await page.goto(`${base}/app/disk`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#segments-group .segment', { visible: true })
  await settled()
  const original = await segment('Movies')
  await page.evaluate((key) => {
    const el = [...document.querySelectorAll('.segment')].find(el => el.getAttribute('data-key') === key)!
    ;(el as Element & { retainedIdentity?: boolean }).retainedIdentity = true
  }, key('Movies'))
  model = tree(900, 1200, true)
  await refresh()
  await moving()
  await page.waitForFunction(old => [...document.querySelectorAll('.segment')].some(el => el.textContent?.startsWith('Movies —') && el.getAttribute('d') !== old), {}, original.d)
  const middle = await segment('Movies')
  assert.notEqual(middle.d, original.d, 'A new snapshot starts moving the existing arc')
  // Interrupt before the previous target has settled.
  model = tree(1500, 200)
  await refresh()
  await moving()
  await settled()
  await page.waitForFunction(() => document.querySelector('.center-text-size')?.textContent === '1.7 KB')
  await settled()
  const updated = await segment('Movies')
  assert.equal(updated.fill, original.fill, 'A folder keeps its branch color through reordering')
  assert.notEqual(updated.d, original.d)
  assert.match(updated.title || '', /Movies/)
  assert.equal(updated.idx, '0', 'Retained elements point at the current model after reordering')
  assert(await page.evaluate(key => ([...document.querySelectorAll('.segment')].find(el => el.getAttribute('data-key') === key) as Element & { retainedIdentity?: boolean }).retainedIdentity, key('Movies')))
  assert.equal(await page.$$('.segment.is-exiting').then(elements => elements.length), 0)
  const beforeDrill = await segment('Movies/Clips')
  await page.evaluate(key => ([...document.querySelectorAll('.segment')].find(el => el.getAttribute('data-key') === key) as SVGElement).dispatchEvent(new MouseEvent('click', { bubbles: true })), key('Movies'))
  await moving()
  await settled()
  assert.notEqual((await segment('Movies/Clips')).d, beforeDrill.d, 'Drilling animates descendants into their new rings')
  await page.click('.center-bg')
  await moving()
  await settled()
  assert.equal((await segment('Movies/Clips')).d, beforeDrill.d, 'Zooming back restores the parent geometry')
  assert.equal(await page.$$eval('.segment', elements => elements.filter(el => el.textContent?.includes('Deeper')).length), 0, 'Nodes beyond the current ring limit do not survive zooming back')

  model = tree(1000, 3000, true)
  await refresh()
  await moving()
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  await settled()
  await page.evaluate(() => {
    const group = document.querySelector('#segments-group')!
    ;(group as Element & { observedMotion?: boolean }).observedMotion = false
    new MutationObserver(() => {
      if (group.hasAttribute('data-transitioning')) (group as Element & { observedMotion?: boolean }).observedMotion = true
    }).observe(group, { attributes: true, attributeFilter: ['data-transitioning'] })
  })
  model = tree(2000, 500)
  await refresh()
  await page.waitForFunction(() => document.querySelector('.center-text-size')?.textContent === '2.5 KB')
  assert.equal(await page.$eval('#segments-group', group => (group as Element & { observedMotion?: boolean }).observedMotion), false)

  for (const mode of ['dark', 'light']) {
    await page.evaluate(mode => document.documentElement.classList.toggle('dark', mode === 'dark'), mode)
    await page.screenshot({ path: `.shots/disk-motion/${mode}.png` })
    const geometry = await page.evaluate(() => {
      const banner = document.querySelector('.disk-live-status')!.getBoundingClientRect()
      const heading = document.querySelector('.disk-live-heading')!.getBoundingClientRect()
      const path = document.querySelector('.disk-live-path')!.getBoundingClientRect()
      return { height: banner.height, headingLeft: heading.left, pathLeft: path.left, align: getComputedStyle(document.querySelector('.disk-live-path')!).textAlign }
    })
    assert(geometry.height < 60, 'Status remains a compact two-line strip')
    assert(Math.abs(geometry.pathLeft - geometry.headingLeft) < 1)
    assert.equal(geometry.align, 'left')
  }
  const retainedGeometry = (await segment('Movies')).d
  await page.evaluate(() => document.querySelector<HTMLAnchorElement>('[data-rail-item="dashboard"]')!.click())
  await page.waitForFunction(() => location.pathname === '/app')
  await page.evaluate(() => document.querySelector<HTMLAnchorElement>('[data-rail-item="disk"]')!.click())
  await page.waitForSelector('#segments-group .segment', { visible: true })
  await settled()
  assert.equal((await segment('Movies')).d, retainedGeometry)
  assert.deepEqual(errors, [])
  console.log('Live arc interpolation, retained identity/colors, interruption, drill/back, reduced motion, status layout, and remount passed')
}
finally { await browser.close() }
