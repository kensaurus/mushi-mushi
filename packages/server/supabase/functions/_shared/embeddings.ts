import { getServiceClient } from './db.ts'
import { openAiCompatibleModelId } from './openai-compat.ts'
import { createTrace } from './observability.ts'
import { log } from './logger.ts'
import { markKeyStatus, markKeyUsed, resolveLlmKey } from './byok.ts'
import { extractLlmUsage, recordLlmUsage } from './llm-usage.ts'

const embLog = log.child('embeddings')

const DEFAULT_MODEL = 'text-embedding-3-small'
const DEFAULT_DIMENSIONS = 1536
const DEFAULT_DEDUP_THRESHOLD = 0.82

export interface EmbeddingOptions {
  model?: string
  /**
   * §3a: when provided, the OpenAI key is BYOK-resolved against the
   * project's `byok_openai_key_ref`, with optional `byok_openai_base_url`
   * for OpenRouter / OpenAI-compatible gateways. Falls back to env if not
   * configured. Omitting projectId preserves the legacy env-only behaviour.
   */
  projectId?: string
  /** The edge function or route making the call; names the llm_invocations row. */
  functionName?: string
  /** Report the embedding is for, when there is one. */
  reportId?: string
}

interface ResolvedOpenAi {
  key: string
  baseUrl: string
  source: 'byok' | 'env'
  /** byok_keys row id; undefined for the legacy project_settings ref and env. */
  keyId?: string
}

/**
 * Normalise a BYOK / env base URL to the form the embeddings call expects.
 *
 * Convention: callers of `createEmbedding` append `/v1/embeddings` to the
 * returned `baseUrl`. If the stored BYOK value already includes the `/v1`
 * version prefix (which is the OpenAI SDK default — e.g. OpenRouter stores
 * `https://openrouter.ai/api/v1`), we'd hit `/api/v1/v1/embeddings` and get
 * a Next.js 404 HTML page — the exact failure that kept the glot.it repo
 * index at 0 rows.
 *
 * Sentry MUSHI-MUSHI-SERVER-G/B (regression, 2026-04-23): the original fix
 * stripped exactly ONE trailing `/v1` segment — so a stored URL of
 * `https://openrouter.ai/api/v1/v1` (a doubled prefix that crept in via copy-
 * paste from the OpenAI Python SDK docs, or a settings UI that auto-appends
 * `/v1`) leaked one suffix through and produced the same `/api/v1/v1/embeddings`
 * 404. Loop the strip so the function is idempotent against any number of
 * trailing `/v1` segments and any trailing-slash mix.
 */
export function normalizeOpenAiBaseUrl(raw: string | null | undefined): string {
  let trimmed = (raw ?? '').trim().replace(/\/+$/, '')
  if (!trimmed) return 'https://api.openai.com'
  // Strip every trailing `/v1` (and any slashes that re-surface between hops)
  // so `…/api`, `…/api/v1`, `…/api/v1/`, `…/api/v1/v1` all collapse to `…/api`.
  while (/\/v1\/*$/i.test(trimmed)) {
    trimmed = trimmed.replace(/\/v1\/*$/i, '').replace(/\/+$/, '')
  }
  return trimmed
}

/**
 * Return the hostname of a base URL, or the raw string if it isn't parsable.
 * Used purely for error-message context (e.g. "openrouter.ai" vs "api.openai.com")
 * so an operator seeing a Sentry event knows which gateway returned the bad
 * payload without us leaking the full URL (which may contain auth in the
 * path for self-hosted proxies).
 */
function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname
  } catch {
    return baseUrl
  }
}

/**
 * Extract a human-useful diagnostic string from a 200-OK response body that
 * *didn't* contain an embedding.
 *
 * Why this exists: `createEmbedding` originally threw a bare
 * `'No embedding returned from API'` whenever `data[0].embedding` was
 * missing, which is exactly what fired MUSHI-MUSHI-SERVER-B — we only knew
 * the embedding call failed, never *why*. OpenAI-compatible gateways
 * (OpenRouter, Together, Groq, etc.) tend to return `200 OK` with an
 * `{ error: { message, code, type } }` envelope for:
 *   - model routing failures (unprefixed model name on OpenRouter)
 *   - quota / credit exhaustion
 *   - content filter rejections
 *   - per-model capability gaps ("this model doesn't support embeddings")
 *
 * Surfacing `error.message` (when present) or the first 300 chars of the raw
 * body gives the admin an actionable signal in Sentry `extra.error` without
 * us guessing what each gateway does.
 */
