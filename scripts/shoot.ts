#!/usr/bin/env bun
/* eslint-disable ts/no-top-level-await */
// Visual smoke test — captures screenshots of every page and reports any
// pageerror or console.error events. Use as a quick regression check before
// shipping changes to the chrome / panels.
//
// Requires `puppeteer` installed locally (npm/bun) — falls back to a clear
// error if it isn't.

import * as fs from 'node:fs'

const BASE = process.env.BASE_URL ?? 'http://localhost:3456'
const OUT = process.env.OUT_DIR ?? './.screenshots'
const COLOR_SCHEME = process.env.COLOR_SCHEME === 'dark' ? 'dark' : 'light'
const PAGE_FILTER = new Set((process.env.PAGE_FILTER ?? '').split(',').map(value => value.trim()).filter(Boolean))
const FULL_PAGE = process.env.FULL_PAGE === '1'
const VIEWPORT_WIDTH = Number(process.env.VIEWPORT_WIDTH ?? 1400)
const VIEWPORT_HEIGHT = Number(process.env.VIEWPORT_HEIGHT ?? 900)
const PAGES = [
  { path: '/', name: 'home' },
  { path: '/app', name: 'dashboard' },
  { path: '/app/disk', name: 'disk' },
  { path: '/app/cleanup', name: 'cleanup' },
  { path: '/app/system', name: 'system' },
  { path: '/app/processes', name: 'processes' },
  { path: '/app/startup', name: 'startup' },
  { path: '/app/extensions', name: 'extensions' },
  { path: '/app/updates', name: 'updates' },
].filter(page => PAGE_FILTER.size === 0 || PAGE_FILTER.has(page.name))

let puppeteer: any
try {
  puppeteer = (await import('puppeteer')).default
}
catch {
  console.error('[shoot] puppeteer not installed. Run: bun add -d puppeteer')
  process.exit(1)
}

fs.mkdirSync(OUT, { recursive: true })

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })

let totalErrors = 0

for (const { path, name } of PAGES) {
  // Isolate every route so long-lived timers or sockets from one app panel
  // cannot hold the following navigation open.
  const page = await browser.newPage()
  await page.setViewport({ width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT, deviceScaleFactor: 1 })
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: COLOR_SCHEME }])
  await page.setCacheEnabled(false)
  const errors: string[] = []
  const onError = (e: Error) => errors.push(`pageerror: ${e.message}`)
  const onConsole = (m: { type: () => string, text: () => string }) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text().slice(0, 240)}`)
  }
  page.on('pageerror', onError)
  page.on('console', onConsole)

  const url = BASE + path
  const t0 = Date.now()
  try {
    // Long-lived app requests (process streams, update scans) are expected and
    // must not turn visual QA into a network-idle timeout.
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 })
    await page.addStyleTag({ content: 'html{scroll-behavior:auto!important}*,*::before,*::after{animation:none!important;transition:none!important}' })
  }
  catch (e: any) {
    console.log(`[${path.padEnd(12)}] NAV ERROR: ${e.message}`)
    page.off('pageerror', onError)
    page.off('console', onConsole)
    await page.close()
    continue
  }
  await Bun.sleep(1500)

  if (FULL_PAGE) {
    await page.evaluate(async () => {
      const step = Math.max(480, Math.floor(window.innerHeight * 0.8))
      for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
        window.scrollTo(0, y)
        await new Promise(resolve => setTimeout(resolve, 90))
      }
      for (const image of document.images) {
        image.scrollIntoView({ block: 'center' })
        await new Promise(resolve => setTimeout(resolve, 180))
      }
      window.scrollTo(0, 0)
    })
    await page.evaluate(async () => {
      const decoded = Promise.all([...document.images].map((image) => {
        if (image.complete) return Promise.resolve()
        return new Promise<void>((resolve) => {
          image.addEventListener('load', () => resolve(), { once: true })
          image.addEventListener('error', () => resolve(), { once: true })
        })
      }))
      await Promise.race([decoded, new Promise(resolve => setTimeout(resolve, 2000))])
    })
    await Bun.sleep(350)
  }

  const file = `${OUT}/${name}.png`
  await page.screenshot({ path: file, fullPage: FULL_PAGE })

  const meta = await page.evaluate(() => ({
    scopes: document.querySelectorAll('[data-stx-scope]').length,
    cloaked: document.querySelectorAll('[x-cloak]').length,
    sample: document.body?.innerText?.slice(0, 80) ?? '',
  }))

  const elapsed = Date.now() - t0
  const status = errors.length === 0 ? 'OK' : 'ERR'
  console.log(`[${path.padEnd(12)}] ${status}  ${elapsed}ms  scopes=${meta.scopes} cloaked=${meta.cloaked}  → ${file}`)
  if (errors.length) {
    totalErrors += errors.length
    for (const e of errors) console.log(`  · ${e}`)
  }
  page.off('pageerror', onError)
  page.off('console', onConsole)
  await page.close()
}

await browser.close()
process.exit(totalErrors === 0 ? 0 : 1)
