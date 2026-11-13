/** Processes created and owned by this launcher, never discovered by name. */
export interface OwnedProcess {
  kill: (signal?: 'SIGTERM' | 'SIGKILL') => void
  exited: Promise<number>
}

/** Graceful shutdown with a bounded force-stop, shared by every exit path. */
export function createProcessShutdown(children: () => readonly OwnedProcess[], graceMs = 2000) {
  let stopping: Promise<void> | undefined
  function force(): void {
    for (const child of children()) {
      try { child.kill('SIGKILL') }
      catch { /* Already exited. */ }
    }
  }
  function stop(): Promise<void> {
    stopping ??= Promise.all(children().map(async (child) => {
      try { child.kill('SIGTERM') }
      catch { /* An already-exited child still has a settled exited promise. */ }
      const timer = setTimeout(() => {
        try { child.kill('SIGKILL') }
        catch { /* Already exited. */ }
      }, graceMs)
      try { await child.exited }
      finally { clearTimeout(timer) }
    })).then(() => {})
    return stopping
  }
  return { stop, force }
}
