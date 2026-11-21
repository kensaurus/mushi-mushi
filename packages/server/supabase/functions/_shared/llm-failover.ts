/**
 * FILE: packages/server/supabase/functions/_shared/llm-failover.ts
 * PURPOSE: Quota-aware LLM key failover helper.
 *
 * `withLlmFailover(db, projectId, provider, fn)` iterates the ordered list
 * of active keys, calls `fn(resolvedKey)`, and on error:
 *   - 429 → marks key as `quota_exhausted` (1-hour cooldown), advances.
 *   - Spent credit ('payment': Anthropic's 400 "credit balance is too low",
 *     402, OpenAI insufficient_quota) → same cooldown, advances.
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
 *     return claudeGenerateObject({ apiKey: key.key, model: STAGE2_MODEL, … })
 *   })
 */

import { isQuotaMessage } from './llm-quota.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { isClaudeRefusal } from './claude-request.ts';
import {
  enforceLlmBudget,
  resolveLlmKeys,
  markKeyStatus,
  markKeyUsed,
  type ResolvedKey,
  type LlmProvider,
} from './byok.ts';
import { log as rootLog } from './logger.ts';
import {
  hostedLlmPreflight,
  providerFromModel,
  scheduleHostedLlmCharge,
  WalletDeniedError,
} from './hosted-llm-billing.ts';
import { LlmBudgetExceededError } from './llm-budget.ts';
import { sanitizeLlmError } from './llm-error-sanitize.ts';
import {
  AnthropicLowCreditDrillError,
  anthropicNoCreditDrill,
  hostedClaudeAllowed,
  hostedClaudeFirst,
} from './hosted-llm-order.ts';

const log = rootLog.child('llm-failover');

// Re-exported so call sites that must let a wallet refusal escape their retry
// loop can `instanceof`-check it without importing the billing module.
export { WalletDeniedError };
export { LlmBudgetExceededError };

// Lives in its own Deno-free module so `llm-usage.ts` can use it from vitest.
export { sanitizeLlmError };

export class LlmFailoverError extends Error {
  code: 'ALL_KEYS_EXHAUSTED' | 'NO_KEYS_CONFIGURED';
  provider: LlmProvider;
  attempts: number;
  lastError: string;

  constructor(opts: {
    code: 'ALL_KEYS_EXHAUSTED' | 'NO_KEYS_CONFIGURED';
    provider: LlmProvider;
    attempts: number;
    lastError: string;
  }) {
    const lastError = sanitizeLlmError(opts.lastError);
    super(
      `LLM failover: ${opts.code} for provider ${opts.provider} after ${opts.attempts} attempt(s). Last error: ${lastError}`,
    );
    this.name = 'LlmFailoverError';
    this.code = opts.code;
    this.provider = opts.provider;
    this.attempts = opts.attempts;
    this.lastError = lastError;
  }
}

/**
 * True when Stage 1 should degrade to heuristic classification instead of
 * crashing. Covers exhausted/missing provider pools, hosted-wallet denial,
 * and raw 401/403 that escaped failover (MUSHI-MUSHI-SERVER-19).
 */
export function isStage1LlmUnavailable(err: unknown): boolean {
  if (err instanceof WalletDeniedError) return true;
  // Over budget: Stage 1 falls back to heuristic triage instead of going dark.
  if (err instanceof LlmBudgetExceededError) return true;
  if (err instanceof LlmFailoverError) return true;
  return classifyLlmError(err) === 'auth';
}

/**
 * Classify an error thrown from an LLM SDK call into a key-failure category.
 * Exported for direct unit testing (see llm-failover.test.ts) — the rest of
 * this module depends on Supabase + BYOK key resolution, but classification
 * and the transient-retry decision are pure and worth testing in isolation.
 */
