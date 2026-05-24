export interface CacheEntry<T> {
  value: T
  expiresAt: number
}

/** Simple in-memory TTL cache for API sub-results and responses. */
export class TtlCache<T> {
  private store = new Map<string, CacheEntry<T>>()

  constructor(private defaultTtlMs: number) {}

  get(key: string): T | undefined {
    const entry = this.store.get(key)
    if (!entry) return undefined
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key)
      return undefined
    }
    return entry.value
  }

  set(key: string, value: T, ttlMs?: number): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
    })
  }

  delete(key: string): void {
    this.store.delete(key)
  }

  deletePrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key)
    }
  }

  clear(): void {
    this.store.clear()
  }
}

const flights = new Map<string, Promise<unknown>>()

/** Coalesce concurrent identical async work (e.g. updates-check). */
export async function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = flights.get(key) as Promise<T> | undefined
  if (existing) return existing
  const promise = fn().finally(() => {
    flights.delete(key)
  })
  flights.set(key, promise)
  return promise
}
