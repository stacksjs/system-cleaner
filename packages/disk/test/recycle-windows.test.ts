import { describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import process from 'node:process'
import { recycle } from '../src/recycle-windows'

/**
 * Recoverable deletion on Windows, verified against the actual Recycle Bin.
 *
 * The assertion that matters is not "the file is gone" — a permanent delete
 * achieves that too, and it is the failure this code exists to avoid.
 * `FOF_ALLOWUNDO` is a request rather than a guarantee, and a volume with no
 * Recycle Bin honours it by deleting permanently while `FOF_NOCONFIRMATION`
 * suppresses the warning. So the test asks the Recycle Bin itself whether the
 * file is in there.
 *
 * The Windows cases run on the windows-latest leg. The two input guards run
 * everywhere, because they answer before anything is spawned.
 *
 * See stacksjs/system-cleaner#23.
 */

const IS_WINDOWS = process.platform === 'win32'

/**
 * What the Recycle Bin holds, read from the records that make a restore
 * possible rather than through the shell.
 *
 * An entry is restorable because the shell wrote a `$I` record beside the
 * `$R` data, holding the original path as UTF-16. Reading those directly beats
 * enumerating `Shell.Application`: the COM object wants a desktop session, and
 * on a runner it can answer "empty" for a bin that is not — which is exactly
 * the ambiguity that made the first version of this test useless.
 *
 * Returns the raw record text plus a listing of the bin, so a failure says
 * whether the bin was unreadable, genuinely empty, or holding something else.
 */
async function recycleBinRecords(): Promise<{ records: string, listing: string, error: string }> {
  const script = [
    '$ErrorActionPreference = \'Continue\'',
    '$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
    '$dir = Join-Path "$env:SystemDrive\\`$Recycle.Bin" $sid',
    'if (-not (Test-Path -LiteralPath $dir)) { Write-Output "NOBIN:$dir"; exit 0 }',
    'Write-Output "LISTING:"',
    'Get-ChildItem -LiteralPath $dir -Force | ForEach-Object { Write-Output $_.Name }',
    'Write-Output "RECORDS:"',
    'Get-ChildItem -LiteralPath $dir -Force -Filter \'$I*\' | ForEach-Object {',
    '  Write-Output ([System.Text.Encoding]::Unicode.GetString([System.IO.File]::ReadAllBytes($_.FullName)))',
    '}',
  ].join('\n')

  const proc = Bun.spawn(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', script], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  await proc.exited

  const marker = out.indexOf('RECORDS:')
  return {
    records: marker >= 0 ? out.slice(marker + 'RECORDS:'.length) : '',
    listing: marker >= 0 ? out.slice(0, marker) : out,
    error: err.trim(),
  }
}

describe('the input guards answer before anything is spawned', () => {
  it('treats an empty list as nothing to do', async () => {
    expect(await recycle([])).toEqual({ ok: true })
  })

  /**
   * Paths travel to PowerShell in a newline-separated file, so a line break
   * inside one would split it into two entries and the second half could name
   * something else entirely. Win32 rejects these in filenames, which makes
   * this a guard against a crafted string rather than a real file — the case
   * actually worth guarding.
   */
  it('refuses a path containing a line break', async () => {
    const result = await recycle(['C:\\Users\\glenn\\a\nC:\\Windows\\System32'])
    expect(result.ok).toBe(false)
    expect(result.error).toContain('line break')
  })
})

describe('recycling on windows', () => {
  it('removes the file from disk and puts it in the Recycle Bin', async () => {
    if (!IS_WINDOWS) return

    // Under the profile, not the temp directory: %TEMP% is on the runner's
    // working volume, and the point of this test is a fixed local drive with
    // a Recycle Bin on it.
    const dir = fs.mkdtempSync(path.join(os.homedir(), 'sc-recycle-test-'))
    const file = path.join(dir, `recycle-me-${Date.now()}.txt`)
    fs.writeFileSync(file, 'this should end up in the Recycle Bin')

    const result = await recycle([file], 60_000)
    expect(result.error ?? '').toBe('')
    expect(result.ok).toBe(true)

    // Gone from where it was.
    expect(fs.existsSync(file)).toBe(false)

    // And actually recoverable, which is the part a permanent delete would
    // also have passed the assertion above. The `$I` record holding the
    // original path is what makes a restore possible, so its presence is the
    // only evidence worth accepting.
    const bin = await recycleBinRecords()
    const found = bin.records.toLowerCase().includes(path.basename(file).toLowerCase())
    expect(
      found,
      `no restore record names ${path.basename(file)}, so the delete was permanent.\n`
      + `bin listing:\n${bin.listing}\nstderr: ${bin.error}`,
    ).toBe(true)

    // The item is deliberately left in the bin. `Clear-RecycleBin -Force`
    // would empty a developer's own Recycle Bin when the suite runs locally,
    // and a stray few bytes on a throwaway CI runner costs nothing.
    fs.rmSync(dir, { recursive: true, force: true })
  }, 90_000)

  it('reports a failure for a path that is not there', async () => {
    if (!IS_WINDOWS) return

    const missing = path.join(os.homedir(), `sc-no-such-file-${Date.now()}.txt`)
    const result = await recycle([missing], 60_000)
    // A delete that removed nothing must not report success: this is the
    // "fake stuff" complaint in a different guise.
    expect(result.ok).toBe(false)
  }, 90_000)
})
