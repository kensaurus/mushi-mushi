/**
 * FILE: packages/server/supabase/functions/_shared/llm-usage.ts
 * PURPOSE: One call that turns a finished (or failed) model call into an
 *          `llm_invocations` row, so every paid LLM and embedding call shows
 *          on the console's cost pages and counts toward the monthly budget.
 *
 * Before 2026-10-04 judge-batch, generate-synthetic, mistake-*, pdca-runner,
 * release-builder, test-gen-*, inventory-propose, story-mapper,
 * library-modernizer, prompt-auto-tune, nl-query, the classify-report vision
 * call and every embedding wrote no row: their spend was invisible on Costs,
 * outside the budget, and (on the platform key) never debited.
 *
 * Billing: `logLlmInvocation` is the single hosted-wallet debit path for a
 * call that writes a row. A caller of this helper must NOT also pass `meter`
 * to `withLlmFailover`, or the call is charged twice.
 *
 * Never throws and never blocks: callers use `void recordLlmUsage(...)`.
 * The returned promise resolves `{ error }` for the rare caller that must
 * fail its run when the spend cannot be recorded.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { extractAnthropicCacheUsage, logLlmInvocation, type LlmInvocationRecord } from './telemetry.ts'
import { sanitizeLlmError } from './llm-error-sanitize.ts'
import { LLM_PRICING_PER_M_TOKENS } from './pricing.ts'

export interface LlmTokenUsage {
  inputTokens: number | null
  outputTokens: number | null
}

function count(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null
}

function firstCount(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const n = count(obj[k])
    if (n !== null) return n
  }
  return null
}

/**
 * Token counts from anything a model call hands back: an AI SDK result
 * (`result.usage`), a usage object itself, an error that carries `usage`
 * (`NoObjectGeneratedError` does — those tokens were spent), or a raw
 * OpenAI-style body (`usage.prompt_tokens`). Reads the AI SDK v5 names
 * (`inputTokens`/`outputTokens`), the v4 names (`promptTokens`/
 * `completionTokens`), and the snake_case wire names.
 */
export function extractLlmUsage(source: unknown): LlmTokenUsage {
  const none: LlmTokenUsage = { inputTokens: null, outputTokens: null }
  try {
    if (!source || typeof source !== 'object') return none
    const outer = source as Record<string, unknown>
    const inner = outer.usage && typeof outer.usage === 'object'
      ? (outer.usage as Record<string, unknown>)
      : outer
    return {
      inputTokens: firstCount(inner, ['inputTokens', 'promptTokens', 'input_tokens', 'prompt_tokens', 'total_tokens']),
      outputTokens: firstCount(inner, ['outputTokens', 'completionTokens', 'output_tokens', 'completion_tokens']),
    }
  } catch {
    return none
  }
}

function isPriced(model: string): boolean {
  const key = model.toLowerCase()
  const bare = key.includes('/') ? key.split('/').slice(-1)[0] : key
  return Object.prototype.hasOwnProperty.call(LLM_PRICING_PER_M_TOKENS, bare)
}

/**
 * The model that actually served the call (`response.modelId`, e.g. Claude's
 * server-side refusal fallback `claude-sonnet-5`), else `fallback`. A served
 * id the price table does not know (OpenAI's dated `gpt-4.1-2025-04-14`) is
 * ignored: it would be costed at the unknown-model fallback rate.
 */
export function servedModel(result: unknown, fallback: string): string {
  try {
    const id = (result as { response?: { modelId?: unknown } } | null)?.response?.modelId
    return typeof id === 'string' && id.trim() && isPriced(id) ? id : fallback
  } catch {
    return fallback
  }
}

function isTimeout(err: unknown): boolean {
  const name = (err as { name?: unknown } | null)?.name
  if (name === 'AbortError' || name === 'TimeoutError') return true
  const msg = String(err).toLowerCase()
  return msg.includes('timed out') || msg.includes('timeout')
}

export interface LlmUsageContext {
  functionName: string
  stage?: string | null
  projectId?: string | null
  reportId?: string | null
  /** The model the call asked for. */
  model: string
  /** The model the function tried first, when `model` is a fallback. Defaults to `model`. */
  primaryModel?: string
  /** From the key resolution the call site already did (`resolveLlmKey` / `ResolvedKey.source`). */
  keySource?: 'byok' | 'env' | null
  /** `Date.now()` taken just before the call; gives `latency_ms`. */
  startedAt?: number
  fallbackUsed?: boolean
  fallbackReason?: string | null
  promptVersion?: string | null
  langfuseTraceId?: string | null
  /**
   * Debit the hosted wallet for this call (platform key only). Off by default:
   * recording a call's cost must not start billing for it. Only paths that
   * were already billed before 2026-10-04 opt in (inventory-propose and
   * story-mapper, which used the withLlmFailover meter); billing any other
   * path is an owner pricing decision.
   */
  billHosted?: boolean
  /** Kept for callers that say it explicitly; billing is already off by default. */
  skipHostedBilling?: boolean
}