function describeEmptyEmbeddingResponse(result: unknown): string {
  if (result && typeof result === 'object') {
    const r = result as { error?: { message?: string; code?: string | number; type?: string } }
    if (r.error?.message) {
      const code = r.error.code !== undefined ? ` (code=${r.error.code})` : ''
      return `${r.error.message}${code}`
    }
  }
  try {
    const raw = JSON.stringify(result)
    return raw.length > 300 ? `${raw.slice(0, 300)}…` : raw
  } catch {
    return String(result)
  }
}

async function resolveOpenAi(projectId?: string): Promise<ResolvedOpenAi | null> {
  if (projectId) {
    try {
      const db = getServiceClient()
      // Every embedding call writes an llm_invocations row (see
      // recordEmbeddingCall), so its cost counts toward the LLM budget, but
      // `purpose: 'embedding'` keeps the budget from blocking it: an over-budget
      // project still gets RAG lookups and code indexing (_shared/llm-budget.ts).
      const r = await resolveLlmKey(db, projectId, 'openai', { purpose: 'embedding' })
      if (r) {
        return {
          key: r.key,
          baseUrl: normalizeOpenAiBaseUrl(r.baseUrl),
          source: r.source,
          keyId: r.keyId,
        }
      }
    } catch (err) {
      embLog.warn('BYOK OpenAI resolve failed; falling back to env', { projectId, err: String(err).slice(0, 120) })
    }
  }
  return resolveEnvOpenAi()
}

function resolveEnvOpenAi(): ResolvedOpenAi | null {
  const envKey = Deno.env.get('OPENAI_API_KEY')
  if (!envKey) return null
  return {
    key: envKey,
    baseUrl: normalizeOpenAiBaseUrl(Deno.env.get('OPENAI_BASE_URL') ?? 'https://api.openai.com'),
    source: 'env',
  }
}

/**
 * A project key the provider rejects (401/403) is retired the way
 * withLlmFailover retires LLM keys, and the call fails over to the platform
 * key once. Without this a revoked BYOK key broke every RAG lookup until a
 * health probe happened to re-test it (MUSHI-MUSHI-SERVER-1N, glot.it).
 * Returns the fallback credential, or null when there is none.
 */
async function failOverRejectedKey(
  projectId: string | undefined,
  resolved: ResolvedOpenAi,
  status: number,
  body: string,
): Promise<ResolvedOpenAi | null> {
  if (resolved.source !== 'byok' || !projectId || (status !== 401 && status !== 403)) return null
  const reason = `Embedding API ${status} from ${hostOf(resolved.baseUrl)}: ${body.slice(0, 200)}`
  const db = getServiceClient()
  if (resolved.keyId) {
    await markKeyStatus(db, resolved.keyId, 'auth_failed', reason)
  } else {
    const { error } = await db
      .from('project_settings')
      .update({ byok_openai_test_status: 'error_auth' })
      .eq('project_id', projectId)
    if (error) embLog.warn('Failed to retire legacy BYOK OpenAI key', { projectId, error: error.message })
  }
  const fallback = await resolveOpenAi(projectId)
  if (!fallback || fallback.key === resolved.key) return null
  embLog.warn('BYOK OpenAI key rejected; retired it and failed over', {
    projectId,
    status,
    fallbackSource: fallback.source,
  })
  return fallback
}

/**
 * Maximum number of retry attempts for a 429 / 5xx embedding response.
 * 4 retries with exponential backoff (1s, 2s, 4s, 8s) tops out at ~15s
 * total wait — long enough to ride out a typical OpenRouter free-tier
 * burst limit reset, short enough that a single chunk can't stall the
 * whole repo sweep. Set MUSHI_EMBED_MAX_RETRIES to override per-deploy.
 *
 * Reads `Deno.env` at module load when running in Edge Functions, and
 * falls back to `process.env` when imported from a Node test runner
 * (vitest). Without the dual lookup, importing this module from
 * `embeddings-base-url.test.ts` blows up on `Deno is not defined` before
 * any test runs.
 */
