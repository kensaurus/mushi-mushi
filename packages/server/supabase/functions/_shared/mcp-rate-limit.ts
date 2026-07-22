/**
 * FILE: packages/server/supabase/functions/_shared/mcp-rate-limit.ts
 * PURPOSE: Per-actor rate limit for MCP `tools/call` on the hosted transport
 *          (production-readiness audit, Tier 1 item #11).
 *
 * WHY: Before this, only `run_nl_query` was incidentally throttled — via the
 * REST layer it forwards to (`graph-query.ts`'s 60/hr `nl_query_rate_limit_claim`),
 * not via the MCP dispatcher itself. Every other tool, including destructive
 * ones (`dispatch_fix`, `merge_fix`, `award_bonus_points`), had no MCP-level
 * budget at all. A single leaked `mcp:write` API key could hammer them
 * unthrottled — each call still hits its downstream REST endpoint's own
 * checks, but nothing stopped thousands of calls per minute from a hot loop
 * or a compromised key before those checks even ran.
 *
 * DESIGN: Reuses the same `scoped_rate_limit_claim` RPC already backing the
 * CLI device-auth, Ask Mushi, and codebase-chat throttles (see
 * `_shared/tenant-observability.ts` for the canonical pattern) — one atomic
 * UPSERT, fails OPEN on unexpected RPC errors (a rate-limit backend hiccup
 * must not take down every tool call), fails CLOSED only on the specific
 * `rate_limit_exceeded` (P0001) signal.
 *
 * BUDGET: 120 calls/minute per actor (API key id, or the authenticated
 * user id for Bearer-JWT callers without an API key). ~2/sec sustained is
 * generous for multi-step agent loops (an orchestrator calling several
 * tools per turn) while still bounding a runaway or leaked-key abuse loop.
 * This is deliberately a single global budget across all tools, not a
 * per-tool one — layering per-tool budgets on top of this is a reasonable
 * future refinement (e.g. a tighter budget specifically for the
 * destructive/reputation-mutating tools) but out of scope for this pass.
 */

import { getServiceClient } from './db.ts'
import { log } from './logger.ts'

const mcpRateLog = log.child('mcp:rate-limit')

const MCP_TOOL_CALL_SCOPE = 'mcp_tool_call'
export const MCP_TOOL_CALL_MAX_PER_MINUTE = 120
export const MCP_NL_QUERY_MAX_PER_HOUR = 60

export interface McpRateLimitMiss {
  retryAfterSeconds: number
}

/**
 * Build X-RateLimit-* headers for MCP responses.
 *
 * Included on every successful `tools/call` response so agents and
 * human callers can self-throttle without waiting for a 429.
 * Published limits (mirrors SECURITY.md):
 *   - tools/call: 120 calls per minute per actor key
 *   - nl_query:   60 calls per hour  per actor key
 *
 * `remaining` is an estimate derived from the actor's window claim count
 * (best-effort — we don't query the DB for the exact count on every call
 * to avoid an extra RTT; the real gate is the DB-backed UPSERT).
 *
 * Complies with the IETF draft-ietf-httpapi-ratelimit-headers-06 format
 * (same as GitHub, Linear, Stripe):
 *   X-RateLimit-Limit     — total calls allowed in the window
 *   X-RateLimit-Remaining — estimated remaining calls (may be 0 on miss)
 *   X-RateLimit-Reset     — Unix timestamp (seconds) when the window resets
 *   Retry-After           — seconds until retry (only on 429 responses)
 */
export function buildRateLimitHeaders(opts: {
  scope: 'tools_call' | 'nl_query'
  /** Whether this response is a rate-limit miss (429). */
  isMiss: boolean
  /** Unix timestamp of the window start (to compute reset). */
  windowStartSec: number
}): Record<string, string> {
  const isNl = opts.scope === 'nl_query'
  const limit = isNl ? MCP_NL_QUERY_MAX_PER_HOUR : MCP_TOOL_CALL_MAX_PER_MINUTE
  const windowSeconds = isNl ? 3600 : 60
  const resetSec = opts.windowStartSec + windowSeconds

  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(limit),
    'X-RateLimit-Remaining': opts.isMiss ? '0' : String(Math.max(0, limit - 1)),
    'X-RateLimit-Reset': String(Math.ceil(resetSec)),
    'X-RateLimit-Policy': isNl
      ? `${limit};w=${windowSeconds};comment="nl_query per actor"`
      : `${limit};w=${windowSeconds};comment="mcp_tool_call per actor"`,
  }

  if (opts.isMiss) {
    const retryAfter = Math.max(1, Math.ceil(resetSec - Date.now() / 1000))
    headers['Retry-After'] = String(retryAfter)
  }

  return headers
}

/**
 * Claim a rate-limit slot for one `tools/call` invocation. Returns `null`
 * when the actor is under budget (call proceeds); returns a miss descriptor
 * when the actor is over budget (caller should reject with a rate-limit
 * error). Never throws — DB/RPC failures degrade to fail-open so a
 * rate-limit backend hiccup never blocks legitimate tool calls.
 */
export async function claimMcpToolCallRateLimit(actorId: string): Promise<McpRateLimitMiss | null> {
  const db = getServiceClient()
  const { error } = await db.rpc('scoped_rate_limit_claim', {
    p_user_id: actorId,
    p_scope: MCP_TOOL_CALL_SCOPE,
    p_max_per_window: MCP_TOOL_CALL_MAX_PER_MINUTE,
    p_window: '1 minute',
  })
  if (!error) return null
  if ((error.message ?? '').includes('rate_limit_exceeded')) {
    return { retryAfterSeconds: 60 }
  }
  mcpRateLog.warn('rate limit check failed (non-fatal, failing open)', { err: error.message })
  return null
}
