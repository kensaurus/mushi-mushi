// =============================================================================
// Telemetry helpers — write structured events to llm_invocations, cron_runs,
// and anti_gaming_events. All writes are best-effort and never throw, so
// instrumentation can never break the request path it's instrumenting.
// =============================================================================

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { log as rootLog } from './logger.ts'
import { estimateCallCostUsd } from './pricing.ts'

const log = rootLog.child('telemetry')

// -----------------------------------------------------------------------------
// Anthropic cache usage extraction (AI SDK v4 + @ai-sdk/anthropic v1)
//
// LLM-5 (audit 2026-04-23): the cache-hit query returned 0/17 last 24 h. Root
// cause: callers logged `usage.promptTokens/completionTokens` but never
// reached into `providerMetadata` for the Anthropic-specific counters. The
// `classify-report` Stage 2 path does read them (via `stream.providerMetadata`)
// but `fast-filter`, `judge-batch`, `intelligence-report`, and `fix-worker`
// all dropped them, so the cache-hit ratio silently read as zero and Billing
// still assumed the cold-price per token. This helper centralises the
// extraction so every stage can log cache metrics with one line.
//
// AI SDK v4 exposes the data as `result.experimental_providerMetadata` on
// `generateObject` / `generateText` results, and `await stream.providerMetadata`
// on streamed results. v5 renamed it to `providerMetadata` (no prefix). We
// read both so the helper keeps working through the v4 → v5 migration.
// -----------------------------------------------------------------------------

export interface AnthropicCacheUsage {
  cacheCreationInputTokens: number | null
  cacheReadInputTokens: number | null
}

export function extractAnthropicCacheUsage(
  meta: unknown,
): AnthropicCacheUsage {
  const fallback: AnthropicCacheUsage = {
    cacheCreationInputTokens: null,
    cacheReadInputTokens: null,
  }
  if (!meta || typeof meta !== 'object') return fallback
  const anthropic = (meta as { anthropic?: unknown }).anthropic
  if (!anthropic || typeof anthropic !== 'object') return fallback
  const { cacheCreationInputTokens, cacheReadInputTokens } = anthropic as {
    cacheCreationInputTokens?: number
    cacheReadInputTokens?: number
  }
  return {
    cacheCreationInputTokens: typeof cacheCreationInputTokens === 'number' ? cacheCreationInputTokens : null,
    cacheReadInputTokens: typeof cacheReadInputTokens === 'number' ? cacheReadInputTokens : null,
  }
}

// -----------------------------------------------------------------------------
// LLM invocations
// -----------------------------------------------------------------------------

export interface LlmInvocationRecord {
  projectId?: string | null
  reportId?: string | null
  functionName: string
  stage?: string | null
  primaryModel: string
  usedModel: string
  fallbackUsed: boolean
  fallbackReason?: string | null
  status: 'success' | 'error' | 'timeout'
  errorMessage?: string | null
  latencyMs?: number | null
  inputTokens?: number | null
  outputTokens?: number | null
  promptVersion?: string | null
  /** C9: where the API key came from. Audited so customers can prove
   *  their BYOK key was actually used for billing/compliance reasons. */
  keySource?: 'byok' | 'env' | null
  /** Langfuse trace UUID, when observability is configured. Persisted so the
   *  admin UI can deep-link straight to the trace + cost + token breakdown
   *  without having to search Langfuse by metadata. */
  langfuseTraceId?: string | null
  /** LLM-3 (audit 2026-04-21): Anthropic prompt-caching tokens. `cache_creation`
   *  is billed at 1.25x regular input; `cache_read` is billed at 0.1x. Stage 2
   *  caches the ~1.2k-token system prompt, so on the 2nd+ call per day we
   *  should see cache_read_input_tokens >> input_tokens with dramatically
   *  lower cost. Tracking both lets the Billing rollup prove the cache is
   *  actually saving money (audit measured per-report cost at ~10x whitepaper
   *  claim; this plus the judge-model fix closes the gap). */
  cacheCreationInputTokens?: number | null
  cacheReadInputTokens?: number | null
}