function readEnvNumber(name: string, fallback: number): number {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const denoEnv = (globalThis as any).Deno?.env?.get?.(name) as string | undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodeEnv = (globalThis as any).process?.env?.[name] as string | undefined
  const raw = denoEnv ?? nodeEnv
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

const MAX_RETRIES = readEnvNumber('MUSHI_EMBED_MAX_RETRIES', 4)
const BASE_BACKOFF_MS = readEnvNumber('MUSHI_EMBED_BASE_BACKOFF_MS', 1000)

/**
 * Sleep for `ms` milliseconds. Pulled out for testability (could be stubbed
 * with `globalThis.setTimeout` mocking) and to keep the retry loop readable.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Compute the backoff delay for a 429 retry, honouring `Retry-After` when the
 * gateway provides it, falling back to exponential-with-jitter otherwise.
 *
 * `Retry-After` in seconds is the OpenAI / OpenRouter convention; some
 * gateways send an HTTP-date instead — we parse both shapes and clamp the
 * result to a sane upper bound so a misconfigured proxy can't park us for
 * 15 minutes during a single sweep.
 */
function computeRetryDelay(response: Response, attempt: number): number {
  const header = response.headers.get('retry-after')
  if (header) {
    const asSeconds = Number(header)
    if (Number.isFinite(asSeconds) && asSeconds > 0) {
      return Math.min(asSeconds * 1000, 30_000)
    }
    const asDateMs = Date.parse(header)
    if (Number.isFinite(asDateMs)) {
      return Math.min(Math.max(asDateMs - Date.now(), 0), 30_000)
    }
  }
  // Exponential backoff with ±20% jitter to spread retries across concurrent
  // sweeps so a fleet doesn't sync-retry into the same rate window.
  const base = BASE_BACKOFF_MS * Math.pow(2, attempt)
  const jitter = base * 0.2 * (Math.random() * 2 - 1)
  return Math.min(Math.max(base + jitter, 250), 30_000)
}

/** What one embedding call sent and got back, for its llm_invocations row. */
interface EmbeddingCallState {
  /** The credential of the last request actually sent; null = nothing was sent. */
  resolved: ResolvedOpenAi | null
  /** The parsed 200 body (carries `usage.prompt_tokens`), when there was one. */
  body: unknown
}

function newCallState(): EmbeddingCallState {
  return { resolved: null, body: null }
}

/**
 * One llm_invocations row per embedding call: written once on the paid
 * response or once on the final failure, never per 429 retry (a rate-limit
 * storm during a repo sweep would otherwise flood the table with free rows).
 * `skipHostedBilling`: embeddings record their cost but are not debited from
 * the hosted wallet (see LlmInvocationRecord.skipHostedBilling).
 */
function recordEmbeddingCall(
  opts: EmbeddingOptions,
  model: string,
  state: EmbeddingCallState,
  startedAt: number,
  error?: unknown,
): void {
  if (!state.resolved) return
  // The id actually sent (`openai/…` through OpenRouter), so the AI keys spend
  // line can tell which service served the call.
  const sentModel = openAiCompatibleModelId(model, state.resolved.baseUrl)
  try {
    void recordLlmUsage(getServiceClient(), {
      functionName: opts.functionName ?? 'embeddings',
      stage: 'embedding',
      projectId: opts.projectId ?? null,
      reportId: opts.reportId ?? null,
      model: sentModel,
      keySource: state.resolved.source,
      startedAt,
      skipHostedBilling: true,
    }, error === undefined
      ? { result: state.body, usage: { outputTokens: 0 } }
      : { error, usage: { ...extractLlmUsage(state.body), outputTokens: 0 } })
    // A successful call on the project's own key updates that key's "last
    // used" in AI keys; embeddings never did, so search-only keys looked idle.
    if (error === undefined && state.resolved.source === 'byok' && state.resolved.keyId && opts.projectId) {
      void markKeyUsed(getServiceClient(), opts.projectId, 'openai', state.resolved.keyId).catch(() => {})
    }
  } catch (err) {
    embLog.warn('Embedding usage row not written', { err: String(err).slice(0, 120) })
  }
}

/** Token budget per embedding input; text-embedding-3-* rejects inputs over 8,192. */
const EMBED_TOKEN_BUDGET = 7_800

/**
 * Cut text to what the embedding model accepts. A character cap was not
 * enough: 8,000 characters of Thai, Japanese, emoji or base64 can exceed
 * 8,192 tokens, and one such input failed its whole batch of 96 every sweep
 * (the-wanting-mind's index stalled at 581 of 743 files). Each character is
 * costed conservatively — ASCII 0.8 tokens, other BMP characters 2, astral
 * characters (emoji) 3 — so the result stays under the limit without a
 * tokenizer.
 */
export function capForEmbedding(text: string, budget = EMBED_TOKEN_BUDGET): string {
  let cost = 0
  let i = 0
  while (i < text.length && i < 8000) {
    const code = text.codePointAt(i) ?? 0
    const width = code > 0xffff ? 2 : 1
    cost += charTokenCost(code)
    if (cost > budget) break
    i += width
  }
  return text.slice(0, i)
}

function charTokenCost(code: number): number {
  return code < 0x80 ? 0.8 : code > 0xffff ? 3 : 2
}

/** Conservative token estimate for one input as sent (after capForEmbedding). */
export function estimateEmbeddingTokens(text: string): number {
  let cost = 0
  for (const ch of capForEmbedding(text)) cost += charTokenCost(ch.codePointAt(0) ?? 0)
  return Math.ceil(cost)
}

/** OpenAI also caps a request at 300,000 tokens across all inputs. */
const EMBED_REQUEST_TOKEN_BUDGET = 250_000

/**
 * Split a batch so no request goes over EMBED_REQUEST_TOKEN_BUDGET: 96 inputs
 * near the per-input cap reached ~750k tokens and the whole batch was
 * rejected ("maximum request size is 300000 tokens per request").
 */
export function splitEmbeddingBatch(inputs: string[], budget = EMBED_REQUEST_TOKEN_BUDGET): string[][] {
  const groups: string[][] = []
  let current: string[] = []
  let used = 0
  for (const input of inputs) {
    const cost = estimateEmbeddingTokens(input)
    if (current.length > 0 && used + cost > budget) {
      groups.push(current)
      current = []
      used = 0
    }
    current.push(input)
    used += cost
  }
  if (current.length > 0) groups.push(current)
  return groups
}

/**
 * Single embedding HTTP call. Returned separately from the retry wrapper so
 * the loop logic stays compact and the call shape is identical to
 * `generateAndStoreEmbedding` (which still inlines the fetch because it has
 * its own tracing span lifecycle).
 *
 * Accepts either a single string (back-compat with `createEmbedding`) or an
 * array (used by `createEmbeddingBatch`). OpenAI's embeddings endpoint accepts
 * both shapes natively and returns `data: [{ embedding, index }, …]` in the
 * order the inputs were sent — saving us a round of slot-mapping at the call
 * site.
 */
async function fetchEmbedding(
  resolved: ResolvedOpenAi,
  embeddingModel: string,
  input: string | string[],
): Promise<Response> {
  const truncatedInput = Array.isArray(input) ? input.map((t) => capForEmbedding(t)) : capForEmbedding(input)
  return await fetch(`${resolved.baseUrl}/v1/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${resolved.key}`,
    },
    body: JSON.stringify({
      // OpenRouter wants `openai/text-embedding-3-small`; OpenAI wants the bare id.
      model: openAiCompatibleModelId(embeddingModel, resolved.baseUrl),
      input: truncatedInput,
      dimensions: DEFAULT_DIMENSIONS,
    }),
  })
}

