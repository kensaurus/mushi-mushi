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
const MCP_TOOL_CALL_MAX_PER_MINUTE = 120

export interface McpRateLimitMiss {
  retryAfterSeconds: number
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
