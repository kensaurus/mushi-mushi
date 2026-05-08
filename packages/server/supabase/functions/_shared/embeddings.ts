import { getServiceClient } from './db.ts'
import { createTrace } from './observability.ts'
import { log } from './logger.ts'
import { resolveLlmKey } from './byok.ts'

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
}

interface ResolvedOpenAi {
  key: string
  baseUrl: string
  source: 'byok' | 'env'
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
      const r = await resolveLlmKey(db, projectId, 'openai')
      if (r) {
        return {
          key: r.key,
          baseUrl: normalizeOpenAiBaseUrl(r.baseUrl),
          source: r.source,
        }
      }
    } catch (err) {
      embLog.warn('BYOK OpenAI resolve failed; falling back to env', { projectId, err: String(err).slice(0, 120) })
    }
  }
  const envKey = Deno.env.get('OPENAI_API_KEY')
  if (!envKey) return null
  return {
    key: envKey,
    baseUrl: normalizeOpenAiBaseUrl(Deno.env.get('OPENAI_BASE_URL') ?? 'https://api.openai.com'),
    source: 'env',
  }
}

/**
 * Maximum number of retry attempts for a 429 / 5xx embedding response.
 * 4 retries with exponential backoff (1s, 2s, 4s, 8s) tops out at ~15s
 * total wait — long enough to ride out a typical OpenRouter free-tier
 * burst limit reset, short enough that a single chunk can't stall the
 * whole repo sweep. Set MUSHI_EMBED_MAX_RETRIES to override per-deploy.
 */
const MAX_RETRIES = Number(Deno.env.get('MUSHI_EMBED_MAX_RETRIES') ?? '4')
const BASE_BACKOFF_MS = Number(Deno.env.get('MUSHI_EMBED_BASE_BACKOFF_MS') ?? '1000')

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
  const truncatedInput = Array.isArray(input)
    ? input.map((t) => t.slice(0, 8000))
    : input.slice(0, 8000)
  return await fetch(`${resolved.baseUrl}/v1/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${resolved.key}`,
    },
    body: JSON.stringify({
      model: embeddingModel,
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
  const resolved = await resolveOpenAi(opts.projectId)
  if (!resolved) throw new Error('OPENAI_API_KEY not set (and no BYOK key configured)')

  // Retry loop: 429 (rate-limited) and 5xx (transient upstream) get retried
  // with backoff; everything else (4xx auth/quota, 200-OK soft-failures)
  // throws immediately so the caller sees an actionable error. This is the
  // exact failure pattern flagged by /integrations: the glot.it repo sweep
  // hammered OpenRouter without any backoff and one bad chunk surfaced as
  // "No embedding returned from openrouter.ai … HTTP 429" in `last_index_error`.
  let lastError = ''
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetchEmbedding(resolved, embeddingModel, text)

    if (response.ok) {
      const result = await response.json()
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
  const resolved = await resolveOpenAi(opts.projectId)
  if (!resolved) throw new Error('OPENAI_API_KEY not set (and no BYOK key configured)')

  let lastError = ''
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetchEmbedding(resolved, embeddingModel, inputs)

    if (response.ok) {
      const result = await response.json() as {
        data?: Array<{ embedding: number[]; index?: number }>
      }
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
      const embeddings = ordered.map((r, i) => {
        if (!r.embedding) {
          throw new Error(
            `No embedding for batch index ${i} from ${hostOf(resolved.baseUrl)} ` +
            `for model ${embeddingModel}`,
          )
        }
        return r.embedding
      })
      return embeddings
    }

    const body = await response.text()
    lastError = `${response.status}: ${body.slice(0, 200)}`
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
    const embedding = result.data?.[0]?.embedding
    const tokenUsage = result.usage?.total_tokens
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

export async function suggestGrouping(
  reportId: string,
  projectId: string,
  threshold?: number,
): Promise<{ groupId?: string; similarCount: number }> {
  const similar = await findSimilarReports(reportId, projectId, threshold, 3)
  if (similar.length === 0) return { similarCount: 0 }

  const db = getServiceClient()

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