export async function createEmbedding(
  text: string,
  modelOrOpts?: string | EmbeddingOptions,
  legacyOpts?: EmbeddingOptions,
): Promise<number[]> {
  const opts: EmbeddingOptions = typeof modelOrOpts === 'string'
    ? { model: modelOrOpts, ...(legacyOpts ?? {}) }
    : { ...(modelOrOpts ?? {}) }
  const embeddingModel = opts.model ?? DEFAULT_MODEL
  const state = newCallState()
  const startedAt = Date.now()
  try {
    const embedding = await createEmbeddingUnrecorded(text, opts, embeddingModel, state)
    recordEmbeddingCall(opts, embeddingModel, state, startedAt)
    return embedding
  } catch (err) {
    recordEmbeddingCall(opts, embeddingModel, state, startedAt, err)
    throw err
  }
}

async function createEmbeddingUnrecorded(
  text: string,
  opts: EmbeddingOptions,
  embeddingModel: string,
  state: EmbeddingCallState,
): Promise<number[]> {
  let resolved = await resolveOpenAi(opts.projectId)
  if (!resolved) throw new Error('OPENAI_API_KEY not set (and no BYOK key configured)')
  let failedOver = false

  // Retry loop: 429 (rate-limited) and 5xx (transient upstream) get retried
  // with backoff; everything else (4xx auth/quota, 200-OK soft-failures)
  // throws immediately so the caller sees an actionable error. This is the
  // exact failure pattern flagged by /integrations: the glot.it repo sweep
  // hammered OpenRouter without any backoff and one bad chunk surfaced as
  // "No embedding returned from openrouter.ai … HTTP 429" in `last_index_error`.
  let lastError = ''
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    state.resolved = resolved
    const response = await fetchEmbedding(resolved, embeddingModel, text)

    if (response.ok) {
      const result = await response.json()
      state.body = result
      const embedding = result.data?.[0]?.embedding
      if (!embedding) {
        // 200 OK with no embedding is the OpenRouter / Together / Groq "soft
        // failure" shape. Include host, model, and upstream diagnostic so the
        // Sentry event is self-diagnosing. See MUSHI-MUSHI-SERVER-B.
        throw new Error(
          `No embedding returned from ${hostOf(resolved.baseUrl)} ` +
          `for model ${embeddingModel}: ${describeEmptyEmbeddingResponse(result)}`,
        )
      }
      return embedding
    }

    const body = await response.text()
    lastError = `${response.status}: ${body.slice(0, 200)}`
    if (!failedOver) {
      const fallback = await failOverRejectedKey(opts.projectId, resolved, response.status, body)
      if (fallback) {
        resolved = fallback
        failedOver = true
        attempt--
        continue
      }
    }
    const retryable = response.status === 429 || (response.status >= 500 && response.status < 600)
    if (!retryable || attempt === MAX_RETRIES) {
      throw new Error(
        `Embedding API error: ${response.status} from ${hostOf(resolved.baseUrl)} ` +
        `for model ${embeddingModel}: ${body.slice(0, 200)}`,
      )
    }

    const delay = computeRetryDelay(response, attempt)
    embLog.warn('Embedding API retryable error — backing off', {
      host: hostOf(resolved.baseUrl),
      model: embeddingModel,
      status: response.status,
      attempt: attempt + 1,
      maxAttempts: MAX_RETRIES + 1,
      delayMs: Math.round(delay),
    })
    await sleep(delay)
  }

  // Unreachable in practice — the loop either returns or throws inside —
  // but TS needs a final fallthrough for the function's return type.
  throw new Error(
    `Embedding API error after ${MAX_RETRIES + 1} attempts: ${lastError}`,
  )
}

