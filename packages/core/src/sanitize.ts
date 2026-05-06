/**
 * Input validators / sanitizers for HTTP route handlers.
 *
 * These exist because every brew/pantry/launchctl handler used to
 * interpolate a JSON-supplied string straight into `bash -c "...${value}..."`
 * — a request body of `{"name": "x; rm -rf ~"}` was an accepted
 * command-injection vector. Validating inputs at a single, tested boundary
 * catches the whole class.
 */

/** Brew/Pantry package tokens: lowercase, digits, and `@._+-`. */
const PACKAGE_NAME_RE = /^[a-z0-9@._+-]{1,128}$/i

/**
 * Validate a Homebrew formula or cask token, or a Pantry package name.
 * Returns the original string if safe, or `null` otherwise. Reject empty,
 * over-long, and any string containing characters outside the allowlist.
 *
 * Use the result with argv-style spawn (`Bun.spawn(['brew','upgrade',name])`),
 * never with `bash -c`. The allowlist is a defence-in-depth backstop.
 */
export function sanitizePackageName(value: unknown): string | null {
  if (typeof value !== 'string')
    return null
  if (!PACKAGE_NAME_RE.test(value))
    return null
  return value
}

/**
 * Validate a process id. Accepts only positive integers up to 2^31-1.
 * Returns the integer or `null`. (Float, negative, NaN, string, 0 → null.)
 */
export function sanitizePid(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value))
    return null
  if (value <= 0 || value > 0x7FFF_FFFF)
    return null
  return value
}

/**
 * Validate that a value is an array of non-empty strings within a length
 * cap. Returns the original array on success, `null` otherwise. Used by
 * `/dir-sizes` to keep clients from posting 100k entries that stall the
 * event loop.
 */
export function sanitizeStringArray(value: unknown, maxLen = 1024): string[] | null {
  if (!Array.isArray(value))
    return null
  if (value.length === 0 || value.length > maxLen)
    return null
  for (const v of value) {
    if (typeof v !== 'string' || v.length === 0 || v.length > 4096)
      return null
  }
  return value as string[]
}

/**
 * Escape a string for safe interpolation inside an AppleScript double-quoted
 * literal. macOS AppleScript treats `"` and `\` as special inside `"..."` so
 * we escape both. Defends `osascript -e 'do shell script "..."'` from
 * filepath-based injection (relevant to the launch-agent code paths).
 */
export function appleScriptEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}
