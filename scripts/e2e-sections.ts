#!/usr/bin/env bun
/* eslint-disable no-console, ts/no-top-level-await */
/**
 * End-to-end walk through the app's navigation, driven by the same section
 * table the sidebar reads, so a section or tool added there is tested here
 * without touching this file.
 *
 * One browser page, real clicks, SPA navigation throughout:
 *   - the sidebar lists exactly the six sections and lights the right one
 *   - every section page renders its tone, tools, panels and round button
 *   - every tool opens from its section page, keeps its section lit, shows
 *     the right breadcrumb, and carries the same title as its sidebar label
 *   - the breadcrumb, Back and Forward move between them
 *   - the sidebar hides and shows, and the sheet goes full-bleed while hidden
 *   - the account menu opens, lists what it should, and closes on Escape
 *   - the overview cards and round button go where they say
 *   - live figures and panels fill in
 *
 * It only navigates and opens menus. It never presses a button that deletes,
 * cleans or changes a setting.
 *
 * Usage:
 *   BASE_URL=http://127.0.0.1:50297 bun scripts/e2e-sections.ts
 *
 * BASE_URL is any server rendering the app as the local agent: the installed
 * app's own agent, or `bun app/Desktop/server.ts` over a fresh `dist/`.
 * Needs a Chromium-family browser (set BROWSE_BROWSER if none is found).
 */
import process from 'node:process'
import { SECTIONS } from '../resources/lib/sections'

const BASE = (process.env.BASE_URL || 'http://127.0.0.1:50297').replace(/\/$/, '')
// The tracked copy: `.claude/skills` is a local, untracked link to it, so CI has no such path.
const DRIVER = 'storage/framework/defaults/ai/skills/stacks-browse/scripts/browse.ts'
// A beat for the view transition before the next click; checks poll anyway.
const SETTLE = 450

type Step = Record<string, unknown>
const steps: Step[] = []

// Runs inside the page: its source is sent with every check, so it may close
// over nothing.
function poll(test: () => boolean, description: string, failure: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const tick = (): void => {
      let ok = false
      try {
        ok = test()
      }
      catch {
        ok = false
      }
      if (ok)
        resolve(description)
      else if (Date.now() - start > 10_000)
        reject(new Error(failure))
      else
        setTimeout(tick, 100)
    }
    tick()
  })
}

/**
 * Assert a condition, polling until it holds or ten seconds pass.
 *
 * Fixed sleeps made this flaky against a real machine, where a page that
 * walks the disk can hold up the next navigation for seconds. Polling tests
 * what happens rather than how fast.
 */
function check(description: string, condition: string): void {
  steps.push({
    action: 'evaluate',
    expression: `(${poll.toString()})(() => !!(${condition}), ${JSON.stringify(description)}, ${JSON.stringify(`FAILED: ${description}`)})`,
  })
}
const click = (selector: string): void => { steps.push({ action: 'click', selector }) }
const wait = (ms: number = SETTLE): void => { steps.push({ action: 'wait', ms }) }

const path = (href: string): string => `location.pathname.replace(/\\/$/, '') === ${JSON.stringify(href)}`
const lit = (id: string): string => `document.querySelector('[data-rail-item][data-active]')?.getAttribute('data-rail-item') === ${JSON.stringify(id)}`
const crumb = (...parts: string[]): string => `(() => { const t = (document.querySelector('[data-toolbar-title]')?.textContent || '').replace(/\\s+/g, ' '); return ${JSON.stringify(parts)}.every(part => t.includes(part)) })()`
const text = (selector: string, value: string): string => `(document.querySelector(${JSON.stringify(selector)})?.textContent || '').trim() === ${JSON.stringify(value)}`

const places = SECTIONS.filter(section => section.id !== 'overview')

// ── Sidebar and overview ────────────────────────────────────────────
wait(1500)
check('the sidebar lists exactly the six sections', `document.querySelectorAll('[data-rail-item]').length === ${SECTIONS.length}`)
check('Overview is lit on the overview', lit('overview'))
check('the overview has one card per section', `document.querySelectorAll('.hub-module').length === ${places.length}`)
check('no tool row in the sidebar', `!document.querySelector('.rail a[href="/app/cleanup"]')`)

