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
  ANTHROPIC_LOW_CREDIT_BODY,
  DEFAULT_ROUTES_URL,
  drillFailure,
  getRouteCandidates,
  noteOutcome,
  orderCandidates,
  reportProviderFailure,
  type CandidatesSource as RouteSource,
  type RoutesConfig,
  type Tier,
} from './kensaurus-ai-routes-client.ts';
import { platformRouteKey } from './byok.ts';
import { aiProviderForProject } from './ai-provider.ts';
import { runWithRouteParams } from './route-request-params.ts';

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
   * `ownOnly`: the app's own keys only, never the platform key
   * (withAnthropicOrOpenAi runs platform calls through a route instead).
   */
  opts: { openAiOnly?: boolean; ownOnly?: boolean } = {},
): Promise<T> {
  await enforceLlmBudget(db, projectId, provider);
  const candidates = await resolveLlmKeys(db, projectId, provider, {
    openAiOnly: opts.openAiOnly,
    ownOnly: opts.ownOnly,
  });

  if (candidates.length === 0) {
    throw new LlmFailoverError({
      code: 'NO_KEYS_CONFIGURED',
      provider,
      attempts: 0,
      lastError: `No ${provider} key configured. Add one in Settings → AI keys.`,
    });
  }

  // The env fallback in byok.ts always returns exactly one candidate, so a
  // hosted call is never mixed with pooled BYOK keys in the same list.
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
    const outcome = await callWithTransientRetry(fn, candidate, provider);

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
 * KENSAURUS AI routes (CONTRACT 2026-11-21): which provider and model a
 * platform-key call uses comes from kenji `kensaurus_ai_routes`, per
 * (app 'mushi-mushi', feature). The tier only picks the baked list used when
 * kenji cannot be read. Nothing in mushi names the order.
 */
export interface LlmRoute {
  /** The route's feature name, e.g. 'classify-report'. */
  feature: string;
  /** fast ≈ Haiku, standard ≈ Sonnet, premium ≈ Opus: only for the baked fallback. */
  tier: Tier;
  /** Honour KENSAURUS_LLM_DRILL for this call (the smoke script's drill). */
  drill?: boolean;
}

/** The wallet ledger's id for this app, which the route rows use too. */
export const ROUTES_APP = 'mushi-mushi';

/**
 * Where routes are read: KENSAURUS_ROUTES_TOKEN, a read-only token the client
 * sends as x-kensaurus-routes-token (CONTRACT §9; never the wallet token).
 * Without it (a self-host) the URL is empty, so nothing calls kenji and the
 * baked OpenAI-first list runs.
 */
export function routesConfig(): RoutesConfig {
  const token = Deno.env.get('KENSAURUS_ROUTES_TOKEN') ?? '';
  return { url: token ? (Deno.env.get('KENSAURUS_ROUTES_URL') || DEFAULT_ROUTES_URL) : '', token };
}

/**
 * A configured routes read that did not come back live (bad token, kenji
 * down, endpoint missing) would leave mushi on cached or baked routes with
 * console edits and kill switches not reaching it. Said once per isolate
 * (Sentry), so the fallback is never silent.
 */
let warnedRouteSource = false;
function noteRouteSource(cfg: RoutesConfig, source: RouteSource, feature: string): void {
  if (!cfg.url || source === 'live' || source === 'cache' || warnedRouteSource) return;
  warnedRouteSource = true;
  log.error('KENSAURUS AI routes unreadable; running on the fallback list', { source, feature });
}

/** Anthropic's answer to a spent account, verbatim (the routes client's copy). */
export { ANTHROPIC_LOW_CREDIT_BODY };

/**
 * KENSAURUS_LLM_DRILL=<provider>:payment fails that provider's platform call
 * with the recorded low-credit 400 before any request is sent, only on a call
 * that carries `drill: true` (the smoke script). The real drill is the kill
 * switch on kenji (`kensaurus_provider_accounts.enabled = false`).
 */
function drilled(provider: string, route: LlmRoute): { status: number; body: string } | null {
  return route.drill ? drillFailure((Deno.env.get('KENSAURUS_LLM_DRILL') ?? '').trim().toLowerCase(), provider) : null;
}

/** Why the next candidate should take over, or null when the error is rethrown as is. */
async function nextCanCover(err: unknown): Promise<string | null> {
  if (
    err instanceof LlmFailoverError &&
    (err.code === 'NO_KEYS_CONFIGURED' || err.code === 'ALL_KEYS_EXHAUSTED')
  ) {
    return err.code;
  }
  // (ai@4 loads here, after a model call, never at boot: ai-sdk.ts.)
  // The model answered but its output didn't match the schema; another model
  // often handles it.
  if ((await import('./ai-sdk.ts')).NoObjectGeneratedError.isInstance(err)) return 'no_object';
  // Claude (and its server-side fallback chain) declined. Not the key's fault
  // and not transient; another vendor runs different safety policies.
  if (isClaudeRefusal(err)) return 'refusal';
  return null;
}

export interface RoutedLlmResult<T> {
  result: T;
  /** The family that answered: 'openai' covers every OpenAI-compatible host. */
  usedProvider: 'anthropic' | 'openai';
  /** The model a route chose (platform key); undefined when the app's own key answered with the caller's model. */
  model?: string;
  /** The vendor that answered (openai, openrouter, together, anthropic). */
  vendor?: string;
  /** True only when the answer did not come from the first choice: not the route's priority 1, or after the app's own key failed. */
  fallbackUsed: boolean;
  keySource: 'byok' | 'env';
  /** Where the route came from (live, cache, last_known_good, baked); platform calls only. */
  routeSource?: RouteSource;
}

/** Map this module's failure kinds onto the routes client's breaker classes. */
function breakerClass(kind: 'payment' | 'quota' | 'auth' | 'transient_exhausted' | 'config'): 'payment' | 'auth' | 'rate_limit' | 'outage' | 'config' {
  return kind === 'quota' ? 'rate_limit' : kind === 'transient_exhausted' ? 'outage' : kind;
}

/**
 * Run one platform-key call through the feature's KENSAURUS AI route: each
 * candidate in order (down and recently failing providers last), on this
 * project's key for that provider, with the route's model in `key.model`.
 * A failed candidate is noted for the breaker, reported to kenji when a person
 * must act (auth, payment, config), and the next one runs. A wallet denial or
 * an over-budget project never moves to another provider.
 *
 * `projectId: null` (Ask Mushi with no active app): no budget or wallet to
 * check and no organization to ask about Claude, so only OpenAI-compatible
 * candidates run.
 */
export async function withPlatformRoute<T>(
  db: SupabaseClient,
  projectId: string | null,
  route: LlmRoute,
  fns: { anthropic?: ((key: ResolvedKey) => Promise<T>) | null; openai?: ((key: ResolvedKey) => Promise<T>) | null },
): Promise<RoutedLlmResult<T>> {
  if (projectId) await enforceLlmBudget(db, projectId, 'openai');
  const cfg = routesConfig();
  const { candidates, source } = await getRouteCandidates(cfg, ROUTES_APP, route.feature, route.tier);
  noteRouteSource(cfg, source, route.feature);
  const ordered = orderCandidates(candidates);
  // An organization that runs AI on OpenAI gets no Claude key, route or not.
  const claudeOff = !projectId || (await aiProviderForProject(db, projectId)) === 'openai';
  const mapped = ordered.map((c) => ({ c, key: claudeOff && c.provider === 'anthropic' ? null : platformRouteKey(projectId ?? '', c) }));
  // A route candidate this project holds no key for is a config problem a
  // person must fix (a missing secret), not a silent skip.
  for (const { c, key } of mapped) {
    if (key || (claudeOff && c.provider === 'anthropic')) continue;
    noteOutcome(c.provider, 'config');
    void reportProviderFailure(cfg, { project: ROUTES_APP, app: ROUTES_APP, feature: route.feature, provider: c.provider, model: c.model, class: 'config' });
  }
  const runnable = mapped.filter((x) => x.key && (x.key.provider === 'anthropic' ? fns.anthropic : fns.openai));
  if (runnable.length === 0) {
    throw new LlmFailoverError({
      code: 'NO_KEYS_CONFIGURED',
      provider: 'openai',
      attempts: 0,
      lastError: `No platform key for any route of ${route.feature} (${ordered.map((c) => c.provider).join(', ') || 'no routes'}).`,
    });
  }
  if (projectId) {
    const preflight = await hostedLlmPreflight({ db, projectId });
    if (!preflight.allowed) throw new WalletDeniedError(preflight.reason ?? 'insufficient', preflight.balanceMicro);
  }

  const firstPriority = Math.min(...ordered.map((c) => c.priority));
  const tried: string[] = [];
  let lastError = '';
  for (const { c, key } of runnable) {
    const k = key!;
    const fn = (k.provider === 'anthropic' ? fns.anthropic : fns.openai)!;
    const drill = drilled(c.provider, route);
    // The route row's params reach the OpenAI-family request (reasoning_effort,
    // body); Claude calls set their own effort in claude-messages.ts.
    const call = drill
      ? () => Promise.reject(Object.assign(new Error(`${drill.status} ${drill.body}`), { status: drill.status }))
      : k.provider === 'anthropic'
        ? fn
        : (key: ResolvedKey) => runWithRouteParams(c.params, () => fn(key));
    const outcome = await callWithTransientRetry(call, k, k.provider);
    if (outcome.ok) {
      noteOutcome(c.provider, 'ok');
      return {
        result: outcome.result,
        usedProvider: k.provider === 'anthropic' ? 'anthropic' : 'openai',
        model: c.model,
        vendor: c.provider,
        fallbackUsed: c.priority !== firstPriority,
        keySource: 'env',
        routeSource: source,
      };
    }
    lastError = outcome.lastError;
    tried.push(`${c.provider}/${c.model}: ${outcome.kind}`);
    if (outcome.kind === 'fatal') {
      if (!(await nextCanCover(outcome.error))) throw outcome.error;
      log.warn('Route candidate could not answer; trying the next', { feature: route.feature, provider: c.provider, model: c.model });
      continue;
    }
    const cls = breakerClass(outcome.kind);
    noteOutcome(c.provider, cls);
    void reportProviderFailure(cfg, {
      project: ROUTES_APP,
      app: ROUTES_APP,
      feature: route.feature,
      provider: c.provider,
      model: c.model,
      class: cls,
    });
    log.warn('Route candidate failed; trying the next', { feature: route.feature, provider: c.provider, model: c.model, kind: outcome.kind });
  }
  throw new LlmFailoverError({
    code: 'ALL_KEYS_EXHAUSTED',
    provider: 'openai',
    attempts: tried.length,
    lastError: `${tried.join('; ')}. Last error: ${lastError}`,
  });
}

/**
 * Claude or OpenAI for one feature:
 *   1. the app's own Claude keys (BYOK: own, legacy, shared, universal);
 *   2. the app's own OpenAI/OpenRouter keys;
 *   3. the platform keys, through the feature's KENSAURUS AI route
 *      (`withPlatformRoute`): provider, model and order come from kenji.
 * An app's own key keeps the caller's model; a platform call gets the route's
 * model in `key.model`, so callers send `key.model ?? <their default>`.
 * Pass `anthropicFn: null` for a feature only OpenAI-compatible models serve.
 */
export async function withAnthropicOrOpenAi<T>(
  db: SupabaseClient,
  projectId: string,
  anthropicFn: ((key: ResolvedKey) => Promise<T>) | null,
  openAiFn: (key: ResolvedKey) => Promise<T>,
  route: LlmRoute,
): Promise<RoutedLlmResult<T>> {
  let ownKeyFailed = false;
  if (anthropicFn) {
    try {
      const result = await withLlmFailover(db, projectId, 'anthropic', anthropicFn, undefined, { ownOnly: true });
      return { result, usedProvider: 'anthropic', fallbackUsed: false, keySource: 'byok' };
    } catch (err) {
      // Over budget is a project state, not a vendor problem: never move on.
      if (err instanceof LlmBudgetExceededError) throw err;
      const reason = await nextCanCover(err);
      if (!reason) throw err;
      if (reason !== 'NO_KEYS_CONFIGURED') {
        ownKeyFailed = true;
        log.warn("The app's Claude key could not answer; trying its OpenAI key", { projectId, reason });
      }
    }
  }
  try {
    const result = await withLlmFailover(db, projectId, 'openai', openAiFn, undefined, { ownOnly: true });
    return { result, usedProvider: 'openai', fallbackUsed: ownKeyFailed, keySource: 'byok' };
  } catch (err) {
    if (err instanceof LlmBudgetExceededError) throw err;
    const reason = await nextCanCover(err);
    if (!reason) throw err;
    if (reason !== 'NO_KEYS_CONFIGURED') ownKeyFailed = true;
  }
  const routed = await withPlatformRoute(db, projectId, route, { anthropic: anthropicFn, openai: openAiFn });
  return { ...routed, fallbackUsed: routed.fallbackUsed || ownKeyFailed };
}