/**
 * Batch-embed multiple inputs in a single API call. OpenAI's embeddings
 * endpoint accepts up to 2048 inputs per request (per the docs at
 * https://platform.openai.com/docs/api-reference/embeddings/create) and
 * returns `data: [{ embedding, index }, …]` indexed in input order.
 *
 * Why this exists (perf + rate-limit fix, MUSHI-MUSHI-INDEXER-429):
 *   The repo sweep was firing 1 request per code-chunk (~1077 chunks for
 *   the glot.it repo), which slammed both:
 *     - OpenAI's RPM (requests-per-minute) limit
 *     - OpenAI's TPM (tokens-per-minute) limit, because every per-request
 *       overhead (model name, dimensions, header parsing) is amortised over
 *       a single 100-1000 token chunk.
 *   The error returned was the misleading
 *     "Request too large for text-embedding-3-small … Limit 50000000,
 *      Requested 114"
 *   — what the user is actually seeing is "the next request would push
 *   the org's running 60s token total over the cap", not "this one request
 *   is too big". Batching shrinks 1077 calls into ~11 calls (default
 *   batch=96) and the issue disappears at any reasonable sweep size.
 *
 * Behaviour notes:
 *   - The same retry-with-backoff policy as `createEmbedding` (Retry-After
 *     when present, exponential + jitter otherwise, configurable via
 *     `MUSHI_EMBED_MAX_RETRIES`).
 *   - The whole batch retries together — partial-failure recovery would
 *     require knowing which inputs in the batch were already counted
 *     against the rate limit (OpenAI doesn't expose that), so all-or-
 *     nothing is the safe semantics.
 *   - Returns embeddings in the same order as `inputs`. Throws if the API
 *     returns fewer rows than expected (signals a gateway misbehaviour
 *     worth surfacing; callers can retry the batch one input at a time
 *     if they want partial recovery).
 */
