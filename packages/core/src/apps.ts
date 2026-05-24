import * as fs from 'node:fs'
import * as path from 'node:path'
import { HOME } from './paths'
import { parsePlistToObject } from './plist'

export interface AppEntry {
  name: string
  plistPath: string
  appPath: string
}

/** List .app bundles under /Applications and ~/Applications (deduped by name). */
export function listApplicationEntries(): AppEntry[] {
  const dirs = ['/Applications', path.join(HOME, 'Applications')]
  const seen = new Set<string>()
  const results: AppEntry[] = []

  for (const dir of dirs) {
    try {
      for (const app of fs.readdirSync(dir)) {
        if (!app.endsWith('.app')) continue
        const name = app.replace(/\.app$/, '')
        if (seen.has(name)) continue
        seen.add(name)
        const appPath = path.join(dir, app)
        results.push({
          name,
          appPath,
          plistPath: path.join(appPath, 'Contents', 'Info.plist'),
        })
      }
    }
    catch {}
  }

  return results
}

/** Read CFBundleShortVersionString from an Info.plist without spawning a shell. */
export function readAppVersion(plistPath: string): string {
  try {
    if (!fs.existsSync(plistPath)) return '?'
    const info = parsePlistToObject(plistPath)
    const version = info.CFBundleShortVersionString ?? info.CFBundleVersion
    if (typeof version === 'string' && version) return version
    return '?'
  }
  catch {
    return '?'
  }
}
