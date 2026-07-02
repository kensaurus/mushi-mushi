/**
 * FILE: packages/server/supabase/functions/_shared/llm-failover.ts
 * PURPOSE: Quota-aware LLM key failover helper.
 *
 * `withLlmFailover(db, projectId, provider, fn)` iterates the ordered list
 * of active keys, calls `fn(resolvedKey)`, and on error:
 *   - 429 → marks key as `quota_exhausted` (1-hour cooldown), advances.
 *   - 401/403 → marks key as `auth_failed`, advances.
 *   - Transient (5xx, timeout, ECONNRESET/ETIMEDOUT, "overloaded") → bounded
 *     exponential-backoff+jitter retry on the SAME key first (the key isn't
 *     at fault — retrying a different key of the same provider during a
 *     provider-wide outage wouldn't help either, but a momentary blip often
 *     clears in a second or two); only rotates to the next key once the
 *     retry budget is exhausted, and does NOT mark the key bad (it isn't).
 *   - Other errors (schema violation, validation, etc.) → re-throws
 *     immediately (not key- or transport-related; retrying won't help).
 *   - No keys remain → throws `LlmFailoverError` with code `ALL_KEYS_EXHAUSTED`.
 *
 * Usage:
 *   const result = await withLlmFailover(db, projectId, 'anthropic', async (key) => {
 *     const anthropic = createAnthropic({ apiKey: key.key })
 *     return generateObject({ model: anthropic('claude-sonnet-4-6'), … })
 *   })
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { NoObjectGeneratedError } from 'npm:ai@4'
import { resolveLlmKeys, markKeyStatus, type ResolvedKey, type LlmProvider } from './byok.ts'
import { log as rootLog } from './logger.ts'

const log = rootLog.child('llm-failover')

export class LlmFailoverError extends Error {
  code: 'ALL_KEYS_EXHAUSTED' | 'NO_KEYS_CONFIGURED'
  provider: LlmProvider
  attempts: number
  lastError: string

  constructor(opts: {
    code: 'ALL_KEYS_EXHAUSTED' | 'NO_KEYS_CONFIGURED'
    provider: LlmProvider
    attempts: number
    lastError: string
  }) {
    super(`LLM failover: ${opts.code} for provider ${opts.provider} after ${opts.attempts} attempt(s). Last error: ${opts.lastError}`)
    this.name = 'LlmFailoverError'
    this.code = opts.code
    this.provider = opts.provider
    this.attempts = opts.attempts
    this.lastError = opts.lastError
  }
}

/**
 * Classify an error thrown from an LLM SDK call into a key-failure category.
 * Exported for direct unit testing (see llm-failover.test.ts) — the rest of
 * this module depends on Supabase + BYOK key resolution, but classification
 * and the transient-retry decision are pure and worth testing in isolation.
 */
export function classifyLlmError(err: unknown): 'quota' | 'auth' | 'transient' | 'other' {
  const msg = String(err).toLowerCase()

  // HTTP status codes in the error message (Vercel AI SDK wraps them)
  if (msg.includes('429') || msg.includes('rate limit') || msg.includes('quota')) {
    return 'quota'
  }
  if (msg.includes('401') || msg.includes('403') || msg.includes('unauthorized') || msg.includes('invalid api key')) {
    return 'auth'
  }

  // Check for structured error objects from the AI SDK. Type the access
  // explicitly — `Record<string, unknown>` makes `errObj.response` `unknown`,
  // and reading `.status` off that fails Deno's stricter type check.
  const errObj = err as { status?: number; statusCode?: number; response?: { status?: number }; code?: string }
  const statusCode = errObj?.status ?? errObj?.statusCode ?? errObj?.response?.status
  if (statusCode === 429) return 'quota'
  if (statusCode === 401 || statusCode === 403) return 'auth'
  if (statusCode !== undefined && statusCode >= 500 && statusCode < 600) return 'transient'

  // Transient transport/provider-outage signals: connection resets, DNS
  // hiccups, timeouts, and Anthropic/OpenAI's own "overloaded" 529-shaped
  // errors (some SDK versions surface this as a string, not a status code).
  const code = String(errObj?.code ?? '').toLowerCase()
  if (
    code === 'econnreset' ||
    code === 'etimedout' ||
    code === 'econnrefused' ||
    code === 'enotfound' ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('econnrefused') ||
    msg.includes('enotfound') ||
    msg.includes('fetch failed') ||
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    msg.includes('socket hang up') ||
    msg.includes('overloaded') ||
    msg.includes('service unavailable') ||
    msg.includes('bad gateway') ||
    msg.includes('gateway timeout') ||
    msg.includes(' 500') ||
    msg.includes(' 502') ||
    msg.includes(' 503') ||
    msg.includes(' 504')
  ) {
    return 'transient'
  }

  return 'other'
}