export async function createEmbeddingBatch(
  inputs: string[],
  modelOrOpts?: string | EmbeddingOptions,
  legacyOpts?: EmbeddingOptions,
): Promise<number[][]> {
  if (inputs.length === 0) return []
  const opts: EmbeddingOptions = typeof modelOrOpts === 'string'
    ? { model: modelOrOpts, ...(legacyOpts ?? {}) }
    : { ...(modelOrOpts ?? {}) }
  const embeddingModel = opts.model ?? DEFAULT_MODEL
  const state = newCallState()
  const startedAt = Date.now()
  try {
    const embeddings: number[][] = []
    const groups = splitEmbeddingBatch(inputs)
    let promptTokens = 0
    for (const group of groups) {
      embeddings.push(...(await createEmbeddingBatchUnrecorded(group, opts, embeddingModel, state)))
      promptTokens += (state.body as { usage?: { prompt_tokens?: number } } | null)?.usage?.prompt_tokens ?? 0
    }
    // The ledger reads one body; give it the whole batch's tokens.
    if (groups.length > 1 && state.body && typeof state.body === 'object') {
      state.body = { ...state.body, usage: { prompt_tokens: promptTokens, total_tokens: promptTokens } }
    }
    recordEmbeddingCall(opts, embeddingModel, state, startedAt)
    return embeddings
  } catch (err) {
    recordEmbeddingCall(opts, embeddingModel, state, startedAt, err)
    throw err
  }
}

async function createEmbeddingBatchUnrecorded(
  inputs: string[],
  opts: EmbeddingOptions,
  embeddingModel: string,
  state: EmbeddingCallState,
): Promise<number[][]> {
  let resolved = await resolveOpenAi(opts.projectId)
  if (!resolved) throw new Error('OPENAI_API_KEY not set (and no BYOK key configured)')
  let failedOver = false

  let lastError = ''
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    state.resolved = resolved
    const response = await fetchEmbedding(resolved, embeddingModel, inputs)

    if (response.ok) {
      const result = await response.json() as {
        data?: Array<{ embedding: number[]; index?: number }>
      }
      state.body = result
      const rows = result.data ?? []
      if (rows.length !== inputs.length) {
        throw new Error(
          `Batch embedding shape mismatch from ${hostOf(resolved.baseUrl)} ` +
          `for model ${embeddingModel}: requested ${inputs.length}, got ${rows.length}`,
        )
      }
      // Sort by `index` if the gateway provided it; otherwise trust order.
      // OpenAI always sets `index`; OpenRouter forwards it; some self-hosted
      // proxies omit it — falling back to insertion order is fine because
      // we sent in order and OpenAI guarantees order in the response.
      const ordered = rows.every((r) => typeof r.index === 'number')
        ? [...rows].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
        : rows
      const host = hostOf(resolved.baseUrl)
      const embeddings = ordered.map((r, i) => {
        if (!r.embedding) {
          throw new Error(
            `No embedding for batch index ${i} from ${host} ` +
            `for model ${embeddingModel}`,
          )
        }
        return r.embedding
      })
      return embeddings
    }

    const body = await response.text()
    lastError = `${response.status}: ${body.slice(0, 200)}`
    if (!failedOver) {
      const fallback = await failOverRejectedKey(opts.projectId, resolved, response.status, body)
      if (fallback) {
        resolved = fallback
        failedOver = true
        attempt--
        continue
      }
    }
    const retryable = response.status === 429 || (response.status >= 500 && response.status < 600)
    if (!retryable || attempt === MAX_RETRIES) {
      throw new Error(
        `Embedding API error: ${response.status} from ${hostOf(resolved.baseUrl)} ` +
        `for model ${embeddingModel} (batch=${inputs.length}): ${body.slice(0, 200)}`,
      )
    }

    const delay = computeRetryDelay(response, attempt)
    embLog.warn('Batch embedding API retryable error — backing off', {
      host: hostOf(resolved.baseUrl),
      model: embeddingModel,
      status: response.status,
      batchSize: inputs.length,
      attempt: attempt + 1,
      maxAttempts: MAX_RETRIES + 1,
      delayMs: Math.round(delay),
    })
    await sleep(delay)
  }

  throw new Error(
    `Batch embedding API error after ${MAX_RETRIES + 1} attempts: ${lastError}`,
  )
}