export function classifyLlmError(err: unknown): 'payment' | 'quota' | 'auth' | 'transient' | 'other' {
  const msg = String(err).toLowerCase();

  // A spent account, not a busy one: Anthropic's 400 "Your credit balance is
  // too low", OpenRouter's 402 "Insufficient credits", OpenAI's
  // insufficient_quota / billing_hard_limit. No retry on this key helps; the
  // next candidate (another vendor) does.
  if (isPaymentMessage(msg)) return 'payment';
  const errStatus = err as { status?: number; statusCode?: number } | null;
  if ((errStatus?.status ?? errStatus?.statusCode) === 402) return 'payment';

  // HTTP status codes in the error message (Vercel AI SDK wraps them)
  // 429s, rate limits, and a spent Anthropic key (a 400 "usage limits", not a
  // 429; as 'other' it never failed over, MUSHI-MUSHI-SERVER-3C/3D 2026-10-28).
  if (isQuotaMessage(msg)) {
    return 'quota';
  }
  // Anthropic returns "invalid x-api-key" (note the hyphenated header name) —
  // that string does NOT contain the substring "invalid api key", so we match
  // both forms. Also catch authentication_error / permission_error JSON codes.
  if (
    msg.includes('401') ||
    msg.includes('403') ||
    msg.includes('unauthorized') ||
    msg.includes('invalid api key') ||
    msg.includes('invalid x-api-key') ||
    msg.includes('authentication_error') ||
    msg.includes('permission_error') ||
    msg.includes('api key not valid') ||
    msg.includes('incorrect api key')
  ) {
    return 'auth';
  }

  // Check for structured error objects from the AI SDK. Type the access
  // explicitly — `Record<string, unknown>` makes `errObj.response` `unknown`,
  // and reading `.status` off that fails Deno's stricter type check.
  const errObj = err as {
    status?: number;
    statusCode?: number;
    response?: { status?: number };
    code?: string;
  };
  const statusCode = errObj?.status ?? errObj?.statusCode ?? errObj?.response?.status;
  if (statusCode === 429) return 'quota';
  if (statusCode === 401 || statusCode === 403) return 'auth';
  if (statusCode !== undefined && statusCode >= 500 && statusCode < 600) return 'transient';

  // Transient transport/provider-outage signals: connection resets, DNS
  // hiccups, timeouts, and Anthropic/OpenAI's own "overloaded" 529-shaped
  // errors (some SDK versions surface this as a string, not a status code).
  const code = String(errObj?.code ?? '').toLowerCase();
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
    return 'transient';
  }

  return 'other';
}

/** Spent-credit wording from Anthropic, OpenAI and OpenRouter (lower-cased input). */
function isPaymentMessage(msg: string): boolean {
  return (
    msg.includes('credit balance is too low') ||
    msg.includes('insufficient_quota') ||
    msg.includes('exceeded your current quota') ||
    msg.includes('billing_hard_limit') ||
    msg.includes('insufficient credits') ||
    msg.includes('payment required') ||
    /\b402\b/.test(msg)
  );
}

