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
const PAGES = ['/', '/disk', '/cleanup', '/system', '/processes', '/startup', '/extensions', '/updates']

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
const page = await browser.newPage()
await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 1 })
await page.setCacheEnabled(false)

let totalErrors = 0

for (const path of PAGES) {
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
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 15_000 })
  }
  catch (e: any) {
    console.log(`[${path.padEnd(12)}] NAV ERROR: ${e.message}`)
    page.off('pageerror', onError)
    page.off('console', onConsole)
    continue
  }
  await Bun.sleep(500)

  const file = `${OUT}${path === '/' ? '/home' : path}.png`
  await page.screenshot({ path: file, fullPage: false })

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
}

await browser.close()
process.exit(totalErrors === 0 ? 0 : 1)
