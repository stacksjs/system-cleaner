import * as fs from 'node:fs'

/**
 * The loopback port the agent listens on, remembered between launches.
 *
 * Asking the OS for a free port is right: a fixed one collides with whatever
 * else the user is running, and with a second copy of the app. Asking for a
 * *different* free port every launch is not, and that is what this app did.
 *
 * The page is served from `http://127.0.0.1:<port>`, so the port is the origin
 * — and browser storage is scoped to an origin. A port that changed on every
 * start meant an origin that changed on every start, which silently emptied
 * `localStorage`: the colour mode reset to "system", and every switch in the
 * Settings window went back to its default, on every launch. Nothing reported
 * it, because nothing had failed.
 *
 * So the launcher writes the number down and asks for it next time. The agent
 * falls back to a fresh port when it is taken, which is the one case where the
 * old storage is unreachable — another copy of the app already running, or
 * something else that has since claimed it.
 *
 * These are here rather than in `app/Desktop/launcher.ts` because that module
 * starts a server and opens a window as a side effect of being imported, so
 * nothing in it can be tested.
 */

/** Ports below this are the well-known range, which the OS never hands out. */
const LOWEST_USABLE = 1025

/**
 * The port recorded in `file`, or 0 for "ask the OS".
 *
 * Zero is the answer to every kind of missing or unusable file — absent,
 * unreadable, empty, or holding something that is not a port — because the
 * caller's next act is to pass this to `Bun.serve`, where 0 means exactly
 * "pick one for me". There is no failure to report: a first launch reaches
 * here too.
 */
export function readRememberedPort(file: string): number {
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf8')
  }
  catch {
    return 0
  }

  // `Number.parseInt` would read "8080abc" as 8080 and "0x1f" as 0. A port is
  // a run of digits and nothing else.
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed))
    return 0

  const port = Number(trimmed)
  return port >= LOWEST_USABLE && port <= 65535 ? port : 0
}

/**
 * Record the port for the next launch. Silent on failure — a read-only home
 * directory or a full disk costs the app its stored preferences at the next
 * start, which is where it was before any of this, and is not worth
 * interrupting a launch over.
 */
export function rememberPort(file: string, port: number): void {
  if (!Number.isInteger(port) || port < LOWEST_USABLE || port > 65535)
    return

  try {
    fs.writeFileSync(file, `${port}\n`)
  }
  catch {
    // See above.
  }
}