export async function generateAndStoreEmbedding(
  reportId: string,
  text: string,
  modelOrOpts?: string | EmbeddingOptions,
  legacyOpts?: EmbeddingOptions,
): Promise<void> {
  const opts: EmbeddingOptions = typeof modelOrOpts === 'string'
    ? { model: modelOrOpts, ...(legacyOpts ?? {}) }
    : { ...(modelOrOpts ?? {}) }
  const embeddingModel = opts.model ?? DEFAULT_MODEL
  const resolved = await resolveOpenAi(opts.projectId)
  if (!resolved) {
    embLog.warn('No OpenAI key (BYOK or env), skipping embedding generation', { reportId })
    return
  }

  const trace = createTrace('embedding', {
    reportId,
    model: embeddingModel,
    keySource: resolved.source,
  })
  const span = trace.span('openai.embed')
  const usageOpts: EmbeddingOptions = { ...opts, reportId: opts.reportId ?? reportId }
  const state: EmbeddingCallState = { resolved, body: null }
  const startedAt = Date.now()

  try {
    // Mirror the retry policy from `createEmbedding`. Report-similarity is
    // best-effort but a single 429 burst shouldn't silently disable it for
    // every report ingested in the next minute.
    let response: Response | null = null
    let lastErrBody = ''
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      response = await fetchEmbedding(resolved, embeddingModel, text)
      if (response.ok) break
      lastErrBody = await response.text()
      const retryable = response.status === 429 || (response.status >= 500 && response.status < 600)
      if (!retryable || attempt === MAX_RETRIES) break
      const delay = computeRetryDelay(response, attempt)
      embLog.warn('Embedding API retryable error — backing off', {
        reportId,
        host: hostOf(resolved.baseUrl),
        model: embeddingModel,
        status: response.status,
        attempt: attempt + 1,
        maxAttempts: MAX_RETRIES + 1,
        delayMs: Math.round(delay),
      })
      await sleep(delay)
    }

    if (!response || !response.ok) {
      recordEmbeddingCall(usageOpts, embeddingModel, state, startedAt, new Error(`Embedding API error: ${response?.status ?? 'no-response'}`))
      span.end({ model: embeddingModel, error: `${response?.status ?? 'no-response'}: ${lastErrBody.slice(0, 200)}` })
      embLog.error('Embedding API error', {
        reportId,
        status: response?.status,
        host: hostOf(resolved.baseUrl),
        model: embeddingModel,
        body: lastErrBody.slice(0, 500),
      })
      return
    }

    const result = await response.json()
    state.body = result
    const embedding = result.data?.[0]?.embedding
    const tokenUsage = result.usage?.total_tokens
    // A 200 is a paid call even when a gateway returned no vector.
    recordEmbeddingCall(usageOpts, embeddingModel, state, startedAt)
    span.end({ model: embeddingModel, inputTokens: tokenUsage })
    if (!embedding) {
      // 200 OK without an embedding array. `generateAndStoreEmbedding` is
      // best-effort — report similarity grouping is a quality-of-life
      // feature, not a correctness gate — so we warn rather than error to
      // avoid spraying Sentry with one event per ingested report when a
      // BYOK gateway is misconfigured. The diagnostic still lands in
      // Supabase logs for operators; the sweep path in
      // `webhooks-github-indexer` captures the same failure at error level
      // through `createEmbedding`, which is where we want the Sentry signal.
      embLog.warn('No embedding returned from API (report similarity skipped)', {
        reportId,
        host: hostOf(resolved.baseUrl),
        model: embeddingModel,
        detail: describeEmptyEmbeddingResponse(result),
      })
      return
    }

    const db = getServiceClient()
    const { error } = await db.from('report_embeddings').upsert({
      report_id: reportId,
      model: embeddingModel,
      dimensions: DEFAULT_DIMENSIONS,
      embedding: `[${embedding.join(',')}]`,
    }, { onConflict: 'report_id,model' })

    if (error) {
      embLog.error('Failed to store embedding', { reportId, error: error.message })
    }
  } catch (err) {
    if (!state.body) recordEmbeddingCall(usageOpts, embeddingModel, state, startedAt, err)
    span.end({ model: embeddingModel, error: String(err) })
    embLog.error('Embedding generation error', { reportId, err: String(err) })
  }
  await trace.end()
}