// ── Every section page, and every tool inside it ────────────────────
for (const section of places) {
  click(`[data-rail-item="${section.id}"]`)
  wait()
  check(`${section.label}: sidebar opens its page`, path(section.href))
  check(`${section.label}: its row is lit`, lit(section.id))
  check(`${section.label}: toolbar names it`, crumb(section.label))
  check(`${section.label}: page wears its colour`, `!!document.querySelector('.hub[data-tone="${section.id}"]')`)
  check(`${section.label}: heading is the section name`, text('.hub-name', section.label))
  check(`${section.label}: lists all ${section.tools.length} tools`, `document.querySelectorAll('.hub-feature').length === ${section.tools.length}`)
  check(`${section.label}: shows its ${(section.panels || []).length} panels`, `document.querySelectorAll('[data-panel]').length === ${(section.panels || []).length}`)
  if (section.primary)
    check(`${section.label}: round button goes to ${section.primary.href}`, `document.querySelector('.hub-run-button')?.getAttribute('href') === ${JSON.stringify(section.primary.href)}`)

  for (const [index, tool] of section.tools.entries()) {
    if (index > 0) {
      click(`[data-rail-item="${section.id}"]`)
      wait()
    }
    click(`.hub-feature[href="${tool.href}"]`)
    wait()
    check(`${tool.label}: opens from ${section.label}`, path(tool.href))
    check(`${tool.label}: keeps ${section.label} lit`, lit(section.id))
    check(`${tool.label}: breadcrumb reads ${section.label} > ${tool.label}`, crumb(section.label, tool.label))
    check(`${tool.label}: sits on the light sheet, not a section page`, `!document.querySelector('.hub')`)
    // The page's own title must match the label that led to it. Disk Usage
    // has no title row, its panel names the disk instead.
    check(`${tool.label}: page title matches its label`, `!document.querySelector('.main-title') || ${text('.main-title', tool.label)}`)
  }

  // The breadcrumb leads back up; history walks both ways.
  const first = section.tools[0]
  click(`[data-rail-item="${section.id}"]`)
  wait()
  click(`.hub-feature[href="${first.href}"]`)
  wait()
  click('.toolbar-crumb')
  wait()
  check(`${section.label}: breadcrumb returns to the section`, path(section.href))
  click('[data-toolbar-back]')
  wait()
  check(`${section.label}: Back returns to ${first.label}`, path(first.href))
  click('[data-toolbar-forward]')
  wait()
  check(`${section.label}: Forward returns to the section`, path(section.href))
}

// ── Sidebar collapse, on a section page and on a tool page ──────────
for (const href of ['/app/storage', '/app/large-files']) {
  steps.push({ action: 'evaluate', expression: `window.stxRouter.navigate(${JSON.stringify(href)})` })
  wait()
  click('[data-toolbar-sidebar]')
  wait(500)
  check(`${href}: sidebar hides`, `document.documentElement.hasAttribute('data-sidebar-collapsed') && document.querySelector('#app-sidebar').getBoundingClientRect().width < 1`)
  check(`${href}: content fills the window while hidden`, `getComputedStyle(document.querySelector('.app-column')).marginLeft === '0px' && getComputedStyle(document.querySelector('.app-column')).marginTop === '0px'`)
  check(`${href}: toggle now offers to show it`, `document.querySelector('[data-toolbar-sidebar]').getAttribute('aria-expanded') === 'false'`)
  click('[data-toolbar-sidebar]')
  wait(500)
  check(`${href}: sidebar comes back`, `!document.documentElement.hasAttribute('data-sidebar-collapsed') && document.querySelector('#app-sidebar').getBoundingClientRect().width > 150`)
}

