import type { StxOptions } from '@stacksjs/stx'
import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

const HOME = os.homedir()

const PROTECTED_PATHS = new Set([
  HOME,
  path.join(HOME, 'Desktop'),
  path.join(HOME, 'Documents'),
  path.join(HOME, 'Downloads'),
  path.join(HOME, 'Pictures'),
  path.join(HOME, 'Music'),
  path.join(HOME, 'Movies'),
  path.join(HOME, '.ssh'),
  path.join(HOME, '.gnupg'),
])

function isPathSafe(targetPath: string): { safe: boolean, reason?: string } {
  const resolved = path.resolve(targetPath)
  if (!resolved.startsWith(HOME))
    return { safe: false, reason: 'Path is outside home directory' }
  if (resolved === HOME)
    return { safe: false, reason: 'Cannot delete home directory' }
  if (PROTECTED_PATHS.has(resolved))
    return { safe: false, reason: `${path.basename(resolved)} is a protected directory` }
  try {
    const stat = fs.lstatSync(resolved)
    if (stat.isSymbolicLink())
      return { safe: false, reason: 'Will not delete symbolic links for safety' }
  }
  catch {
    return { safe: false, reason: 'Path does not exist' }
  }
  return { safe: true }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function getDirSize(dirPath: string): number {
  try {
    const out = execSync(`du -sk "${dirPath}" 2>/dev/null | cut -f1`, {
      encoding: 'utf8',
      timeout: 10_000,
    }).trim()
    return (Number.parseInt(out) || 0) * 1024
  }
  catch {
    return 0
  }
}

const config: StxOptions = {
  componentsDir: 'components',
  partialsDir: 'components',
  layoutsDir: 'layouts',
  debug: false,
  cache: false,

  apiRoutes: {
    '/api/disk-scan': async () => {
      const SCAN_PATH = HOME
      const MAX_DEPTH = 4
      const DETAIL_DEPTH = 6
      const MAX_SCAN_MS = 8000
      const MAX_FILE_CHILDREN = 5
      const SKIP_RECURSE = new Set(['node_modules', '.git', '__pycache__', '.cache', 'vendor', 'DerivedData', '.Spotlight-V100', '.fseventsd', 'CachedData', 'GPUCache', 'ShaderCache', '.npm', '.bun', '.Trash', 'Caches'])
      const SKIP_SYSTEM = new Set(['.Spotlight-V100', '.fseventsd', '.vol', '.file'])

      const scanStart = Date.now()
      let aborted = false, folderCount = 0, fileCount = 0, checks = 0

      function scanDir(dirPath: string, depth: number): any {
        if (depth > DETAIL_DEPTH || aborted) return { n: path.basename(dirPath) || '/', p: dirPath, s: 0, d: true, c: [] }
        checks++
        if (checks % 500 === 0 && Date.now() - scanStart > MAX_SCAN_MS) { aborted = true; return { n: path.basename(dirPath) || '/', p: dirPath, s: 0, d: true, c: [] } }
        let entries: fs.Dirent[]
        try { entries = fs.readdirSync(dirPath, { withFileTypes: true }) } catch { return { n: path.basename(dirPath) || '/', p: dirPath, s: 0, d: true, c: [] } }
        const children: any[] = []; let totalSize = 0
        for (const entry of entries) {
          if (aborted) break
          if (SKIP_SYSTEM.has(entry.name)) continue
          const fullPath = path.join(dirPath, entry.name)
          try {
            const stats = fs.lstatSync(fullPath)
            if (stats.isSymbolicLink()) continue
            if (stats.isDirectory()) {
              folderCount++
              if (SKIP_RECURSE.has(entry.name) || depth >= DETAIL_DEPTH - 1) { children.push({ n: entry.name, p: fullPath, s: stats.size || 4096, d: true, c: [] }); totalSize += stats.size || 4096 }
              else { const child = scanDir(fullPath, depth + 1); children.push(child); totalSize += child.s }
            } else {
              fileCount++
              if (children.filter((c: any) => !c.d).length < MAX_FILE_CHILDREN) children.push({ n: entry.name, p: fullPath, s: stats.size, d: false })
              totalSize += stats.size
            }
          } catch { /* skip inaccessible */ }
          checks++
          if (checks % 500 === 0 && Date.now() - scanStart > MAX_SCAN_MS) { aborted = true; break }
        }
        children.sort((a: any, b: any) => b.s - a.s)
        return { n: path.basename(dirPath) || '/', p: dirPath, s: totalSize, d: true, c: children }
      }

      const tree = scanDir(SCAN_PATH, 0)
      const duration = Date.now() - scanStart
      const scanTime = duration < 1000 ? `${duration}ms` : `${(duration / 1000).toFixed(1)}s`

      return json({ success: true, tree, folderCount, fileCount, scanTime })
    },

    '/api/delete-path': async (req) => {
      const { path: target } = (await req.json()) as { path: string }
      if (!target) return json({ success: false, error: 'No path provided' }, 400)
      const check = isPathSafe(target)
      if (!check.safe) return json({ success: false, error: check.reason }, 403)
      const resolved = path.resolve(target)
      const stat = fs.statSync(resolved)
      const size = stat.isDirectory() ? getDirSize(resolved) : stat.size
      fs.rmSync(resolved, { recursive: true, force: true })
      return json({ success: true, freedBytes: size })
    },

    '/api/clean-dir': async (req) => {
      const { path: target } = (await req.json()) as { path: string }
      if (!target) return json({ success: false, error: 'No path provided' }, 400)
      const resolved = path.resolve(target)
      if (!resolved.startsWith(HOME))
        return json({ success: false, error: 'Path outside home directory' }, 403)
      const sizeBefore = getDirSize(resolved)
      const errors: string[] = []
      for (const entry of fs.readdirSync(resolved)) {
        try { fs.rmSync(path.join(resolved, entry), { recursive: true, force: true }) }
        catch (err: any) { errors.push(`${entry}: ${err.message}`) }
      }
      const freed = sizeBefore - getDirSize(resolved)
      return json({ success: true, freedBytes: freed, errors: errors.length ? errors : undefined })
    },

    '/api/kill-process': async (req) => {
      const { pid } = (await req.json()) as { pid: number }
      if (!pid) return json({ success: false, error: 'No PID provided' }, 400)
      const uid = os.userInfo().uid
      try {
        const out = execSync(`ps -p ${pid} -o uid=`, { encoding: 'utf8', timeout: 3000 }).trim()
        if (Number.parseInt(out) !== uid)
          return json({ success: false, error: 'Can only kill your own processes' }, 403)
      }
      catch { return json({ success: false, error: 'Process not found' }, 404) }
      process.kill(pid, 'SIGTERM')
      return json({ success: true, pid })
    },

    '/api/toggle-startup': async (req) => {
      const { filepath, action } = (await req.json()) as { filepath: string, label: string, action: 'enable' | 'disable' }
      if (!filepath) return json({ success: false, error: 'No filepath provided' }, 400)
      if (!filepath.startsWith(path.join(HOME, 'Library/LaunchAgents')))
        return json({ success: false, error: 'Can only toggle user launch agents' }, 403)
      try {
        if (action === 'disable')
          execSync(`launchctl unload -w "${filepath}" 2>/dev/null`, { timeout: 5000 })
        else
          execSync(`launchctl load -w "${filepath}" 2>/dev/null`, { timeout: 5000 })
      }
      catch { /* launchctl often exits non-zero even on success */ }
      return json({ success: true, action })
    },

    '/api/dir-sizes': async (req) => {
      const { paths } = (await req.json()) as { paths: string[] }
      if (!paths || !Array.isArray(paths))
        return json({ success: false, error: 'No paths provided' }, 400)
      const results: Record<string, number> = {}
      await Promise.all(paths.map(async (p) => {
        const resolved = path.resolve(p)
        if (!resolved.startsWith(HOME)) return
        try {
          const proc = Bun.spawn(['du', '-sk', resolved], { stdout: 'pipe', stderr: 'ignore' })
          const timeout = setTimeout(() => proc.kill(), 5000)
          const out = await new Response(proc.stdout).text()
          clearTimeout(timeout)
          results[p] = (Number.parseInt(out.trim().split('\t')[0]) || 0) * 1024
        }
        catch { results[p] = 0 }
      }))
      return json({ success: true, sizes: results })
    },

    '/api/empty-trash': async () => {
      const trashPath = path.join(HOME, '.Trash')
      const sizeBefore = getDirSize(trashPath)
      for (const entry of fs.readdirSync(trashPath)) {
        try { fs.rmSync(path.join(trashPath, entry), { recursive: true, force: true }) }
        catch { /* skip locked files */ }
      }
      return json({ success: true, freedBytes: sizeBefore })
    },
  },
}

export default config
