/**
 * Tiny concurrency limiter for Edge Functions (Wave S3).
 *
 * Why not `npm:p-limit@5`? It works under Deno but pulls in 2 kB of unused
 * helper code and an extra module resolution hop on every cold start. Our
 * fan-out sites (judge-batch, sentry-seer-poll, intelligence-report,
 * soc2-evidence, classify-report RAG) all need the same 15-line primitive.
 *
 * Semantics:
 *   - `mapWithConcurrency(items, limit, worker)` preserves input order in
 *     the returned array.
 *   - Rejections propagate. Callers wanting "best-effort" behaviour should
 *     catch inside their worker and return a sentinel.
 *   - `limit` defaults to 5, chosen to stay under provider per-minute rate
 *     caps (Anthropic: 50 req/min for most tiers; 5 in-flight × ~6s latency
 *     ≈ 50 req/min at steady state) without starving DB pool connections.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const effectiveLimit = Math.max(1, Math.min(limit | 0, items.length))
  const results = new Array<R>(items.length)
  let cursor = 0

  async function drain(): Promise<void> {
    while (true) {
      const idx = cursor++
      if (idx >= items.length) return
      results[idx] = await worker(items[idx], idx)
    }
  }

  const workers = Array.from({ length: effectiveLimit }, () => drain())
  await Promise.all(workers)
  return results
}

/**
 * Like `mapWithConcurrency` but swallows per-item errors into a
 * `{ ok, value | error }` envelope. Use in cron-style batch loops where a
 * single report failure must not abort the rest.
 */
export async function allSettledWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<Array<{ ok: true; value: R } | { ok: false; error: unknown }>> {
  return mapWithConcurrency(items, limit, async (item, idx) => {
    try {
      return { ok: true, value: await worker(item, idx) } as const
    } catch (error) {
      return { ok: false, error } as const
    }
  })
}
