#!/usr/bin/env bun
/**
 * E2E visual + DOM checks using Bun.WebView (WebKit on macOS).
 * Requires dev server at BASE_URL (default http://localhost:3456).
 *
 * Usage: bun ./scripts/e2e-webview.ts
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

const BASE = process.env.BASE_URL ?? 'http://localhost:3456'
const OUT = process.env.OUT_DIR ?? './.screenshots/webview'
const WAIT_MS = Number(process.env.E2E_WAIT_MS ?? 6000)

type PageSpec = {
  path: string
  name: string
  assert: (r: DomReport) => string | null
}

type DomReport = {
  includeErrors: boolean
  title: string
  hasMainTitle: boolean
  tableRows: number
  emptyStates: number
  cloaked: number
  bodySnippet: string
  extra: Record<string, unknown>
}

const PAGES: PageSpec[] = [
  {
    path: '/',
    name: 'home',
    assert(r) {
      if (!r.bodySnippet.includes('SYSTEM HEALTH')) return 'missing SYSTEM HEALTH'
      if (!r.bodySnippet.includes('Top Processes')) return 'missing Top Processes heading'
      if (r.tableRows < 1) return `expected process rows, got ${r.tableRows}`
      return null
    },
  },
  {
    path: '/startup',
    name: 'startup',
    assert(r) {
      if (!r.bodySnippet.match(/All\s*\(\s*\d+/)) return 'startup tab counts missing'
      if (r.tableRows < 1) return `expected startup rows, got ${r.tableRows}`
      return null
    },
  },
  {
    path: '/updates',
    name: 'updates',
    assert(r) {
      if (!r.bodySnippet.includes('Updates')) return 'missing Updates heading'
      if (r.bodySnippet.includes('Everything is up to date') && r.bodySnippet.includes('outdated')) {
        return 'conflicting empty state while outdated items exist'
      }
      if (r.bodySnippet.includes('[0m')) return 'ANSI escape codes visible in UI'
      return null
    },
  },
  {
    path: '/disk',
    name: 'disk',
    assert(r) {
      if (!r.bodySnippet.includes('Disk')) return 'missing Disk heading'
      return null
    },
  },
  {
    path: '/processes',
    name: 'processes',
    assert(r) {
      if (!r.bodySnippet.includes('Processes')) return 'missing Processes heading'
      return null
    },
  },
  {
    path: '/system',
    name: 'system',
    assert(r) {
      if (!r.bodySnippet.includes('System')) return 'missing System heading'
      return null
    },
  },
  {
    path: '/cleanup',
    name: 'cleanup',
    assert(r) {
      if (!r.bodySnippet.includes('Quick Clean') && !r.bodySnippet.includes('Cleanup')) {
        return 'missing cleanup heading'
      }
      return null
    },
  },
  {
    path: '/extensions',
    name: 'extensions',
    assert(r) {
      if (!r.bodySnippet.includes('Extensions')) return 'missing Extensions heading'
      return null
    },
  },
]

async function probe(view: InstanceType<typeof Bun.WebView>, extra?: Record<string, unknown>): Promise<DomReport> {
  return await view.evaluate(`(() => {
    const text = document.body?.innerText ?? '';
    return {
      includeErrors: text.includes('include error'),
      title: document.title,
      hasMainTitle: !!document.querySelector('.main-title'),
      tableRows: document.querySelectorAll('.tbl-wrap tbody tr').length,
      emptyStates: document.querySelectorAll('.empty-state').length,
      cloaked: document.querySelectorAll('[x-cloak]').length,
      bodySnippet: text.slice(0, 1200),
      extra: ${JSON.stringify(extra ?? {})},
    };
  })()`) as DomReport
}

async function waitForHydration(view: InstanceType<typeof Bun.WebView>, spec: PageSpec): Promise<DomReport> {
  const deadline = Date.now() + WAIT_MS
  let last: DomReport | null = null
  while (Date.now() < deadline) {
    last = await probe(view)
    if (last.includeErrors) break
    const err = spec.assert(last)
    if (!err) return last
    await Bun.sleep(400)
  }
  return last ?? await probe(view)
}

if (typeof Bun.WebView !== 'function') {
  console.error('[e2e-webview] Bun.WebView not available in this Bun build')
  process.exit(1)
}

fs.mkdirSync(OUT, { recursive: true })

const view = new Bun.WebView({
  width: 1400,
  height: 900,
})

let failures = 0

for (const spec of PAGES) {
  const url = BASE + spec.path
  const t0 = Date.now()
  try {
    await view.navigate(url)
    const report = await waitForHydration(view, spec)
    const file = path.join(OUT, `${spec.name}.png`)
    const png = await view.screenshot({ format: 'png', encoding: 'buffer' })
    await Bun.write(file, png as Buffer)

    const assertErr = report.includeErrors
      ? 'include error in page'
      : spec.assert(report)

    const status = assertErr ? 'FAIL' : 'OK'
    if (assertErr) failures++
    console.log(
      `[${spec.path.padEnd(12)}] ${status}  ${Date.now() - t0}ms  rows=${report.tableRows}  → ${file}`,
    )
    if (assertErr) console.log(`  · ${assertErr}`)
  }
  catch (e) {
    failures++
    console.log(`[${spec.path.padEnd(12)}] ERROR  ${e instanceof Error ? e.message : String(e)}`)
  }
}

view.close?.()
process.exit(failures === 0 ? 0 : 1)
