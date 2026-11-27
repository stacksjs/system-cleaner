import { lstat, watch } from 'node:fs'
import type { FSWatcher } from 'node:fs'
import path from 'node:path'
import { HOME, isWithin } from '@system-cleaner/core'

const LEASE_MS = 60_000
const REMOVAL_LIMIT = 512

/** Keep a small feed of disappearing paths while Disk Usage is open. */
export class DiskChanges {
  revision = 0
  private watcher?: FSWatcher
  private lease?: ReturnType<typeof setTimeout>
  private removals = new Map<string, number>()

  constructor(private root: string) {}

  mark(removed?: string): void {
    this.revision++
    if (removed) {
      this.removals.delete(removed)
      this.removals.set(removed, this.revision)
      if (this.removals.size > REMOVAL_LIMIT)
        this.removals.delete(this.removals.keys().next().value!)
    }
  }

  read(since: number) {
    if (!this.watcher) {
      try {
        const watcher = watch(this.root, { recursive: true, persistent: false }, (event, name) => {
          if (event !== 'rename' || !name) return
          const target = path.resolve(this.root, name)
          if (target === this.root || !isWithin(target, this.root)) return
          lstat(target, (error) => {
            if (this.watcher === watcher && (error?.code === 'ENOENT' || error?.code === 'ENOTDIR')) this.mark(target)
          })
        })
        watcher.on('error', () => {
          if (this.watcher === watcher) this.close()
        })
        this.watcher = watcher
      }
      catch { /* Explicit app mutations still advance the revision. */ }
    }
    clearTimeout(this.lease)
    if (this.watcher) {
      this.lease = setTimeout(() => this.close(), LEASE_MS)
      this.lease.unref()
    }
    return {
      revision: this.revision,
      watching: !!this.watcher,
      removed: [...this.removals].filter(([, revision]) => revision > since).map(([target]) => target),
    }
  }

  close(): void {
    clearTimeout(this.lease)
    if (!this.watcher) return
    this.watcher.close()
    this.watcher = undefined
    // The next request must reconcile changes made while the watcher was off.
    this.mark()
  }
}

export const diskChanges = new DiskChanges(HOME)
