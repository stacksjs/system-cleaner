import { afterEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { readRememberedPort, rememberPort } from '../app/Support/Runtime/agent-port'

/**
 * The port file is the app's memory of its own origin.
 *
 * Everything the page stores — the colour mode, every switch in the Settings
 * window — is scoped to `http://127.0.0.1:<port>`, so a wrong answer here is
 * not a failed launch. It is an app that starts fine and has quietly forgotten
 * what the user told it, with nothing in any log to say so. That is the whole
 * reason these two functions are worth testing at all.
 */

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-port-'))
const file = path.join(scratch, 'agent-port')

afterEach(() => {
  try {
    fs.unlinkSync(file)
  }
  catch {
    // Several of these never write one.
  }
})

describe('the remembered agent port', () => {
  it('reads back what was written', () => {
    rememberPort(file, 51234)
    expect(readRememberedPort(file)).toBe(51234)
  })

  it('answers 0 when there is no file', () => {
    // A first launch. `Bun.serve` reads 0 as "pick one for me", so this is the
    // right answer rather than an error to report.
    expect(readRememberedPort(path.join(scratch, 'nothing-here'))).toBe(0)
  })

  it('answers 0 for a file holding something that is not a port', () => {
    for (const junk of ['', '   ', 'eighty-eighty', '8080abc', '0x1f', '-1', '12.5']) {
      fs.writeFileSync(file, junk)
      expect(readRememberedPort(file)).toBe(0)
    }
  })

  it('refuses the well-known range and anything past the port space', () => {
    // The OS never hands these out for an ephemeral bind, so a file claiming
    // one is a file that has been corrupted or hand-edited.
    for (const port of ['0', '80', '443', '1024', '65536', '99999']) {
      fs.writeFileSync(file, port)
      expect(readRememberedPort(file)).toBe(0)
    }
  })

  it('keeps the ends of the usable range', () => {
    for (const port of [1025, 65535]) {
      rememberPort(file, port)
      expect(readRememberedPort(file)).toBe(port)
    }
  })

  it('ignores surrounding whitespace and a trailing newline', () => {
    fs.writeFileSync(file, '  51234 \n')
    expect(readRememberedPort(file)).toBe(51234)
  })

  it('does not record a port it would refuse to read back', () => {
    // Writing one would leave the file holding a number that every later read
    // answers 0 for — worse than not writing, because it looks recorded.
    for (const port of [0, 80, 65536, 1.5, Number.NaN]) {
      rememberPort(file, port)
      expect(fs.existsSync(file)).toBe(false)
    }
  })

  it('replaces the previous port rather than appending to it', () => {
    rememberPort(file, 51234)
    rememberPort(file, 51235)
    expect(readRememberedPort(file)).toBe(51235)
  })
})
