import { lstatSync } from 'node:fs'
import path from 'node:path'
import { CLEAN_TARGETS } from '@system-cleaner/clean'
import { isPermissionGated, isWithinHome } from '@system-cleaner/core'
import type { DiskEntry } from '@system-cleaner/core'
import { discoverAIWorktrees } from './disk-worktrees'

const cacheTargets = new Map(CLEAN_TARGETS
  .filter(target => target.risk === 'safe' && !target.requiresSudo && ['cache', 'browser', 'log'].includes(target.category))
  .map(target => [target.path, target]))

export function diskSuggestions(tree: DiskEntry | undefined, protectedPaths: ReadonlySet<string>) {
  const claudeRoots: string[] = []
  const sizes = new Map<string, number>()
  const caches: Array<{ path: string, name: string, category: 'logs' | 'caches', detail: string, sizeBytes: number, modifiedAt: number }> = []

  function visit(entry: DiskEntry): void {
    if (entry.aggregate) return
    if (entry.isDirectory && !entry.unmeasured) {
      sizes.set(entry.path, entry.sizeBytes)
      if (entry.name === 'worktrees' && path.basename(path.dirname(entry.path)) === '.claude')
        claudeRoots.push(entry.path)
      const target = cacheTargets.get(entry.path)
      if (target && entry.sizeBytes >= 1_000_000 && isWithinHome(entry.path) && !isPermissionGated(entry.path)) {
        try {
          const stat = lstatSync(entry.path)
          if (stat.isDirectory())
            caches.push({ path: entry.path, name: target.name, category: target.category === 'log' ? 'logs' : 'caches',
              detail: target.description, sizeBytes: entry.sizeBytes, modifiedAt: stat.mtimeMs })
        }
        catch { /* The old scan can include a folder that is already gone. */ }
      }
    }
    for (const child of entry.children ?? []) visit(child)
  }
  if (tree) visit(tree)
  return [
    ...discoverAIWorktrees(protectedPaths, undefined, undefined, claudeRoots).map(item => ({
      ...item, category: 'worktrees', detail: item.tool, sizeBytes: sizes.get(item.path) ?? null,
    })),
    ...caches,
  ]
}
