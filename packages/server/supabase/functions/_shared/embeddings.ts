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
 * index at 0 rows. Strip the trailing `/v1` (and any trailing slash) so both
 * forms land on `<base>/v1/embeddings`.
 */
function normalizeOpenAiBaseUrl(raw: string | null | undefined): string {
  const trimmed = (raw ?? '').replace(/\/+$/, '')
  if (!trimmed) return 'https://api.openai.com'
  return trimmed.replace(/\/v1$/i, '')
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

  const response = await fetch(`${resolved.baseUrl}/v1/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${resolved.key}`,
    },
    body: JSON.stringify({
      model: embeddingModel,
      input: text.slice(0, 8000),
      dimensions: DEFAULT_DIMENSIONS,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(
      `Embedding API error: ${response.status} from ${hostOf(resolved.baseUrl)} ` +
      `for model ${embeddingModel}: ${body.slice(0, 200)}`,
    )
  }

  const result = await response.json()
  const embedding = result.data?.[0]?.embedding
  if (!embedding) {
    // 200 OK with no embedding is the OpenRouter / Together / Groq "soft
    // failure" shape — include host, model, and upstream diagnostic so the
    // Sentry event is self-diagnosing instead of an opaque string. See
    // MUSHI-MUSHI-SERVER-B for the original regression.
    throw new Error(
      `No embedding returned from ${hostOf(resolved.baseUrl)} ` +
      `for model ${embeddingModel}: ${describeEmptyEmbeddingResponse(result)}`,
    )
  }
  return embedding
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
    const response = await fetch(`${resolved.baseUrl}/v1/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resolved.key}`,
      },
      body: JSON.stringify({
        model: embeddingModel,
        input: text.slice(0, 8000),
        dimensions: DEFAULT_DIMENSIONS,
      }),
    })

    if (!response.ok) {
      const errBody = await response.text()
      span.end({ model: embeddingModel, error: `${response.status}: ${errBody.slice(0, 200)}` })
      embLog.error('Embedding API error', {
        reportId,
        status: response.status,
        host: hostOf(resolved.baseUrl),
        model: embeddingModel,
        body: errBody.slice(0, 500),
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
