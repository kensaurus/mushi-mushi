/**
 * FILE: packages/server/supabase/functions/_shared/ttl-cache.ts
 * PURPOSE: A small time-limited map, per isolate.
 *
 * An edge worker lives up to 400 s on a paid plan and serves several requests
 * (measured 2026-11-28: `api` about 8 per worker, a cron 1). A short TTL cuts
 * repeat PostgREST reads inside one worker; it never outlives the worker, and
 * nothing here is shared between workers.
 *
 * Callers decide what may be cached and check access before reading. Never
 * log a cached value: some callers keep decrypted secrets here.
 *
 * Dependency-free so `auth.ts` can import it without growing the `api`
 * upload (scripts/deploy-edge-function.test.mjs holds it under budget).
 *
 * Every cache registers in `globalThis.__mushiTtlCaches`, so the server's
 * vitest setup (src/__tests__/__stubs__/reset-ttl-caches.ts) can start each
 * test empty, as each worker starts, without importing the module that owns
 * the cache (which would load it before the test's vi.mock calls).
 */

type Clearable = { clear(): void }
const registry: Set<Clearable> = ((globalThis as { __mushiTtlCaches?: Set<Clearable> }).__mushiTtlCaches ??= new Set())

export function createTtlCache<T>(ttlMs: number, max = 500) {
  const entries = new Map<string, { at: number; value: T }>()
  const cache = {
    get(key: string, now: number = Date.now()): { value: T; at: number } | null {
      const e = entries.get(key)
      if (!e) return null
      if (now - e.at >= ttlMs) {
        entries.delete(key)
        return null
      }
      return e
    },
    set(key: string, value: T, now: number = Date.now()): void {
      if (!entries.has(key) && entries.size >= max) entries.delete(entries.keys().next().value as string)
      entries.set(key, { at: now, value })
    },
    delete(key: string): void {
      entries.delete(key)
    },
    clear(): void {
      entries.clear()
    },
  }
  registry.add(cache)
  return cache
}