export interface LlmUsageOutcome {
  /** The provider result (AI SDK result, claude-messages result, or raw body). */
  result?: unknown
  /** Set when the call failed; the row is written with status 'error'/'timeout'. */
  error?: unknown
  /** Explicit token counts; win over anything read from `result` / `error`. */
  usage?: Partial<LlmTokenUsage> | null
}

/** Build the row without writing it. Pure; exported for tests. */
export function buildLlmUsageRecord(ctx: LlmUsageContext, outcome: LlmUsageOutcome): LlmInvocationRecord {
  const failed = outcome.error !== undefined && outcome.error !== null
  const fromResult = extractLlmUsage(failed ? outcome.error : outcome.result)
  const inputTokens = count(outcome.usage?.inputTokens) ?? fromResult.inputTokens
  const outputTokens = count(outcome.usage?.outputTokens) ?? fromResult.outputTokens
  const resultObj = (outcome.result ?? null) as {
    experimental_providerMetadata?: unknown
    providerMetadata?: unknown
  } | null
  const cache = extractAnthropicCacheUsage(
    resultObj?.experimental_providerMetadata ?? resultObj?.providerMetadata,
  )
  const primaryModel = ctx.primaryModel ?? ctx.model
  const fallbackUsed = ctx.fallbackUsed ?? primaryModel !== ctx.model
  return {
    projectId: ctx.projectId ?? null,
    reportId: ctx.reportId ?? null,
    functionName: ctx.functionName,
    stage: ctx.stage ?? null,
    primaryModel,
    usedModel: failed ? ctx.model : servedModel(outcome.result, ctx.model),
    fallbackUsed,
    fallbackReason: ctx.fallbackReason ?? null,
    status: failed ? (isTimeout(outcome.error) ? 'timeout' : 'error') : 'success',
    errorMessage: failed ? sanitizeLlmError(outcome.error instanceof Error ? outcome.error.message : outcome.error).slice(0, 500) : null,
    latencyMs: typeof ctx.startedAt === 'number' ? Math.max(0, Date.now() - ctx.startedAt) : null,
    inputTokens,
    outputTokens,
    promptVersion: ctx.promptVersion ?? null,
    keySource: ctx.keySource ?? null,
    langfuseTraceId: ctx.langfuseTraceId ?? null,
    cacheCreationInputTokens: cache.cacheCreationInputTokens,
    cacheReadInputTokens: cache.cacheReadInputTokens,
    skipHostedBilling: ctx.skipHostedBilling === true || ctx.billHosted !== true,
  }
}

/**
 * Run one provider call and record it: a success row with the result's
 * tokens, or an error row (with any tokens the error carries) before the
 * error is rethrown unchanged — so `withLlmFailover`'s classification and
 * `instanceof` checks still see the original. Use inside a failover
 * callback, where the resolved key's `source` is known.
 */
export async function withLlmUsage<T>(
  db: SupabaseClient | null | undefined,
  ctx: LlmUsageContext,
  call: () => Promise<T>,
): Promise<T> {
  const timed = { ...ctx, startedAt: ctx.startedAt ?? Date.now() }
  let result: T
  try {
    result = await call()
  } catch (err) {
    void recordLlmUsage(db, timed, { error: err })
    throw err
  }
  void recordLlmUsage(db, timed, { result })
  return result
}

/**
 * Record one model call. Fire-and-forget: never throws, never rejects.
 * A null `db` (no service client available) is a no-op.
 */
export function recordLlmUsage(
  db: SupabaseClient | null | undefined,
  ctx: LlmUsageContext,
  outcome: LlmUsageOutcome = {},
): Promise<{ error: string | null }> {
  if (!db) return Promise.resolve({ error: 'no database client' })
  try {
    const rec = buildLlmUsageRecord(ctx, outcome)
    return logLlmInvocation(db, rec).then(
      (r) => r ?? { error: null },
      (err: unknown) => ({ error: String(err) }),
    )
  } catch (err) {
    // logLlmInvocation reads Deno.env synchronously; outside Deno (or on any
    // other synchronous failure) the row is lost but the caller is not.
    return Promise.resolve({ error: err instanceof Error ? err.message : String(err) })
  }
}
