/* eslint-disable no-console, ts/no-top-level-await */
import * as fs from 'node:fs'
import process from 'node:process'
import assert from 'node:assert/strict'
import puppeteer from 'puppeteer'

// Run against the bundled agent: BASE_URL=http://127.0.0.1:<port> bun scripts/verify-appearance.ts
const base = process.env.BASE_URL || 'http://127.0.0.1:3457'
const output = '.shots/appearance'
fs.mkdirSync(output, { recursive: true })
const browser = await puppeteer.launch({ headless: true })
const issues: unknown[] = []
try {
  const main = await browser.newPage()
  const settings = await browser.newPage()
  const vpn = await browser.newPage()
  const pages = [main, settings, vpn]
  for (const page of pages) {
    page.on('pageerror', error => issues.push(String(error)))
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
  }
  await main.setViewport({ width: 1400, height: 900 })
  await settings.setViewport({ width: 715, height: 640 })
  await vpn.setViewport({ width: 360, height: 520 })
  console.log('Loading main window')
  await main.goto(`${base}/app`, { waitUntil: 'domcontentloaded' })
  await settings.goto(`${base}/app/settings`, { waitUntil: 'domcontentloaded' })
  await vpn.goto(`${base}/app/vpn-window`, { waitUntil: 'domcontentloaded' })
  await settings.bringToFront()
  await settings.waitForSelector('[data-pane-link][data-active]')
  await settings.click('[data-pane-link="appearance"]')
  await settings.waitForSelector('[data-pane="appearance"][data-active]')

  for (const mode of ['dark', 'light', 'system']) {
    console.log(`Checking ${mode} synchronization`)
    await settings.bringToFront()
    await settings.click(`[data-option="colorMode"][data-value="${mode}"]`)
    for (const page of pages) {
      await page.bringToFront()
      await page.waitForFunction(value => document.documentElement.dataset.colorMode === value, {}, mode)
      assert.equal(await page.$eval('html', root => root.classList.contains('dark')), mode === 'dark')
    }
    await settings.reload({ waitUntil: 'domcontentloaded' })
    assert.equal(await settings.$eval('[data-option="colorMode"][data-active]', el => el.getAttribute('data-value')), mode)
  }

  // System changes propagate; an explicit preference stays fixed.
  for (const page of pages) {
    await page.bringToFront()
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }])
    await page.waitForFunction(() => document.documentElement.classList.contains('dark'))
  }
  await settings.bringToFront()
  await settings.click('[data-option="colorMode"][data-value="light"]')
  for (const page of pages) {
    await page.bringToFront()
    await page.waitForFunction(() => !document.documentElement.classList.contains('dark'))
  }

  // Clearing browser storage restores Auto in every window, including its control.
  await settings.evaluate(() => localStorage.clear())
  for (const page of pages) {
    await page.bringToFront()
    await page.waitForFunction(() => document.documentElement.dataset.colorMode === 'system')
  }
  await settings.bringToFront()
  await settings.reload({ waitUntil: 'domcontentloaded' })
  await settings.waitForSelector('[data-pane-link][data-active]')
  await settings.click('[data-pane-link="appearance"]')
  await settings.waitForSelector('[data-pane="appearance"][data-active]')

  const routes = fs.readdirSync('app/Desktop/Resources/web/app').filter(file => file.endsWith('.html'))
    .map(file => `/app/${file.replace(/\.html$/, '')}`)
    .filter(route => !route.endsWith('/index'))
  routes.unshift('/app')
  for (const mode of ['light', 'dark']) {
    await settings.bringToFront()
    await settings.click(`[data-option="colorMode"][data-value="${mode}"]`)
    for (const route of routes) {
      console.log(`Checking ${mode} ${route}`)
      await main.bringToFront()
      await main.setViewport(route.endsWith('/settings') ? { width: 715, height: 640 } : route.endsWith('/vpn-window') ? { width: 360, height: 520 } : { width: 1400, height: 900 })
      await main.goto(`${base}${route}`, { waitUntil: 'domcontentloaded' })
      await main.waitForFunction(value => document.documentElement.dataset.colorMode === value, {}, mode)
      const panes = route.endsWith('/settings')
        ? await main.$$eval('.set-row[data-pane-link]', elements => elements.map(el => el.getAttribute('data-pane-link')!))
        : ['']
      for (const pane of [...new Set(panes)]) {
        if (pane)
          await main.click(`.set-row[data-pane-link="${pane}"]`)
        const failures = await main.evaluate(() => {
          const canvas = document.createElement('canvas')
          canvas.width = canvas.height = 1
          const context = canvas.getContext('2d', { willReadFrequently: true })!
          const rgba = (color: string) => {
            context.clearRect(0, 0, 1, 1)
            context.fillStyle = color
            context.fillRect(0, 0, 1, 1)
            return [...context.getImageData(0, 0, 1, 1).data].map((value, index) => index === 3 ? value / 255 : value)
          }
          const blend = (front: number[], back: number[]) => front.slice(0, 3).map((value, i) => value * front[3] + back[i] * (1 - front[3])).concat(1)
          const luminance = (rgb: number[]) => rgb.slice(0, 3).map((value) => {
            const channel = value / 255
            return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4
          }).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0)
          const failed: { text: string, ratio: number, selector: string }[] = []
          for (const el of document.querySelectorAll<HTMLElement>('body *')) {
            if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) || el.closest(':disabled, [aria-hidden="true"], script, style'))
              continue
            const text = [...el.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('').trim()
            if (!text)
              continue
            const ancestors: Element[] = []
            for (let parent: Element | null = el; parent; parent = parent.parentElement)
              ancestors.unshift(parent)
            let background = document.documentElement.classList.contains('dark') ? [26, 26, 28, 1] : [245, 245, 247, 1]
            let opacity = 1
            for (const ancestor of ancestors) {
              const style = getComputedStyle(ancestor)
              background = blend(rgba(style.backgroundColor), background)
              opacity *= Number(style.opacity)
            }
            const style = getComputedStyle(el)
            const foreground = rgba(style.color)
            foreground[3] *= opacity
            const l1 = luminance(blend(foreground, background))
            const l2 = luminance(background)
            const ratio = (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05)
            const large = Number.parseFloat(style.fontSize) >= (Number.parseInt(style.fontWeight) >= 700 ? 18.66 : 24)
            if (ratio < (large ? 3 : 4.5) - .02)
              failed.push({ text: text.slice(0, 70), ratio: Math.round(ratio * 100) / 100, selector: el.className })
          }
          return failed
        })
        if (failures.length)
          issues.push({ mode, route, pane, failures })
      }
      if (route.endsWith('/settings'))
        await main.click('[data-pane-link="appearance"]')
      if (route === '/app' || /\/(?:settings|cleanup|vpn-window)$/.test(route))
        await main.screenshot({ path: `${output}/${mode}-${route.split('/').pop()}.png` })
    }
  }
  fs.writeFileSync(`${output}/report.json`, `${JSON.stringify(issues, null, 2)}\n`)
  assert.equal(issues.length, 0, `Appearance checks failed; see ${output}/report.json`)
  console.log(`Theme persistence, three-window synchronization, system changes, and contrast passed for ${routes.length} routes in both modes.`)
}
finally {
  await browser.close()
}
