import { describe, expect, it } from 'bun:test'
import { parseCpuTime, parseCsvLine, parseMemory, parseTasklist, toProcessInfo } from '../packages/monitor/src/processes-windows'

/**
 * The Windows process list.
 *
 * `ps` does not exist there, so `getTopProcesses` returned an empty array and
 * every screen built on it showed nothing — which is why `processes` was false
 * in the capability map, and why the dashboard's CPU figure was 0% until that
 * was measured from the kernel instead.
 *
 * Driven entirely from captured `tasklist /FO CSV /NH /V` output, because the
 * only machine that can run the command is not the one this was written on.
 * Everything that interprets it is a pure function for that reason.
 */

// Real `tasklist /V` shape. Note the window title with commas in it, the
// service account, the unpadded hour count, and the thousands separators.
const FIRST = [
  '"System Idle Process","0","Services","0","8 K","Unknown","NT AUTHORITY\\SYSTEM","103:21:44","N/A"',
  '"svchost.exe","1240","Services","0","24,116 K","Unknown","NT AUTHORITY\\LOCAL SERVICE","0:00:31","N/A"',
  '"chrome.exe","8812","Console","1","512,044 K","Running","DESKTOP-7Q2\\glenn","0:02:10","Inbox (3,412) - Gmail"',
  '"explorer.exe","4420","Console","1","98,220 K","Running","DESKTOP-7Q2\\glenn","0:00:45","N/A"',
].join('\r\n')

const SECOND = [
  '"System Idle Process","0","Services","0","8 K","Unknown","NT AUTHORITY\\SYSTEM","103:21:48","N/A"',
  '"svchost.exe","1240","Services","0","24,116 K","Unknown","NT AUTHORITY\\LOCAL SERVICE","0:00:31","N/A"',
  '"chrome.exe","8812","Console","1","530,120 K","Running","DESKTOP-7Q2\\glenn","0:02:12","Inbox (3,412) - Gmail"',
  '"explorer.exe","4420","Console","1","98,220 K","Running","DESKTOP-7Q2\\glenn","0:00:45","N/A"',
  // Started during the window: no earlier total to subtract from.
  '"notepad.exe","9001","Console","1","12,000 K","Running","DESKTOP-7Q2\\glenn","0:00:03","Untitled - Notepad"',
].join('\r\n')

describe('parsing tasklist output', () => {
  /**
   * A window title with a comma in it is routine — "Inbox (3,412) - Gmail" —
   * and splitting the row on commas shifts every column after it, so the CPU
   * time of one process becomes the window title of another.
   */
  it('keeps a quoted comma inside its field', () => {
    const fields = parseCsvLine('"chrome.exe","8812","Console","1","512,044 K","Running","D\\glenn","0:02:10","Inbox (3,412) - Gmail"')
    expect(fields).toHaveLength(9)
    expect(fields[4]).toBe('512,044 K')
    expect(fields[8]).toBe('Inbox (3,412) - Gmail')
  })

  it('unescapes a doubled quote', () => {
    expect(parseCsvLine('"a","he said ""hi""","b"')[1]).toBe('he said "hi"')
  })

  /**
   * Hours are not padded and run well past 24 on a service that has been up
   * for weeks, so a fixed three-field split would read `103:21:44` as minutes.
   */
  it('reads cpu time counting from the right', () => {
    expect(parseCpuTime('0:00:31')).toBe(31)
    expect(parseCpuTime('0:02:10')).toBe(130)
    expect(parseCpuTime('103:21:44')).toBe(103 * 3600 + 21 * 60 + 44)
    expect(parseCpuTime('garbage')).toBe(0)
  })

  it('reads memory through the thousands separator', () => {
    expect(parseMemory('512,044 K')).toBe(512044)
    expect(parseMemory('8 K')).toBe(8)
    // A locale that groups with a dot must not read as a decimal.
    expect(parseMemory('512.044 K')).toBe(512044)
    expect(parseMemory('N/A')).toBe(0)
  })

  it('indexes every row by pid', () => {
    const rows = parseTasklist(FIRST)
    expect(rows.size).toBe(4)
    expect(rows.get(8812)!.name).toBe('chrome.exe')
    expect(rows.get(8812)!.user).toBe('DESKTOP-7Q2\\glenn')
    expect(rows.get(8812)!.cpuSeconds).toBe(130)
  })
})

describe('turning two readings into metrics', () => {
  const totalMemory = 16 * 1024 ** 3
  const result = toProcessInfo(parseTasklist(FIRST), parseTasklist(SECOND), 2000, totalMemory)
  const by = (name: string) => result.find(p => p.name === name)!

  /**
   * The whole reason for two readings. `tasklist` reports processor time since
   * the process started, so one reading describes its entire life — the same
   * mistake `ps` makes on macOS, where summing lifetime averages put the
   * dashboard at 50% against a true 27.5%.
   */
  it('measures cpu from the delta, not the total', () => {
    // 2 processor seconds over a 2 second window: one core's worth.
    expect(by('chrome.exe').cpuPercent).toBe(100)
    // Burned nothing in the window, despite 31 seconds of history.
    expect(by('svchost.exe').cpuPercent).toBe(0)
    // 4 seconds over 2 is two cores' worth, which is a real reading on a
    // multi-core machine and must not be clamped to 100.
    expect(by('System Idle Process').cpuPercent).toBe(200)
  })

  it('credits a process that appeared mid-window with nothing', () => {
    // notepad has 3 seconds of cpu time but no earlier reading. Subtracting
    // from zero would report 150%.
    expect(by('notepad.exe').cpuPercent).toBe(0)
  })

  it('reports zero rather than a negative when a pid is reused', () => {
    const before = parseTasklist('"a.exe","5","Console","1","1 K","Running","d\\u","0:10:00","N/A"')
    const after = parseTasklist('"b.exe","5","Console","1","1 K","Running","d\\u","0:00:01","N/A"')
    expect(toProcessInfo(before, after, 1000, totalMemory)[0].cpuPercent).toBe(0)
  })

  it('converts memory to MB and a share of this machine', () => {
    const chrome = by('chrome.exe')
    expect(chrome.memoryMB).toBe(Math.round(530120 * 1024 / 1e6))
    expect(chrome.memoryPercent).toBeGreaterThan(2.5)
    expect(chrome.memoryPercent).toBeLessThan(4)
  })

  /**
   * Session 0 is the services session, and the account name is localised —
   * `NT-AUTORITÄT\SYSTEM` on a German install — so the domain is stripped
   * before comparing.
   */
  it('tells a service from something the user is running', () => {
    expect(by('svchost.exe').isSystem).toBe(true)
    expect(by('System Idle Process').isSystem).toBe(true)
    expect(by('explorer.exe').isSystem).toBe(false)
    expect(by('chrome.exe').isSystem).toBe(false)
  })

  it('does not invent a command line it was never given', () => {
    // `tasklist` reports no command line, and a fabricated one would make the
    // UI's column a duplicate that looks like a path.
    expect(by('chrome.exe').fullCommand).toBe('chrome.exe')
  })

  it('survives output that is empty or malformed', () => {
    expect(parseTasklist('').size).toBe(0)
    expect(parseTasklist('not,csv,at,all').size).toBe(0)
    expect(toProcessInfo(new Map(), new Map(), 1000, totalMemory)).toEqual([])
  })
})
