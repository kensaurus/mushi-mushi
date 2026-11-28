/**
 * Vitest setup: every per-isolate TTL cache (_shared/ttl-cache.ts) starts each
 * test empty, as each edge worker starts. Modules are shared by the tests of
 * one file, so without this a cached API key row, project access answer or
 * GitHub token from one test would answer the next test's lookup.
 *
 * Reads the registry from globalThis instead of importing ttl-cache.ts, so no
 * Edge Function module loads before a test file's vi.mock calls apply.
 */
import { beforeEach } from 'vitest'

beforeEach(() => {
  const caches = (globalThis as { __mushiTtlCaches?: Set<{ clear(): void }> }).__mushiTtlCaches
  caches?.forEach((c) => c.clear())
})
