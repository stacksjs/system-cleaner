import type { StxOptions } from '@stacksjs/stx'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { isPathSafe, getDirSize, HOME } from '@system-cleaner/core'
import { cleanDirectory, emptyTrash } from '@system-cleaner/clean'
import { killProcess, toggleStartupItem } from '@system-cleaner/uninstall'
import { scanDirectory } from '@system-cleaner/disk'

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function errorJson(error: string, status = 500) {
  return json({ success: false, error }, status)
}

const config: StxOptions = {
  componentsDir: 'components',
  partialsDir: 'components',
  layoutsDir: 'layouts',
  debug: false,
  cache: false,

  apiRoutes: {
    '/api/disk-scan': async () => {
      try {
        const result = scanDirectory(HOME, {
          maxDepth: 6,
          timeoutMs: 8000,
        })

        return json({
          success: true,
          tree: result.tree,
          folderCount: result.totalFolders,
          fileCount: result.totalFiles,
          scanTime: result.scanTimeMs < 1000 ? `${result.scanTimeMs}ms` : `${(result.scanTimeMs / 1000).toFixed(1)}s`,
        })
      }
      catch (err) {
        return errorJson(err instanceof Error ? err.message : 'Scan failed')
      }
    },

    '/api/delete-path': async (req) => {
      try {
        const { path: target } = (await req.json()) as { path: string }
        if (!target) return errorJson('No path provided', 400)
        const check = isPathSafe(target)
        if (!check.safe) return errorJson(check.reason || 'Path not safe', 403)
        const resolved = path.resolve(target)
        const stat = fs.statSync(resolved)
        const size = stat.isDirectory() ? await getDirSize(resolved) : stat.size
        fs.rmSync(resolved, { recursive: true, force: true })
        return json({ success: true, freedBytes: size })
      }
      catch (err) {
        return errorJson(err instanceof Error ? err.message : 'Delete failed')
      }
    },

    '/api/clean-dir': async (req) => {
      try {
        const { path: target } = (await req.json()) as { path: string }
        if (!target) return errorJson('No path provided', 400)
        const result = await cleanDirectory(target)
        return json({ success: result.errors.length === 0, freedBytes: result.freedBytes, errors: result.errors.length ? result.errors : undefined })
      }
      catch (err) {
        return errorJson(err instanceof Error ? err.message : 'Clean failed')
      }
    },

    '/api/kill-process': async (req) => {
      try {
        const { pid } = (await req.json()) as { pid: number }
        if (!pid) return errorJson('No PID provided', 400)
        const result = await killProcess(pid)
        return json({ ...result, pid })
      }
      catch (err) {
        return errorJson(err instanceof Error ? err.message : 'Kill failed')
      }
    },

    '/api/toggle-startup': async (req) => {
      try {
        const { filepath, action } = (await req.json()) as { filepath: string, label: string, action: 'enable' | 'disable' }
        if (!filepath) return errorJson('No filepath provided', 400)
        const result = await toggleStartupItem(filepath, action)
        return json({ ...result, action })
      }
      catch (err) {
        return errorJson(err instanceof Error ? err.message : 'Toggle failed')
      }
    },

    '/api/dir-sizes': async (req) => {
      try {
        const { paths } = (await req.json()) as { paths: string[] }
        if (!paths || !Array.isArray(paths))
          return errorJson('No paths provided', 400)
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
      }
      catch (err) {
        return errorJson(err instanceof Error ? err.message : 'Size calculation failed')
      }
    },

    '/api/empty-trash': async () => {
      try {
        const result = await emptyTrash()
        return json({ success: result.success, freedBytes: result.freedBytes })
      }
      catch (err) {
        return errorJson(err instanceof Error ? err.message : 'Empty trash failed')
      }
    },
  },
}

export default config