function readEnvNumber(name: string, fallback: number): number {
  const raw = Deno.env.get(name)
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

/**
 * Max same-key retries for a transient error before rotating to the next
 * candidate. 2 retries with exponential backoff (~400ms, ~800ms) is enough
 * to ride out a momentary blip without stalling a synchronous edge-function
 * request for too long. Override via MUSHI_LLM_TRANSIENT_MAX_RETRIES.
 */
const LLM_TRANSIENT_MAX_RETRIES = readEnvNumber('MUSHI_LLM_TRANSIENT_MAX_RETRIES', 2)
const LLM_TRANSIENT_BASE_BACKOFF_MS = readEnvNumber('MUSHI_LLM_TRANSIENT_BASE_BACKOFF_MS', 400)

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function computeTransientRetryDelay(attempt: number): number {
  const base = LLM_TRANSIENT_BASE_BACKOFF_MS * Math.pow(2, attempt)
  const jitter = base * 0.2 * (Math.random() * 2 - 1)
  return Math.min(Math.max(base + jitter, 100), 10_000)
}

type CandidateOutcome<T> =
  | { ok: true; result: T }
  // 'transient_exhausted' is deliberately distinct from 'quota'/'auth': the
  // key itself isn't at fault, so the caller must NOT call markKeyStatus —
  // it just rotates to the next candidate (or exhausts) like the others do.
  // 'fatal' carries the original error object (not just its message) so
  // callers like `withAnthropicOrOpenAi` can still `instanceof`-check it
  // (e.g. `NoObjectGeneratedError.isInstance`) after it round-trips through
  // this helper.
  | { ok: false; kind: 'quota' | 'auth' | 'transient_exhausted'; lastError: string }
  | { ok: false; kind: 'fatal'; lastError: string; error: unknown }

/**
 * Call `fn(candidate)`, transparently retrying transient errors on the same
 * key with backoff before surfacing an outcome for the caller's key-rotation
 * logic. Exported for direct unit testing (see llm-failover.test.ts).
 */
export async function callWithTransientRetry<T>(
  fn: (key: ResolvedKey) => Promise<T>,
  candidate: ResolvedKey,
  provider: LlmProvider,
): Promise<CandidateOutcome<T>> {
  let transientAttempt = 0
  for (;;) {
    try {
      const result = await fn(candidate)
      return { ok: true, result }
    } catch (err) {
      const lastError = String(err).slice(0, 500)
      const kind = classifyLlmError(err)

      if (kind === 'transient') {
        if (transientAttempt < LLM_TRANSIENT_MAX_RETRIES) {
          const delay = computeTransientRetryDelay(transientAttempt)
          transientAttempt++
          log.warn('Transient LLM error — retrying same key before rotating', {
            provider,
            hint: candidate.hint,
            keyId: candidate.keyId,
            attempt: transientAttempt,
            maxAttempts: LLM_TRANSIENT_MAX_RETRIES,
            delayMs: Math.round(delay),
            err: lastError,
          })
          await sleep(delay)
          continue
        }
        return {
          ok: false,
          kind: 'transient_exhausted',
          lastError: `${lastError} (after ${transientAttempt} transient retries on this key)`,
        }
      }

      if (kind === 'quota' || kind === 'auth') {
        return { ok: false, kind, lastError }
      }

      return { ok: false, kind: 'fatal', lastError, error: err }
    }
  }
}

/**
 * Run `fn` with automatic key-failover. `fn` receives one `ResolvedKey` at a
 * time. On quota/auth failure the key is marked and the next candidate is tried.
 */
export async function withLlmFailover<T>(
  db: SupabaseClient,
  projectId: string,
  provider: LlmProvider,
  fn: (key: ResolvedKey) => Promise<T>,
): Promise<T> {
  const candidates = await resolveLlmKeys(db, projectId, provider)

  if (candidates.length === 0) {
    throw new LlmFailoverError({
      code: 'NO_KEYS_CONFIGURED',
      provider,
      attempts: 0,
      lastError: `No ${provider} key configured. Add one in Settings → API Keys.`,
    })
  }

  let lastError = ''
  let attempts = 0

  for (const candidate of candidates) {
    attempts++
    const outcome = await callWithTransientRetry(fn, candidate, provider)

    if (outcome.ok) return outcome.result
    lastError = outcome.lastError

    switch (outcome.kind) {
      case 'quota':
        log.warn('LLM key quota exhausted; trying next', {
          provider,
          hint: candidate.hint,
          keyId: candidate.keyId,
        })
        if (candidate.keyId) {
          await markKeyStatus(db, candidate.keyId, 'quota_exhausted', lastError)
        }
        continue

      case 'auth':
        log.warn('LLM key auth failed; trying next', {
          provider,
          hint: candidate.hint,
          keyId: candidate.keyId,
        })
        if (candidate.keyId) {
          await markKeyStatus(db, candidate.keyId, 'auth_failed', lastError)
        }
        continue

      case 'transient_exhausted':
        // Not a key problem — don't mark the key bad, just rotate to the
        // next candidate (if any). If this was the last candidate,
        // ALL_KEYS_EXHAUSTED below still fires with a clear message.
        log.warn('LLM call still failing after transient retries; rotating key', {
          provider,
          hint: candidate.hint,
          keyId: candidate.keyId,
        })
        continue

      case 'fatal':
        // Non-key, non-transient error (schema violation, validation, etc.)
        // — re-throw the original error immediately rather than burning the
        // rest of the pool. Re-throwing `outcome.error` (not a wrapped
        // Error) preserves `instanceof` checks callers rely on downstream.
        throw outcome.error
    }
  }

  throw new LlmFailoverError({
    code: 'ALL_KEYS_EXHAUSTED',
    provider,
    attempts,
    lastError,
  })
}

/**
 * Convenience wrapper that tries Anthropic first, then OpenAI.
 * Returns the result plus which provider was used.
 */
export async function withAnthropicOrOpenAi<T>(
  db: SupabaseClient,
  projectId: string,
  anthropicFn: (key: ResolvedKey) => Promise<T>,
  openAiFn: (key: ResolvedKey) => Promise<T>,
): Promise<{ result: T; usedProvider: 'anthropic' | 'openai' }> {
  // Try Anthropic pool first
  try {
    const result = await withLlmFailover(db, projectId, 'anthropic', anthropicFn)
    return { result, usedProvider: 'anthropic' }
  } catch (err) {
    if (err instanceof LlmFailoverError && (err.code === 'NO_KEYS_CONFIGURED' || err.code === 'ALL_KEYS_EXHAUSTED')) {
      // No Anthropic keys available — fall through to OpenAI.
      log.warn('Anthropic exhausted, trying OpenAI', { projectId, reason: err.code })
    } else if (NoObjectGeneratedError.isInstance(err)) {
      // Anthropic responded but its output didn't match the required schema.
      // OpenAI often handles complex structured-output schemas more reliably —
      // try it as a fallback before giving up.
      log.warn('Anthropic NoObjectGeneratedError; falling back to OpenAI', { projectId })
    } else {
      throw err
    }
  }

  // Try OpenAI pool
  const result = await withLlmFailover(db, projectId, 'openai', openAiFn)
  return { result, usedProvider: 'openai' }
}
