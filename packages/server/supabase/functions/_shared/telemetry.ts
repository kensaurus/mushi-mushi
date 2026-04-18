// =============================================================================
// Telemetry helpers — write structured events to llm_invocations, cron_runs,
// and anti_gaming_events. All writes are best-effort and never throw, so
// instrumentation can never break the request path it's instrumenting.
// =============================================================================

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { log as rootLog } from './logger.ts'

const log = rootLog.child('telemetry')

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
  /** Wave C C9: where the API key came from. Audited so customers can prove
   *  their BYOK key was actually used for billing/compliance reasons. */
  keySource?: 'byok' | 'env' | null
  /** Langfuse trace UUID, when observability is configured. Persisted so the
   *  admin UI can deep-link straight to the trace + cost + token breakdown
   *  without having to search Langfuse by metadata. */
  langfuseTraceId?: string | null
}

export function logLlmInvocation(
  db: SupabaseClient,
  rec: LlmInvocationRecord,
): Promise<void> {
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
    prompt_version: rec.promptVersion ?? null,
    key_source: rec.keySource ?? null,
    langfuse_trace_id: rec.langfuseTraceId ?? null,
  }).then(({ error }) => {
    if (error) log.warn('llm_invocations insert failed', { error: error.message })
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