function readEnvNumber(name: string, fallback: number): number {
  const raw = Deno.env.get(name);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Max same-key retries for a transient error before rotating to the next
 * candidate. 2 retries with exponential backoff (~400ms, ~800ms) is enough
 * to ride out a momentary blip without stalling a synchronous edge-function
 * request for too long. Override via MUSHI_LLM_TRANSIENT_MAX_RETRIES.
 */
const LLM_TRANSIENT_MAX_RETRIES = readEnvNumber('MUSHI_LLM_TRANSIENT_MAX_RETRIES', 2);
const LLM_TRANSIENT_BASE_BACKOFF_MS = readEnvNumber('MUSHI_LLM_TRANSIENT_BASE_BACKOFF_MS', 400);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeTransientRetryDelay(attempt: number): number {
  const base = LLM_TRANSIENT_BASE_BACKOFF_MS * Math.pow(2, attempt);
  const jitter = base * 0.2 * (Math.random() * 2 - 1);
  return Math.min(Math.max(base + jitter, 100), 10_000);
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
  | { ok: false; kind: 'payment' | 'quota' | 'auth' | 'transient_exhausted'; lastError: string }
  | { ok: false; kind: 'fatal'; lastError: string; error: unknown };

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
  let transientAttempt = 0;
  for (;;) {
    try {
      const result = await fn(candidate);
      return { ok: true, result };
    } catch (err) {
      const lastError = sanitizeLlmError(err).slice(0, 500);
      const kind = classifyLlmError(err);

      if (kind === 'transient') {
        if (transientAttempt < LLM_TRANSIENT_MAX_RETRIES) {
          const delay = computeTransientRetryDelay(transientAttempt);
          transientAttempt++;
          log.warn('Transient LLM error — retrying same key before rotating', {
            provider,
            hint: candidate.hint,
            keyId: candidate.keyId,
            attempt: transientAttempt,
            maxAttempts: LLM_TRANSIENT_MAX_RETRIES,
            delayMs: Math.round(delay),
            err: lastError,
          });
          await sleep(delay);
          continue;
        }
        return {
          ok: false,
          kind: 'transient_exhausted',
          lastError: `${lastError} (after ${transientAttempt} transient retries on this key)`,
        };
      }

      if (kind === 'payment' || kind === 'quota' || kind === 'auth') {
        return { ok: false, kind, lastError };
      }

      return { ok: false, kind: 'fatal', lastError, error: err };
    }
  }
}

/**
 * Hosted-LLM wallet metering for callers that don't write an
 * `llm_invocations` row. Paths that call `logLlmInvocation` are already
 * debited there and must NOT pass this, or the call is charged twice.
 */
export interface LlmFailoverMeterOptions<T> {
  /** Ledger feature slug — the function/stage that spent the money. */
  feature: string;
  /** Model id as sent to the provider; must have a wallet price row. */
  model: string;
  /** Langfuse trace id, so the ledger row joins back to its generation. */
  traceId?: string | null;
  /** Pull token counts out of `fn`'s result. Return null to skip the debit. */
  extractUsage: (
    result: T,
  ) => { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number } | null;
}

/**
 * Run `fn` with automatic key-failover. `fn` receives one `ResolvedKey` at a
 * time. On quota/auth failure the key is marked and the next candidate is tried.
 *
 * When the resolved credential is the platform key (`source === 'env'`) and
 * hosted-LLM billing is `on`, the project owner's KENSAURUS wallet is checked
 * before any provider money is spent; an insufficient balance throws
 * `WalletDeniedError` (reason + balanceMicro) instead of running the call.
 * BYOK credentials skip the wallet entirely.
 */
export async function withLlmFailover<T>(
  db: SupabaseClient,
  projectId: string,
  provider: LlmProvider,
  fn: (key: ResolvedKey) => Promise<T>,
  meter?: LlmFailoverMeterOptions<T>,
  /**
   * `openAiOnly`: leave OpenRouter keys out (speech-to-text, fine-tuning).
   * `hostedClaude`: include the platform Claude key even when
   * MUSHI_HOSTED_LLM_ORDER puts it after OpenAI (withAnthropicOrOpenAi's last leg).
   */
  opts: { openAiOnly?: boolean; hostedClaude?: boolean } = {},
): Promise<T> {
  await enforceLlmBudget(db, projectId, provider);
  const candidates = await resolveLlmKeys(db, projectId, provider, {
    openAiOnly: opts.openAiOnly,
    hostedClaude: opts.hostedClaude,
  });

  if (candidates.length === 0) {
    throw new LlmFailoverError({
      code: 'NO_KEYS_CONFIGURED',
      provider,
      attempts: 0,
      lastError: `No ${provider} key configured. Add one in Settings → AI keys.`,
    });
  }

  // The env fallback in byok.ts returns only platform keys (OpenAI then
  // OpenRouter for 'openai'), so a hosted call is never mixed with pooled
  // BYOK keys in the same list.
  if (candidates.some((c) => c.source === 'env')) {
    const preflight = await hostedLlmPreflight({ db, projectId });
    if (!preflight.allowed) {
      throw new WalletDeniedError(preflight.reason ?? 'insufficient', preflight.balanceMicro);
    }
  }

  let lastError = '';
  let attempts = 0;

  for (const candidate of candidates) {
    attempts++;
    const outcome = await callWithTransientRetry(drillWrap(fn, candidate, provider), candidate, provider);

    if (outcome.ok) {
      if (candidate.source === 'byok') {
        void markKeyUsed(db, projectId, provider, candidate.keyId).catch(() => {
          /* usage bookkeeping never converts a successful provider call into a failure */
        });
      } else if (meter) {
        // Platform key — kensaurus paid the provider, so debit the owner's
        // wallet. Only for callers that don't write an llm_invocations row;
        // those are metered once in logLlmInvocation instead.
        const usage = meter.extractUsage(outcome.result);
        if (usage) {
          scheduleHostedLlmCharge({
            db,
            projectId,
            feature: meter.feature,
            provider: providerFromModel(meter.model),
            model: meter.model,
            usage,
            traceId: meter.traceId,
            metadata: { key_source: 'env', failover_attempts: attempts },
          });
        }
      }
      return outcome.result;
    }
    lastError = outcome.lastError;

    switch (outcome.kind) {
      case 'payment':
        log.warn('LLM key out of credit; trying next', {
          provider,
          hint: candidate.hint,
          keyId: candidate.keyId,
          source: candidate.source,
        });
        if (candidate.keyId) {
          await markKeyStatus(db, candidate.keyId, 'quota_exhausted', lastError);
        }
        continue;

      case 'quota':
        log.warn('LLM key quota exhausted; trying next', {
          provider,
          hint: candidate.hint,
          keyId: candidate.keyId,
        });
        if (candidate.keyId) {
          await markKeyStatus(db, candidate.keyId, 'quota_exhausted', lastError);
        }
        continue;

      case 'auth':
        log.warn('LLM key auth failed; trying next', {
          provider,
          hint: candidate.hint,
          keyId: candidate.keyId,
        });
        if (candidate.keyId) {
          await markKeyStatus(db, candidate.keyId, 'auth_failed', lastError);
        }
        continue;

      case 'transient_exhausted':
        // Not a key problem — don't mark the key bad, just rotate to the
        // next candidate (if any). If this was the last candidate,
        // ALL_KEYS_EXHAUSTED below still fires with a clear message.
        log.warn('LLM call still failing after transient retries; rotating key', {
          provider,
          hint: candidate.hint,
          keyId: candidate.keyId,
        });
        continue;

      case 'fatal':
        // Non-key, non-transient error (schema violation, validation, etc.)
        // — re-throw the original error immediately rather than burning the
        // rest of the pool. Re-throwing `outcome.error` (not a wrapped
        // Error) preserves `instanceof` checks callers rely on downstream.
        throw outcome.error;
    }
  }

  throw new LlmFailoverError({
    code: 'ALL_KEYS_EXHAUSTED',
    provider,
    attempts,
    lastError,
  });
}

/**
 * MUSHI_LLM_DRILL=anthropic_no_credit: a platform-key Claude call fails with
 * Anthropic's recorded low-credit 400 before any request is sent, so the
 * fallover can be proven live without touching a key (hosted-llm-order.ts).
 * App-owned keys are never drilled.
 */
function drillWrap<T>(
  fn: (key: ResolvedKey) => Promise<T>,
  candidate: ResolvedKey,
  provider: LlmProvider,
): (key: ResolvedKey) => Promise<T> {
  if (provider !== 'anthropic' || candidate.source !== 'env' || !anthropicNoCreditDrill()) return fn;
  return () => Promise.reject(new AnthropicLowCreditDrillError());
}

/** Why OpenAI should take over from Claude, or null when it should not (the error is rethrown). */
async function openAiCanCover(err: unknown): Promise<string | null> {
  if (
    err instanceof LlmFailoverError &&
    (err.code === 'NO_KEYS_CONFIGURED' || err.code === 'ALL_KEYS_EXHAUSTED')
  ) {
    return err.code;
  }
  // (ai@4 loads here, after a model call, never at boot: ai-sdk.ts.)
  // Anthropic responded but its output didn't match the required schema.
  // OpenAI often handles complex structured-output schemas more reliably.
  if ((await import('./ai-sdk.ts')).NoObjectGeneratedError.isInstance(err)) return 'no_object';
  // Claude (and its server-side fallback chain, which only covers the cyber /
  // frontier_llm categories) declined. Not the key's fault and not transient:
  // `withLlmFailover` re-threw it as fatal without marking the key. OpenAI
  // runs different safety policies, so hand it over.
  if (isClaudeRefusal(err)) return 'refusal';
  return null;
}

/**
 * Claude or OpenAI, in this order:
 *   1. the app's own Claude keys (BYOK: own, legacy, shared, universal). The
 *      platform Claude key joins this leg only when MUSHI_HOSTED_LLM_ORDER
 *      puts Anthropic first;
 *   2. the OpenAI pool: the app's OpenAI/OpenRouter keys, else the platform's
 *      OPENAI_API_KEY and OPENROUTER_API_KEY in the configured order;
 *   3. the platform Claude key as the last resort, when the order lists it
 *      after OpenAI and the app has no Claude key of its own.
 * With the default order (2026-11-21: openai,openrouter,anthropic) a hosted
 * call runs on OpenAI, and an app with its own Claude key keeps it first. An
 * organization that runs AI on OpenAI (ai-provider.ts) gets no Claude key in
 * any leg.
 *
 * Returns the result plus which provider family answered.
 */
export async function withAnthropicOrOpenAi<T>(
  db: SupabaseClient,
  projectId: string,
  anthropicFn: (key: ResolvedKey) => Promise<T>,
  openAiFn: (key: ResolvedKey) => Promise<T>,
): Promise<{ result: T; usedProvider: 'anthropic' | 'openai' }> {
  let appHasNoClaudeKey = false;
  try {
    const result = await withLlmFailover(db, projectId, 'anthropic', anthropicFn);
    return { result, usedProvider: 'anthropic' };
  } catch (err) {
    // Over budget is a project state, not an Anthropic problem: OpenAI is
    // under the same budget, so never fall through to it.
    if (err instanceof LlmBudgetExceededError) throw err;
    const reason = await openAiCanCover(err);
    if (!reason) throw err;
    appHasNoClaudeKey = reason === 'NO_KEYS_CONFIGURED';
    if (!appHasNoClaudeKey) log.warn('Anthropic could not answer; falling back to OpenAI', { projectId, reason });
  }

  try {
    const result = await withLlmFailover(db, projectId, 'openai', openAiFn);
    return { result, usedProvider: 'openai' };
  } catch (err) {
    const lastResort = appHasNoClaudeKey && !hostedClaudeFirst() && hostedClaudeAllowed() &&
      err instanceof LlmFailoverError &&
      (err.code === 'NO_KEYS_CONFIGURED' || err.code === 'ALL_KEYS_EXHAUSTED');
    if (!lastResort) throw err;
    log.warn('OpenAI pool exhausted; trying the platform Claude key last', { projectId, reason: err.code });
    try {
      const result = await withLlmFailover(db, projectId, 'anthropic', anthropicFn, undefined, { hostedClaude: true });
      return { result, usedProvider: 'anthropic' };
    } catch (claudeErr) {
      // No platform Claude key either: the OpenAI failure is the useful one.
      if (claudeErr instanceof LlmFailoverError && claudeErr.code === 'NO_KEYS_CONFIGURED') throw err;
      throw claudeErr;
    }
  }
}
