// =============================================================================
// Telemetry helpers — write structured events to llm_invocations, cron_runs,
// and anti_gaming_events. All writes are best-effort and never throw, so
// instrumentation can never break the request path it's instrumenting.
// =============================================================================

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { log as rootLog } from './logger.ts'
import { estimateCallCostUsd } from './pricing.ts'
import { otlpSpan, setGenAiAttributes, type GenAiProvider } from './otlp-exporter.ts'

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
  /**
   * Optional W3C traceparent from the caller's inbound span. When set,
   * `logLlmInvocation` automatically emits a child OTLP/GenAI span using
   * the OpenTelemetry GenAI semantic conventions so every LLM call is
   * visible in the user's APM without requiring callers to manually
   * import `otlpSpan` + `setGenAiAttributes` individually.
   */
  otlpTraceparent?: string | null
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

  // P2: Emit OTLP/GenAI span on every LLM invocation so users see model usage
  // in their APM without per-call boilerplate. Uses the caller's traceparent
  // when available (creates a child span); falls back to a new root span.
  // Fire-and-forget — OTLP is best-effort and must never block the DB write.
  if (Deno.env.get('OTEL_EXPORTER_OTLP_ENDPOINT')) {
    const provider: GenAiProvider = rec.usedModel.toLowerCase().startsWith('claude-')
      ? 'anthropic'
      : rec.usedModel.toLowerCase().startsWith('gpt-')
      ? 'openai'
      : 'unknown'
    const span = otlpSpan(
      `gen_ai.${rec.stage ?? rec.functionName ?? 'llm'}.invoke`,
      rec.otlpTraceparent ?? null,
      {
        'gen_ai.system': provider,
        'mushi.function': rec.functionName,
        ...(rec.stage ? { 'mushi.stage': rec.stage } : {}),
        ...(rec.projectId ? { 'mushi.project_id': rec.projectId } : {}),
        ...(rec.reportId ? { 'mushi.report_id': rec.reportId } : {}),
      },
    )
    setGenAiAttributes(span, {
      operationName: 'chat',
      provider,
      requestModel: rec.primaryModel,
      responseModel: rec.usedModel !== rec.primaryModel ? rec.usedModel : undefined,
      inputTokens: rec.inputTokens,
      outputTokens: rec.outputTokens,
      cacheReadInputTokens: rec.cacheReadInputTokens,
      cacheCreationInputTokens: rec.cacheCreationInputTokens,
      costUsd,
    })
    span.setStatus(rec.status === 'success' ? 'ok' : 'error', rec.errorMessage ?? undefined)
    span.end().catch(() => {}) // non-fatal
  }

  // Wrap in Promise.resolve() so the Supabase PromiseLike<T> chain becomes a
  // real Promise and `.catch()` / `.finally()` are available. Without this,
  // TypeScript sees a PromiseLike<void> from the .then() return type and
  // rejects the subsequent .catch() call (TS2339).
  return Promise.resolve(
    db.from('llm_invocations').insert({
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
    }),
  ).then(({ error }) => {
    if (error) log.warn('llm_invocations insert failed', { error: error.message })
  }).catch((err: unknown) => {
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

/**
 * Produce a useful one-line string from any value passed to `cron.fail(err)`.
 *
 * Previous behaviour was `err instanceof Error ? err.message : String(err)`,
 * which for PostgREST-style errors (`{ message, code, details, hint }` plain
 * objects, not Error instances) collapsed to the useless string
 * `"[object Object]"` — exactly what surfaced in `public.cron_runs` for
 * `qa-story-runner`'s qa_stories query, making the real failure invisible.
 *
 * Order of preference, conservative on PII:
 *   1. Real Error instance → `.message`.
 *   2. PostgREST-shaped object (`{ message, code, details, hint }`) →
 *      flatten to `"<message> (code: X, hint: Y)"`.
 *   3. Plain object with a `.message` string → that message.
 *   4. Object without `.message` → `JSON.stringify(err)` capped at 1 KiB so
 *      runaway payloads can't fill `cron_runs.error_message`.
 *   5. Primitives → `String(err)`.
 *
 * Exported so other cron functions can call it directly when they want to
 * embed a structured error into their own telemetry without re-implementing
 * the truncation/PII rules.
 */
export function stringifyCronError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err === null || err === undefined) return String(err)
  if (typeof err !== 'object') return String(err)

  const e = err as { message?: unknown; code?: unknown; hint?: unknown; details?: unknown }
  if (typeof e.message === 'string' && e.message.length > 0) {
    const parts: string[] = [e.message]
    const meta: string[] = []
    if (typeof e.code === 'string' && e.code.length > 0) meta.push(`code: ${e.code}`)
    if (typeof e.hint === 'string' && e.hint.length > 0) meta.push(`hint: ${e.hint}`)
    if (typeof e.details === 'string' && e.details.length > 0) meta.push(`details: ${e.details}`)
    if (meta.length > 0) parts.push(`(${meta.join(', ')})`)
    return parts.join(' ').slice(0, 1024)
  }

  try {
    return JSON.stringify(err).slice(0, 1024)
  } catch {
    return '[unserializable error]'
  }
}

