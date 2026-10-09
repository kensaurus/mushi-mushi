/**
 * LLM call totals for a time window, for /v1/admin/health/stats and
 * /v1/admin/health/llm.
 *
 * Both routes used to select the newest 500 llm_invocations rows and report
 * `rows.length` as the window's call count, so a busy project showed "500
 * calls" and rates over the newest 500 only. Counts now come from exact head
 * counts (no rows transferred); latency avg/p95 comes from the SQL function
 * llm_latency_window_stats (migration 20261004120000). Until that function
 * exists the latency is computed from the newest rows and flagged
 * `latencyExact: false`, never presented as exact.
 *
 * One helper for both routes so the header badge and the LLM tab can never
 * disagree.
 */

import { log } from './logger.ts'

/** Newest rows read when the latency function is missing. */
export const LATENCY_SAMPLE_ROWS = 500

export interface LlmWindowStats {
  totalCalls: number
  errors: number
  fallbacks: number
  errorRatePct: number
  fallbackRatePct: number
  avgLatencyMs: number
  p95LatencyMs: number
  /** False when latency came from the newest LATENCY_SAMPLE_ROWS rows only. */
  latencyExact: boolean
}

// Minimal structural type for the PostgREST builder this helper uses, so the
// unit test can pass a fake without the supabase-js types.
// deno-lint-ignore no-explicit-any
type Db = { from: (table: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any }

type CountResult = {
  count: number | null
  error: { message: string; code?: string } | null
  status?: number
}

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0
}

export function sampleLatency(latencies: number[]): { avg: number; p95: number } {
  if (latencies.length === 0) return { avg: 0, p95: 0 }
  const sorted = latencies.slice().sort((a, b) => a - b)
  const avg = Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length)
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0
  return { avg, p95 }
}

/**
 * Exact totals for `projectIds` since `sinceIso`. Throws when a count fails:
 * the route answers 500 instead of showing a made-up number.
 */
export async function loadLlmWindowStats(
  db: Db,
  projectIds: string[],
  sinceIso: string,
): Promise<LlmWindowStats> {
  if (projectIds.length === 0) {
    return {
      totalCalls: 0,
      errors: 0,
      fallbacks: 0,
      errorRatePct: 0,
      fallbackRatePct: 0,
      avgLatencyMs: 0,
      p95LatencyMs: 0,
      latencyExact: true,
    }
  }
  const count = () =>
    db
      .from('llm_invocations')
      .select('id', { count: 'exact', head: true })
      .in('project_id', projectIds)
      .gte('created_at', sinceIso)

  const [totalRes, successRes, fallbackRes, latencyRes] = (await Promise.all([
    count(),
    // Errors = total − success, so a NULL or unknown status counts as an
    // error exactly as the old `status !== 'success'` filter did.
    count().eq('status', 'success'),
    count().eq('fallback_used', true),
    db.rpc('llm_latency_window_stats', { p_project_ids: projectIds, p_since: sinceIso }),
  ])) as [CountResult, CountResult, CountResult, { data: unknown; error: { message: string; code?: string } | null }]

  for (const r of [totalRes, successRes, fallbackRes]) {
    // A head (count-only) request has no response body, so a statement timeout
    // arrives with an empty message (MUSHI-MUSHI-SERVER-2H): name the code or status.
    if (r.error) {
      const why = r.error.message || r.error.code || (r.status ? `HTTP ${r.status}` : 'no detail')
      throw new Error(`llm_invocations count failed: ${why}`)
    }
  }
  const totalCalls = totalRes.count ?? 0
  const errors = Math.max(0, totalCalls - (successRes.count ?? 0))
  const fallbacks = fallbackRes.count ?? 0

  let avgLatencyMs = 0
  let p95LatencyMs = 0
  let latencyExact = true
  const row = Array.isArray(latencyRes.data) ? latencyRes.data[0] : latencyRes.data
  if (!latencyRes.error && row && typeof row === 'object') {
    const r = row as { avg_latency_ms?: number | null; p95_latency_ms?: number | null }
    avgLatencyMs = Number(r.avg_latency_ms ?? 0)
    p95LatencyMs = Number(r.p95_latency_ms ?? 0)
  } else if (totalCalls > 0) {
    // The aggregate function is not deployed yet (or failed): use the newest
    // rows and say so, rather than fail the whole Health page.
    log.warn('llm_latency_window_stats unavailable; latency is a sample', {
      err: latencyRes.error?.message ?? 'no row',
    })
    const { data, error } = await db
      .from('llm_invocations')
      .select('latency_ms')
      .in('project_id', projectIds)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(LATENCY_SAMPLE_ROWS)
    if (error) throw new Error(`llm_invocations latency sample failed: ${error.message}`)
    const lat = sampleLatency(((data ?? []) as Array<{ latency_ms: number | null }>).map((r) => r.latency_ms ?? 0))
    avgLatencyMs = lat.avg
    p95LatencyMs = lat.p95
    latencyExact = totalCalls <= LATENCY_SAMPLE_ROWS
  }

  return {
    totalCalls,
    errors,
    fallbacks,
    errorRatePct: pct(errors, totalCalls),
    fallbackRatePct: pct(fallbacks, totalCalls),
    avgLatencyMs,
    p95LatencyMs,
    latencyExact,
  }
}