export function logLlmInvocation(
  db: SupabaseClient,
  rec: LlmInvocationRecord,
): Promise<void> {
  // LLM-4 (audit 2026-04-21): Langfuse trace coverage measured 65% —
  // digest / modernizer / auto-tune stages weren't passing langfuseTraceId
  // through. Emit a single warn when Langfuse is configured in this isolate
  // but the caller didn't supply a trace id. Throttled visibility via the
  // log-child; we can't hard-fail without losing the cost data for ops
  // stages that legitimately pre-date Langfuse.
  if (!rec.langfuseTraceId && Deno.env.get('LANGFUSE_PUBLIC_KEY')) {
    log.warn('LLM invocation missing langfuse_trace_id — trace linkage degrades to 0 for this call', {
      functionName: rec.functionName,
      stage: rec.stage ?? null,
    })
  }
  // Compute cost at write time using the centralized pricing table so Health,
  // Billing COGS, and Prompt Lab all read the same number from one column.
  // See `_shared/pricing.ts` and migration `20260420000200_llm_cost_usd.sql`
  //— both must mirror to keep historical and live data aligned.
  const costUsd = estimateCallCostUsd(
    rec.usedModel,
    rec.inputTokens ?? 0,
    rec.outputTokens ?? 0,
  )
  return db.from('llm_invocations').insert({
    project_id: rec.projectId ?? null,
    report_id: rec.reportId ?? null,
    function_name: rec.functionName,
    stage: rec.stage ?? null,
    primary_model: rec.primaryModel,
    used_model: rec.usedModel,
    fallback_used: rec.fallbackUsed,
    fallback_reason: rec.fallbackReason ?? null,
    status: rec.status,
    error_message: rec.errorMessage ?? null,
    latency_ms: rec.latencyMs ?? null,
    input_tokens: rec.inputTokens ?? null,
    output_tokens: rec.outputTokens ?? null,
    cost_usd: costUsd,
    prompt_version: rec.promptVersion ?? null,
    key_source: rec.keySource ?? null,
    langfuse_trace_id: rec.langfuseTraceId ?? null,
    cache_creation_input_tokens: rec.cacheCreationInputTokens ?? null,
    cache_read_input_tokens: rec.cacheReadInputTokens ?? null,
  }).then(({ error }) => {
    if (error) log.warn('llm_invocations insert failed', { error: error.message })
  }).catch((err) => {
    // Network / JSON-parse / abort failures rejecting the insert promise
    // itself (distinct from a PostgREST `{ error }` payload). Callers commonly
    // invoke this as `void logLlmInvocation(...)` on the hot request path, so
    // an unhandled rejection here would crash the isolate on Deploy. Swallow
    // + log so telemetry is strictly best-effort.
    log.warn('llm_invocations insert threw', {
      error: err instanceof Error ? err.message : String(err),
    })
  })
}

// -----------------------------------------------------------------------------
// Cron runs — wrap a job body so that telemetry is always written, even on throw
// -----------------------------------------------------------------------------

export interface CronRunHandle {
  finish: (result: { rowsAffected?: number; metadata?: Record<string, unknown> }) => Promise<void>
  fail: (error: unknown) => Promise<void>
}

export async function startCronRun(
  db: SupabaseClient,
  jobName: string,
  trigger: 'cron' | 'manual' | 'http' = 'http',
): Promise<CronRunHandle> {
  const startedAt = new Date()
  const { data, error } = await db
    .from('cron_runs')
    .insert({ job_name: jobName, trigger, status: 'running', started_at: startedAt.toISOString() })
    .select('id')
    .single()

  if (error) {
    log.warn('cron_runs insert failed', { jobName, error: error.message })
  }

  const runId = data?.id as string | undefined

  return {
    async finish({ rowsAffected, metadata }) {
      if (!runId) return
      const finishedAt = new Date()
      await db.from('cron_runs').update({
        finished_at: finishedAt.toISOString(),
        duration_ms: finishedAt.getTime() - startedAt.getTime(),
        status: 'success',
        rows_affected: rowsAffected ?? null,
        metadata: metadata ?? {},
      }).eq('id', runId)
    },
    async fail(err) {
      if (!runId) return
      const finishedAt = new Date()
      await db.from('cron_runs').update({
        finished_at: finishedAt.toISOString(),
        duration_ms: finishedAt.getTime() - startedAt.getTime(),
        status: 'error',
        error_message: err instanceof Error ? err.message : String(err),
      }).eq('id', runId)
    },
  }
}

// -----------------------------------------------------------------------------
// Anti-gaming audit events — written every time a flag/unflag decision is made
// -----------------------------------------------------------------------------

export interface AntiGamingEventRecord {
  projectId: string
  reporterTokenHash: string
  deviceFingerprint?: string | null
  ipAddress?: string | null
  userAgent?: string | null
  eventType: 'multi_account' | 'velocity_anomaly' | 'manual_flag' | 'unflag'
  reason?: string | null
  metadata?: Record<string, unknown>
}

export function logAntiGamingEvent(
  db: SupabaseClient,
  rec: AntiGamingEventRecord,
): Promise<void> {
  return db.from('anti_gaming_events').insert({
    project_id: rec.projectId,
    reporter_token_hash: rec.reporterTokenHash,
    device_fingerprint: rec.deviceFingerprint ?? null,
    ip_address: rec.ipAddress ?? null,
    user_agent: rec.userAgent ?? null,
    event_type: rec.eventType,
    reason: rec.reason ?? null,
    metadata: rec.metadata ?? {},
  }).then(({ error }) => {
    if (error) log.warn('anti_gaming_events insert failed', { error: error.message })
  })
}