export async function startCronRun(
  db: SupabaseClient,
  jobName: string,
  trigger: 'cron' | 'manual' | 'http' = 'http',
): Promise<CronRunHandle> {
  const startedAt = new Date()

  // Defensive: caught Sentry MUSHI-MUSHI-SERVER-5 (regressed) where
  // qa-story-runner called `startCronRun('qa-story-runner')` — i.e.
  // forgot to pass `db` first. The literal string then flowed into
  // `db.from(...)` and crashed the whole request with
  // `TypeError: db.from is not a function`. The TS signature catches it
  // at the IDE but the cron function ships compiled JS and the bad
  // call slipped past review. Telemetry must never break the function
  // it's instrumenting — return a no-op handle on misuse, log loudly so
  // the mistake surfaces in observability without taking down the job.
  if (!db || typeof (db as { from?: unknown }).from !== 'function') {
    log.warn('startCronRun called without a Supabase client; cron telemetry disabled for this run', {
      jobName,
      trigger,
      receivedType: typeof db,
    })
    return {
      finish: async () => {},
      fail: async () => {},
    }
  }

  let runId: string | undefined
  try {
    const { data, error } = await db
      .from('cron_runs')
      .insert({ job_name: jobName, trigger, status: 'running', started_at: startedAt.toISOString() })
      .select('id')
      .single()

    if (error) {
      log.warn('cron_runs insert failed', { jobName, error: error.message })
    }

    runId = data?.id as string | undefined
  } catch (err) {
    // Network / abort / schema-cache misses can reject the promise; we
    // must not propagate so the job body still runs.
    log.warn('cron_runs insert threw', {
      jobName,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  return {
    async finish({ rowsAffected, metadata }) {
      if (!runId) return
      const finishedAt = new Date()
      try {
        await db.from('cron_runs').update({
          finished_at: finishedAt.toISOString(),
          duration_ms: finishedAt.getTime() - startedAt.getTime(),
          status: 'success',
          rows_affected: rowsAffected ?? null,
          metadata: metadata ?? {},
        }).eq('id', runId)
      } catch (err) {
        log.warn('cron_runs finish update threw', {
          jobName,
          runId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    },
    async fail(err) {
      if (!runId) return
      const finishedAt = new Date()
      try {
        await db.from('cron_runs').update({
          finished_at: finishedAt.toISOString(),
          duration_ms: finishedAt.getTime() - startedAt.getTime(),
          status: 'error',
          error_message: stringifyCronError(err),
        }).eq('id', runId)
      } catch (updateErr) {
        log.warn('cron_runs fail update threw', {
          jobName,
          runId,
          originalError: stringifyCronError(err),
          updateError: updateErr instanceof Error ? updateErr.message : String(updateErr),
        })
      }
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
  return Promise.resolve(
    db.from('anti_gaming_events').insert({
      project_id: rec.projectId,
      reporter_token_hash: rec.reporterTokenHash,
      device_fingerprint: rec.deviceFingerprint ?? null,
      ip_address: rec.ipAddress ?? null,
      user_agent: rec.userAgent ?? null,
      event_type: rec.eventType,
      reason: rec.reason ?? null,
      metadata: rec.metadata ?? {},
    }),
  ).then(({ error }) => {
    if (error) log.warn('anti_gaming_events insert failed', { error: error.message })
  })
}