// ── Account menu ────────────────────────────────────────────────────
click('[data-profile-chip]')
wait(300)
check('account menu opens', `!document.querySelector('[data-profile-menu]').hidden`)
check('account menu offers Scheduled Clean and Settings', `(() => { const t = document.querySelector('[data-profile-menu]').textContent; return t.includes('Scheduled Clean') && t.includes('Settings') })()`)
steps.push({ action: 'press', key: 'Escape' })
wait(300)
check('Escape closes the account menu', `document.querySelector('[data-profile-menu]').hidden`)

// ── Overview cards and round button ─────────────────────────────────
click('[data-rail-item="overview"]')
wait()
click('.hub-module[data-tone="storage"]')
wait()
check('the Storage card opens Storage', path('/app/storage'))
click('[data-rail-item="overview"]')
wait()
click('.hub-run-button')
wait()
check('the overview Clean button opens Quick Clean', path('/app/cleanup'))
check('Quick Clean keeps Cleanup lit', lit('cleanup'))

// ── Sidebar disk meter ──────────────────────────────────────────────
click('.side-disk')
wait()
check('the disk meter opens Disk Usage', path('/app/disk'))
check('Disk Usage keeps Storage lit', lit('storage'))

// ── Live data ───────────────────────────────────────────────────────
click('[data-rail-item="overview"]')
wait(12000)
check('health score arrives', `!!document.querySelector('[data-metric="health"][data-metric-ready]')`)
check('free space arrives on the Storage card', `!!document.querySelector('.hub-module[data-tone="storage"] [data-metric-ready]')`)
check('the sidebar disk meter fills', `!!document.querySelector('.side-disk-free[data-metric-ready]') && parseFloat(getComputedStyle(document.querySelector('.side-disk-bar > span')).width) > 0`)
click('[data-rail-item="performance"]')
wait(4000)
check('every Performance panel has drawn', `[...document.querySelectorAll('[data-panel]')].every(panel => { const body = panel.querySelector('[data-panel-body]'); return !body.hasAttribute('aria-busy') && body.children.length > 0 })`)
click('[data-rail-item="storage"]')
wait(1500)
check('Quick wins draws its rows before the junk total lands', `document.querySelectorAll('[data-panel="quick-wins"] .hub-row').length === 3`)

// ── Run ─────────────────────────────────────────────────────────────
console.log(`[e2e] ${steps.filter(step => step.action === 'evaluate').length} checks against ${BASE}`)
const run = Bun.spawnSync(['bun', DRIVER, 'scenario', `${BASE}/app`, '--viewport', '1400x900', ...steps.flatMap(step => ['--step', JSON.stringify(step)])], {
  stdout: 'pipe',
  stderr: 'pipe',
  env: process.env,
})
const output = run.stdout.toString()
const start = output.indexOf('{')
// eslint-disable-next-line ts/no-explicit-any
let report: any = null
try { report = JSON.parse(output.slice(start)) }
catch { /* reported below */ }

if (!report) {
  console.error(output, run.stderr.toString())
  process.exit(1)
}

// A missing app icon is a 404 the page answers with its own placeholder, so it
// is expected noise rather than a failure.
const iconNoise = (url: string): boolean => url.includes('/api/app-icon')
const failedRequests = (report.failedRequests || []).filter((request: { url: string }) => !iconNoise(request.url))
const consoleErrors = (report.consoleErrors || []).filter((message: string) => !/Failed to load resource: the server responded with a status of 404/.test(message) || failedRequests.length > 0)
const failedStep = (report.steps || []).find((step: { ok?: boolean }) => step.ok === false) || report.failedStep

const passed = (report.steps || []).filter((step: { action: string, ok?: boolean }) => step.action === 'evaluate' && step.ok).length
console.log(`[e2e] ${passed} checks passed`)
if (failedStep || report.error) {
  console.error('[e2e] failed:', JSON.stringify(failedStep || report.error, null, 2))
  process.exit(1)
}
if (failedRequests.length || consoleErrors.length) {
  console.error('[e2e] browser errors:', JSON.stringify({ failedRequests, consoleErrors }, null, 2))
  process.exit(1)
}
console.log('[e2e] every navigation path behaved')
