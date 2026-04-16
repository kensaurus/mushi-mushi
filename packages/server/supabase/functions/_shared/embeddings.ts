import { getServiceClient } from './db.ts'
import { createTrace } from './observability.ts'
import { log } from './logger.ts'

const embLog = log.child('embeddings')

const DEFAULT_MODEL = 'text-embedding-3-small'
const DEFAULT_DIMENSIONS = 1536
const DEFAULT_DEDUP_THRESHOLD = 0.82

export async function createEmbedding(
  text: string,
  model?: string,
): Promise<number[]> {
  const embeddingModel = model ?? DEFAULT_MODEL
  const openaiKey = Deno.env.get('OPENAI_API_KEY')
  if (!openaiKey) throw new Error('OPENAI_API_KEY not set')

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: embeddingModel,
      input: text.slice(0, 8000),
      dimensions: DEFAULT_DIMENSIONS,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Embedding API error: ${response.status} ${body.slice(0, 200)}`)
  }

  const result = await response.json()
  const embedding = result.data?.[0]?.embedding
  if (!embedding) throw new Error('No embedding returned from API')
  return embedding
}

export async function generateAndStoreEmbedding(
  reportId: string,
  text: string,
  model?: string,
): Promise<void> {
  const embeddingModel = model ?? DEFAULT_MODEL
  const openaiKey = Deno.env.get('OPENAI_API_KEY')
  if (!openaiKey) {
    embLog.warn('OPENAI_API_KEY not set, skipping embedding generation')
    return
  }

  const trace = createTrace('embedding', { reportId, model: embeddingModel })
  const span = trace.span('openai.embed')

  try {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`,
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
      embLog.error('Embedding API error', { status: response.status, body: errBody })
      return
    }

    const result = await response.json()
    const embedding = result.data?.[0]?.embedding
    const tokenUsage = result.usage?.total_tokens
    span.end({ model: embeddingModel, inputTokens: tokenUsage })
    if (!embedding) return

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

  return (data ?? [])
    .filter((r: any) => r.report_id !== reportId)
    .slice(0, limit)
    .map((r: any) => ({
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
