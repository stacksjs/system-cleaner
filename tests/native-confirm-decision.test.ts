import { describe, expect, it } from 'bun:test'

/**
 * A confirmed sheet has to delete, and an unheard answer must never do.
 *
 * `nativeConfirm` guards every destructive action in the app, and both ways of
 * getting it wrong have shipped. Reading an unknown answer shape as consent
 * empties a folder nobody asked about. Reading a lost reply as a refusal makes
 * a sheet the user already confirmed do nothing at all, silently — the dead
 * button that `Clean Selected` was for a release.
 *
 * The bridge reaps a request after `__craftBridgeRequestTimeoutMs`, so a
 * reader who takes five minutes over the sheet has their answer dropped on the
 * floor. Falling through to `showMessageBox` there is not a recovery: the
 * injected bridge routes a two-button `showMessageBox` to the same native
 * action, which answers `{ ok: true }`, and the normalizer wants
 * `response`/`buttonIndex`, finds neither and synthesizes the cancel index. So
 * that path cannot return true on the packaged host — it asks a second time
 * and discards the answer. A lost reply has to be re-asked by the route this
 * host actually answers.
 *
 * Driven against the built bundle rather than the source, because what ships
 * is `public/native-dialog.js` and the bundler is between the two.
 */

const BUNDLE = 'public/native-dialog.js'

const QUESTION = {
  title: 'Delete 3 items?',
  message: '1.7 GB is freed and cannot be recovered.',
  confirmLabel: 'Delete',
  destructive: true,
}

/**
 * Load the bundle against a fake Craft bridge and return `window.nativeConfirm`.
 *
 * `showConfirm` is driven by `answers`: one entry per call, either a value to
 * resolve with or an Error to reject with. `sheets` counts how many times the
 * user was actually asked something.
 */
async function load(answers: unknown[]): Promise<{
  confirm: (o: typeof QUESTION) => Promise<boolean>
  sheets: () => number
  remaining: () => number
}> {
  const source = await Bun.file(BUNDLE).text()
  let asked = 0
  const queue = answers.slice()

  const win: Record<string, any> = {
    craft: {
      dialog: {
        showConfirm: (_message: string) => {
          asked++
          const next = queue.shift()
          return next instanceof Error ? Promise.reject(next) : Promise.resolve(next)
        },
        // Present so the fall-through has something to reach, and counted so a
        // test can tell a second question from a silent decline.
        showMessageBox: (_options: unknown) => {
          asked++
          return Promise.resolve({ ok: true })
        },
      },
    },
  }
  win.window = win
  win.globalThis = win
  win.document = { addEventListener() {}, querySelectorAll: () => [], readyState: 'complete' }
  win.navigator = { userAgent: 'test' }

  const run = new Function('window', 'document', 'navigator', 'globalThis', `${source}\n;return window.nativeConfirm`)
  const confirm = run(win, win.document, win.navigator, win)

  return { confirm, sheets: () => asked, remaining: () => queue.length }
}

describe('nativeConfirm', () => {
  it('deletes when the bridge answers { ok: true }', async () => {
    const { confirm } = await load([{ ok: true }])
    expect(await confirm(QUESTION)).toBe(true)
  })

  it('deletes when a host honours the documented boolean', async () => {
    const { confirm } = await load([true])
    expect(await confirm(QUESTION)).toBe(true)
  })

  it('declines on { ok: false } without asking again', async () => {
    const { confirm, sheets } = await load([{ ok: false }])
    expect(await confirm(QUESTION)).toBe(false)
    expect(sheets(), 'one sheet, one answer, taken at face value').toBe(1)
  })

  /**
   * The regression this file exists for: a slow reader's confirmed delete.
   *
   * The reaper fires while the sheet is still up, so the first call rejects.
   * The answer was lost, not refused, so the question goes back by the same
   * route — and the second answer counts.
   */
  it('re-asks through showConfirm when the reaper eats the reply, and honours the answer', async () => {
    const { confirm, sheets, remaining } = await load([new Error('timed out'), { ok: true }])
    expect(await confirm(QUESTION)).toBe(true)
    expect(sheets(), 'asked exactly twice').toBe(2)
    expect(remaining(), 'the second answer was the one read').toBe(0)
  })

  it('declines, rather than asking a third time, when the bridge is wedged', async () => {
    const { confirm, sheets } = await load([new Error('timed out'), new Error('timed out')])
    expect(await confirm(QUESTION)).toBe(false)
    expect(sheets(), 'two attempts and no showMessageBox chaser').toBe(2)
  })

  /**
   * An unreadable answer is the one case the fall-through is for: the route
   * answered, and no retry changes the shape, so a different question is worth
   * asking. It must still fail closed.
   */
  it('falls through once on an answer shape it cannot read, and does not invent consent', async () => {
    const { confirm, sheets } = await load(['yes please'])
    expect(await confirm(QUESTION)).toBe(false)
    expect(sheets(), 'the unreadable answer, then one fall-through').toBe(2)
  })
})
