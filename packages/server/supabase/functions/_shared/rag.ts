import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { createEmbedding } from './embeddings.ts'
import { log } from './logger.ts'

const ragLog = log.child('rag')

export interface CodeContext {
  filePath: string
  preview: string
  componentTag?: string
  similarity: number
  symbolName?: string | null
  signature?: string | null
  lineStart?: number | null
  lineEnd?: number | null
}

export type RagSkipReason =
  | 'disabled'
  | 'empty_query'
  | 'embedding_failed'
  | 'rpc_failed'
  | 'no_matches'

export interface RagResult {
  files: CodeContext[]
  reason: RagSkipReason | 'ok'
  detail?: string
}

/** Back-compat wrapper used by callers that only need the list. */
export async function getRelevantCode(
  db: SupabaseClient,
  projectId: string,
  extraction: { symptom?: string; action?: string; component?: string },
): Promise<CodeContext[]> {
  const r = await getRelevantCodeWithReason(db, projectId, extraction)
  return r.files
}

export async function getRelevantCodeWithReason(
  db: SupabaseClient,
  projectId: string,
  extraction: { symptom?: string; action?: string; component?: string },
): Promise<RagResult> {
  const { data: settings } = await db
    .from('project_settings')
    .select('codebase_index_enabled')
    .eq('project_id', projectId)
    .single()

  if (!settings?.codebase_index_enabled) {
    return { files: [], reason: 'disabled' }
  }

  const queryText = [extraction.symptom, extraction.action, extraction.component]
    .filter(Boolean)
    .join(' ')

  if (!queryText.trim()) {
    return { files: [], reason: 'empty_query' }
  }

  let embedding: number[]
  try {
    embedding = await createEmbedding(queryText, { projectId })
  } catch (err) {
    const detail = String(err).slice(0, 240)
    ragLog.error('RAG embedding call failed', { projectId, err: detail })
    return { files: [], reason: 'embedding_failed', detail }
  }

  const { data: files, error } = await db.rpc('match_codebase_files', {
    query_embedding: embedding,
    match_project: projectId,
    match_count: 5,
    path_prefix: null,
  })

  if (error) {
    const detail = error.message.slice(0, 240)
    ragLog.error('match_codebase_files rpc failed', { projectId, err: detail })
    return { files: [], reason: 'rpc_failed', detail }
  }

  const mapped = (files ?? []).map((f: Record<string, unknown>) => ({
    filePath: f.file_path as string,
    preview: f.content_preview as string,
    componentTag: f.component_tag as string | undefined,
    similarity: f.similarity as number,
    symbolName: (f.symbol_name as string | null | undefined) ?? null,
    signature: (f.signature as string | null | undefined) ?? null,
    lineStart: (f.line_start as number | null | undefined) ?? null,
    lineEnd: (f.line_end as number | null | undefined) ?? null,
  }))

  if (mapped.length === 0) {
    return { files: [], reason: 'no_matches' }
  }
  return { files: mapped, reason: 'ok' }
}

/**
 * Deterministic signals measured from the report itself (headroom pattern:
 * let the embedding propose, but re-rank with measured signals — embedding
 * similarity alone happily ranks a lookalike file above the one the failing
 * request actually hit).
 */
export interface RerankSignals {
  /** Component tag from Stage-1 extraction / widget element selector. */
  component?: string
  /** Route or URL path the user was on (e.g. '/checkout'). */
  route?: string
  /** Path of a failing captured network request (e.g. '/v1/orders'). */
  failingRequestPath?: string
}

const RERANK_BOOSTS = {
  component: 0.15,
  route: 0.1,
  failingRequestPath: 0.1,
} as const

function pathTokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2)
}

/**
 * Stable re-rank: similarity plus additive boosts when a file's path or
 * component tag overlaps a measured signal. Never removes files, only
 * reorders — the budget in formatCodeContext does the trimming.
 */
export function rerankCodeContext(files: CodeContext[], signals: RerankSignals): CodeContext[] {
  const componentTokens = signals.component ? pathTokens(signals.component) : []
  const routeTokens = signals.route ? pathTokens(signals.route) : []
  const requestTokens = signals.failingRequestPath ? pathTokens(signals.failingRequestPath) : []
  if (!componentTokens.length && !routeTokens.length && !requestTokens.length) return files

  const scored = files.map((f, index) => {
    const fileTokens = new Set(pathTokens(`${f.filePath} ${f.componentTag ?? ''} ${f.symbolName ?? ''}`))
    let score = f.similarity
    if (componentTokens.some((t) => fileTokens.has(t))) score += RERANK_BOOSTS.component
    if (routeTokens.some((t) => fileTokens.has(t))) score += RERANK_BOOSTS.route
    if (requestTokens.some((t) => fileTokens.has(t))) score += RERANK_BOOSTS.failingRequestPath
    return { f, score, index }
  })

  return scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((s) => s.f)
}

/** ~4 chars/token; default keeps code context well under the model budget. */
const DEFAULT_CONTEXT_CHAR_BUDGET = 16_000

export function formatCodeContext(
  files: CodeContext[],
  opts: { maxChars?: number } = {},
): string {
  if (!files.length) return ''
  const maxChars = opts.maxChars ?? DEFAULT_CONTEXT_CHAR_BUDGET

  const blocks = files.map(f => {
    const head = f.symbolName
      ? `--- ${f.filePath}:${f.lineStart ?? '?'}-${f.lineEnd ?? '?'} :: ${f.symbolName} (similarity: ${f.similarity.toFixed(2)}) ---`
      : `--- ${f.filePath} (similarity: ${f.similarity.toFixed(2)}) ---`
    return `${head}\n${f.signature ? `${f.signature}\n` : ''}${f.preview}`
  })

  // Hard budget with an explicit truncation marker — the model (and anyone
  // reading the trace) must know context was dropped, never guess.
  const kept: string[] = []
  let used = 0
  for (const block of blocks) {
    if (used + block.length > maxChars && kept.length > 0) {
      kept.push(`... ${blocks.length - kept.length} more file(s) omitted (context budget ${maxChars} chars)`)
      break
    }
    kept.push(block)
    used += block.length + 2
  }
  return kept.join('\n\n')
}
