/**
 * The app's own preferences: the switches in Settings that are nothing but a
 * stored boolean.
 *
 * Settings writes them and the rest of the app reads them, so the key and the
 * defaults live here, once. Both sides run in the same website data store (the
 * main window, the menu bar popover and Settings all share it), which is why
 * localStorage is enough for every switch whose effect happens in a window.
 *
 * "Keep a cleanup history" is not here: the history is written by the agent,
 * the scheduled clean included, and neither can read localStorage. That one
 * lives in the database (`app/Models/AppPreference.ts`) and Settings reads and
 * writes it over `/api/app-preferences`.
 */

export const PREFS_KEY = 'systemcleaner-preferences'

/**
 * Every switch with the value it has before anyone touches it. Declared
 * rather than scattered so "restore defaults" has something to restore to.
 */
export const PREF_DEFAULTS: Record<string, boolean> = {
  autoCheckUpdates: true,
  confirmDeletes: true,
  notifyOnFinish: true,
  notifyOnSchedule: true,
  notifyOnUpdate: true,
}

export function readPrefs(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  }
  catch {
    // A private window, a cleared store, or something else's JSON under our
    // key. Defaults are a correct answer to all three.
    return {}
  }
}

export function readPref(key: string): boolean {
  const value = readPrefs()[key]
  return typeof value === 'boolean' ? value : (PREF_DEFAULTS[key] ?? false)
}
