import { describe, expect, it } from 'bun:test'

/**
 * Every `x-data` block in the app views has to survive being flattened onto a
 * single line.
 *
 * STX moves the attribute into `data-stx-xdata` and collapses its newlines
 * before the runtime evaluates it. A `//` comment inside the literal therefore
 * comments out the remainder of the *whole object*, the evaluation throws, and
 * `__stx_state` is left null — so every binding on the page renders empty with
 * nothing in the console to explain it. That is a silent, total failure of a
 * screen, and it is invisible in review because the source looks fine.
 *
 * This catches it at the only point where it is cheap to catch.
 */

const views = new Bun.Glob('resources/views/**/*.stx')

/** Pull the value of every `x-data="..."` attribute out of a template. */
function extractXData(source: string): string[] {
  const blocks: string[] = []
  const marker = 'x-data="'

  let cursor = source.indexOf(marker)
  while (cursor !== -1) {
    const start = cursor + marker.length
    const end = source.indexOf('">', start)
    if (end === -1)
      break
    blocks.push(source.slice(start, end))
    cursor = source.indexOf(marker, end)
  }

  return blocks
}

describe('x-data blocks', () => {
  it('parse as object literals once collapsed onto one line', async () => {
    const failures: string[] = []
    let checked = 0

    for await (const file of views.scan('.')) {
      const source = await Bun.file(file).text()

      for (const block of extractXData(source)) {
        // Only object literals; `x-data='someFactory()'` is a call, and the
        // function it names lives in its own file.
        if (!block.trimStart().startsWith('{'))
          continue

        checked++
        const flattened = block.split('\n').map(line => line.trim()).join(' ')

        try {
          // eslint-disable-next-line no-new-func
          new Function(`return (${flattened})`)()
        }
        catch (err) {
          failures.push(`${file}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    }

    expect(failures).toEqual([])
    expect(checked).toBeGreaterThan(0)
  })

  it('contain no double quote, which would end the HTML attribute early', async () => {
    const offenders: string[] = []

    for await (const file of views.scan('.')) {
      const source = await Bun.file(file).text()

      for (const block of extractXData(source)) {
        if (!block.trimStart().startsWith('{'))
          continue
        // The attribute is delimited by `"`. One inside — most easily reached
        // by generating markup with `class="..."` — closes it early, and the
        // rest of the object becomes stray HTML.
        if (block.includes('"'))
          offenders.push(file)
      }
    }

    expect([...new Set(offenders)]).toEqual([])
  })

  it('contain no comments, which flattening would turn into a parse error', async () => {
    const offenders: string[] = []

    for await (const file of views.scan('.')) {
      const source = await Bun.file(file).text()

      for (const block of extractXData(source)) {
        if (!block.trimStart().startsWith('{'))
          continue
        if (/(?:^|\s)\/\//.test(block) || block.includes('/*'))
          offenders.push(file)
      }
    }

    expect([...new Set(offenders)]).toEqual([])
  })
})