export interface SimilarReport {
  reportId: string
  similarity: number
  description: string
  category: string
  createdAt: string
  reportGroupId?: string
}

export async function findSimilarReports(
  reportId: string,
  projectId: string,
  threshold?: number,
  limit = 5,
): Promise<SimilarReport[]> {
  const db = getServiceClient()
  const dedupThreshold = threshold ?? DEFAULT_DEDUP_THRESHOLD

  const { data: embedding } = await db
    .from('report_embeddings')
    .select('embedding')
    .eq('report_id', reportId)
    .eq('model', DEFAULT_MODEL)
    .single()

  if (!embedding?.embedding) return []

  // pgvector cosine similarity search via RPC
  const { data, error } = await db.rpc('match_report_embeddings', {
    query_embedding: embedding.embedding,
    match_threshold: dedupThreshold,
    match_count: limit + 1,
    p_project_id: projectId,
  })

  if (error) {
    embLog.error('Similarity search failed', { reportId, error: error.message })
    return []
  }

  interface MatchRow {
    report_id: string
    similarity: number
    description: string
    category: string
    created_at: string
    report_group_id?: string
  }

  const rows = (data ?? []) as MatchRow[]
  return rows
    .filter(r => r.report_id !== reportId)
    .slice(0, limit)
    .map(r => ({
      reportId: r.report_id,
      similarity: r.similarity,
      description: r.description,
      category: r.category,
      createdAt: r.created_at,
      reportGroupId: r.report_group_id,
    }))
}

/**
 * A project's dedup threshold, or the default when it is unset or outside
 * (0, 1]. A failed read falls back to the default: grouping is a suggestion.
 */
export async function projectDedupThreshold(
  db: ReturnType<typeof getServiceClient>,
  projectId: string,
): Promise<number> {
  const { data } = await db.from('project_settings').select('dedup_threshold').eq('project_id', projectId).maybeSingle()
  const v = Number((data as { dedup_threshold?: unknown } | null)?.dedup_threshold)
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : DEFAULT_DEDUP_THRESHOLD
}

export async function suggestGrouping(
  reportId: string,
  projectId: string,
  threshold?: number,
): Promise<{ groupId?: string; similarCount: number }> {
  const db = getServiceClient()
  // The project's Settings → General "Dedup threshold" (it was saved but never
  // read, so grouping always used the default).
  const effective = threshold ?? (await projectDedupThreshold(db, projectId))
  const similar = await findSimilarReports(reportId, projectId, effective, 3)
  if (similar.length === 0) return { similarCount: 0 }

  const existingGroupId = similar.find(s => s.reportGroupId)?.reportGroupId
  if (existingGroupId) {
    await db.from('reports')
      .update({ report_group_id: existingGroupId })
      .eq('id', reportId)

    await db.from('report_groups')
      .update({ report_count: similar.length + 1, updated_at: new Date().toISOString() })
      .eq('id', existingGroupId)

    return { groupId: existingGroupId, similarCount: similar.length }
  }

  const { data: newGroup } = await db.from('report_groups').insert({
    project_id: projectId,
    canonical_report_id: similar[0].reportId,
    title: `Group: ${similar[0].description.slice(0, 100)}`,
    report_count: similar.length + 1,
  }).select('id').single()

  if (newGroup) {
    const reportIds = [reportId, ...similar.map(s => s.reportId)]
    for (const rid of reportIds) {
      await db.from('reports').update({ report_group_id: newGroup.id }).eq('id', rid)
    }
  }

  return { groupId: newGroup?.id, similarCount: similar.length }
}
