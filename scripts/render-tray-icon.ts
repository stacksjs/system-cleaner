/* eslint-disable no-console, ts/no-top-level-await */
/** Rasterize the existing brand artwork for AppKit's alpha-only template tint. */
import { readFileSync } from 'node:fs'
import puppeteer from 'puppeteer'

const source = new URL('../public/images/systemcleaner-mark.svg', import.meta.url)
const output = new URL('../public/images/tray-template.png', import.meta.url)
const svg = readFileSync(source, 'utf8')
  .replace(/<style>[\s\S]*?<\/style>/, '')
  .replace(/fill="#[a-f\d]+"/gi, 'fill="black"')
  .replace('viewBox="0 0 64 64"', 'width="64" height="64" viewBox="7 5 52 52"')
const browser = await puppeteer.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 64, height: 64 })
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg}`)
  await page.screenshot({ path: output.pathname, omitBackground: true })
  console.log(`Rendered ${output.pathname} from the SystemCleaner mark`)
}
finally { await browser.close() }
