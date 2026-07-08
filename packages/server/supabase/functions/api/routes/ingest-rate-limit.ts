/**
 * FILE: api/routes/ingest-rate-limit.ts
 * PURPOSE: Pure classifier for the report_ingest_rate_limit_claim RPC outcome.
 *          Kept dependency-free so the Deno unit tests can import it without
 *          pulling in env/DB-touching modules.
 */

/**
 * Classify the outcome of the report_ingest_rate_limit_claim RPC. supabase-js
 * returns RPC failures in the result's `error` field (it does not throw), so
 * the caller must branch on this classification:
 *  - 'ok'          — under the cap, continue.
 *  - 'breach'      — P0001 rate_limit_exceeded, reject with 429 + Retry-After 60.
 *  - 'fail-open'   — Postgres 42883: the claim function isn't deployed yet
 *                    (migration window). The ONLY deliberate fail-open.
 *  - 'fail-closed' — any other RPC error. Reject with 429, matching
 *                    claimIpRateLimit in cli-auth.ts: ingest already needs this
 *                    database for its real work, so rejecting costs no
 *                    availability a DB outage wouldn't already cost.
 */
export function classifyIngestRateLimitError(
  error: { message?: string; code?: string } | null,
): 'ok' | 'breach' | 'fail-open' | 'fail-closed' {
  if (!error) return 'ok';
  const msg = error.message ?? '';
  if (msg.includes('rate_limit_exceeded')) return 'breach';
  // Fail-open ONLY for the claim function itself being undeployed: Postgres
  // 42883 (undefined_function), or PostgREST's schema-cache phrasing that
  // names the function. A bare "does not exist" is NOT enough — that string
  // also appears in unrelated errors (missing table/column on a degraded
  // database), which must fail closed.
  if (
    error.code === '42883' ||
    (msg.includes('report_ingest_rate_limit_claim') && msg.includes('does not exist'))
  ) {
    return 'fail-open';
  }
  return 'fail-closed';
}
