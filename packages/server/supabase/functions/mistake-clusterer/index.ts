/**
 * mistake-clusterer — BIRCH-style incremental streaming clusterer
 *
 * Schedule: every 15 minutes (cron) + manual trigger via POST.
 *
 * Algorithm (per plan §1a):
 *   For each new report_embedding not yet in report_cluster_membership:
 *     a) find nearest centroid (cosine distance ≤ 0.18 → assign)
 *     b) otherwise start a new candidate cluster
 *     c) re-centroid the matched cluster (running mean update)
 *
 *   Coherence sub-step (every 6h):
 *     For each candidate cluster with size ≥ 3:
 *       - read top-5 reports
 *       - LLM judge rates semantic coherence 0-1
 *       - if coherence ≥ 0.75 → promote to lessons (calls mistake-summarizer)
 *
 * Cost discipline: every LLM call logged to llm_cost_usd.
 */

import { createAnthropic } from 'npm:@ai-sdk/anthropic@1'
import { createOpenAI } from 'npm:@ai-sdk/openai@1'
import { generateObject } from 'npm:ai@4'
import { z } from 'npm:zod@3'
import { getServiceClient } from '../_shared/db.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { ANTHROPIC_SONNET, OPENAI_PRIMARY } from '../_shared/models.ts'

// Cosine distance threshold for cluster assignment (≤ = assign, > = new cluster)
const ASSIGN_DISTANCE = 0.18
// Minimum cluster size before coherence check
const MIN_CLUSTER_SIZE = 3
// Coherence threshold for promotion to lesson
const COHERENCE_THRESHOLD = 0.75
// How many reports to feed the coherence judge
const JUDGE_TOP_K = 5
// Max reports to process per run (prevents 15-min timeout)
const MAX_REPORTS_PER_RUN = 200

const coherenceSchema = z.object({
  coherence_score: z.number().min(0).max(1).describe(
    'Semantic coherence 0-1: do all these reports describe the same root problem?',
  ),
  cluster_name: z.string().max(80).describe(
    '≤ 8-word slug name for this cluster (e.g. "Settings back-button double safe-area inset")',
  ),
  cluster_summary: z.string().max(400).describe(
    '2-3 sentence summary of what this cluster of reports is about',
  ),
  suggested_rule: z.string().max(200).describe(
    'A 2-line preventive rule a developer should follow (e.g. "Never add useSafeAreaInsets().top inside ScreenContainer — the container already pads the edge.")',
  ),
  severity: z.enum(['info', 'warn', 'critical']).describe(
    'Overall severity: info (cosmetic), warn (UX degradation), critical (blocker/data loss)',
  ),
})

async function logLlmCost(
  db: ReturnType<typeof getServiceClient>,
  projectId: string | null,
  operation: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  costUsd: number,
) {
  await db.from('llm_cost_usd').insert({
    project_id: projectId,
    operation,
    model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: costUsd,
  })
}

/** Running centroid update: avg = avg + (new - avg) / n */
function updateCentroid(currentCentroid: number[], newVector: number[], newSize: number): number[] {
  return currentCentroid.map((v, i) => v + (newVector[i] - v) / newSize)
}

/** Parse a string like "[0.1,0.2,...]" into number[] */
function parseVector(raw: unknown): number[] {
  if (typeof raw === 'string') return JSON.parse(raw)
  if (Array.isArray(raw)) return raw as number[]
  throw new Error(`Cannot parse vector from ${typeof raw}`)
}

/** Compute cosine distance (1 - cosine similarity) between two equal-length vectors */
function cosineDistance(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 1
  return 1 - dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

Deno.serve(
  withSentry(async (req: Request) => {
    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 })
    }

    const isManual = req.headers.get('x-mushi-trigger') === 'manual'
    if (!isManual) {
      const authErr = requireServiceRoleAuth(req)
      if (authErr) return authErr
    }

    const db = getServiceClient()

    // ─── Step 1: Incremental clustering of new embeddings ───────────────────

    // Find unprocessed embeddings (not yet in report_cluster_membership)
    const { data: unprocessed, error: fetchErr } = await db
      .from('report_embeddings')
      .select('report_id, embedding, reports!inner(project_id, severity)')
      .not('report_id', 'in',
        db.from('report_cluster_membership').select('report_id'),
      )
      .limit(MAX_REPORTS_PER_RUN)

    if (fetchErr) {
      console.error('[mistake-clusterer] fetch error:', fetchErr.message)
      return new Response(JSON.stringify({ error: fetchErr.message }), { status: 500 })
    }

    let assigned = 0
    let created = 0

    for (const row of (unprocessed ?? [])) {
      const reportId = row.report_id as string
      const projectId = (row.reports as { project_id: string }).project_id
      const severity = (row.reports as { severity: string }).severity ?? 'warn'
      const embedding = parseVector(row.embedding)

      // Load existing candidate clusters for this project
      const { data: clusters } = await db
        .from('mistake_clusters')
        .select('id, centroid, cluster_size, severity_distribution')
        .eq('project_id', projectId)
        .neq('status', 'retired')
        .limit(500)

      let bestClusterId: string | null = null
      let bestDistance = Infinity

      for (const cluster of (clusters ?? [])) {
        const centroid = parseVector(cluster.centroid)
        const dist = cosineDistance(embedding, centroid)
        if (dist < bestDistance) {
          bestDistance = dist
          bestClusterId = cluster.id as string
        }
      }

      if (bestClusterId && bestDistance <= ASSIGN_DISTANCE) {
        // Assign to existing cluster
        const cluster = clusters!.find((c) => c.id === bestClusterId)!
        const newSize = (cluster.cluster_size as number) + 1
        const newCentroid = updateCentroid(
          parseVector(cluster.centroid),
          embedding,
          newSize,
        )
        const distribution = (cluster.severity_distribution as Record<string, number>) ?? {}
        distribution[severity] = (distribution[severity] ?? 0) + 1

        await Promise.all([
          db.from('mistake_clusters').update({
            centroid: JSON.stringify(newCentroid),
            cluster_size: newSize,
            severity_distribution: distribution,
            last_seen_at: new Date().toISOString(),
          }).eq('id', bestClusterId),
          db.from('report_cluster_membership').insert({
            report_id: reportId,
            cluster_id: bestClusterId,
            distance: bestDistance,
          }),
        ])
        assigned++
      } else {
        // Create new candidate cluster
        const { data: newCluster } = await db
          .from('mistake_clusters')
          .insert({
            project_id: projectId,
            centroid: JSON.stringify(embedding),
            cluster_size: 1,
            severity_distribution: { [severity]: 1 },
            status: 'candidate',
          })
          .select('id')
          .single()

        if (newCluster) {
          await db.from('report_cluster_membership').insert({
            report_id: reportId,
            cluster_id: newCluster.id,
            distance: 0,
          })
          created++
        }
      }
    }

    // ─── Step 2: Coherence judge (every 6h or when runCoherence=true) ────────

    const body = await req.json().catch(() => ({}))
    const runCoherence = body.runCoherence === true || isCoherenceWindow()

    let promoted = 0
    if (runCoherence) {
      // Find candidate clusters with size ≥ 3 that haven't been judged recently
      const { data: candidates } = await db
        .from('mistake_clusters')
        .select('id, project_id, cluster_size, severity_distribution, name')
        .eq('status', 'candidate')
        .gte('cluster_size', MIN_CLUSTER_SIZE)
        .limit(20)

      for (const cluster of (candidates ?? [])) {
        const clusterId = cluster.id as string
        const projectId = cluster.project_id as string

        // Get top-K reports for this cluster
        const { data: members } = await db
          .from('report_cluster_membership')
          .select('report_id, distance, reports!inner(title, description, category, severity)')
          .eq('cluster_id', clusterId)
          .order('distance', { ascending: true })
          .limit(JUDGE_TOP_K)

        if (!members?.length) continue

        const reportSummaries = members
          .map((m) => {
            const r = m.reports as { title?: string; description?: string; category?: string }
            return `- [${r.category ?? 'unknown'}] ${r.title ?? ''}: ${(r.description ?? '').slice(0, 200)}`
          })
          .join('\n')

        const prompt = `You are a quality-assurance engineer reviewing a cluster of ${members.length} bug reports to determine if they describe the same root problem.

Reports in this cluster:
${reportSummaries}

Rate the semantic coherence of this cluster and suggest how to name and summarise it.`

        try {
          let result: z.infer<typeof coherenceSchema>
          let usageTokens = { promptTokens: 0, completionTokens: 0 }
          const anthropic = createAnthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })

          try {
            const { object, usage } = await generateObject({
              model: anthropic(ANTHROPIC_SONNET),
              schema: coherenceSchema,
              prompt,
            })
            result = object
            usageTokens = { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens }
          } catch {
            const openai = createOpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') })
            const { object, usage } = await generateObject({
              model: openai(OPENAI_PRIMARY),
              schema: coherenceSchema,
              prompt,
            })
            result = object
            usageTokens = { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens }
          }

          // Log cost
          const costUsd = (usageTokens.promptTokens / 1_000_000) * 3 + (usageTokens.completionTokens / 1_000_000) * 15
          await logLlmCost(db, projectId, 'cluster-coherence', ANTHROPIC_SONNET, usageTokens.promptTokens, usageTokens.completionTokens, costUsd)

          // Update cluster with judge result
          const updatePayload: Record<string, unknown> = {
            judge_coherence_score: result.coherence_score,
            name: result.cluster_name,
            summary: result.cluster_summary,
            suggested_rule: result.suggested_rule,
          }

          if (result.coherence_score >= COHERENCE_THRESHOLD) {
            updatePayload.status = 'promoted'
            // Create the lesson
            const sampleIds = (members ?? []).map((m) => m.report_id as string)
            await db.from('lessons').insert({
              project_id: projectId,
              cluster_id: clusterId,
              rule_text: result.suggested_rule,
              anti_pattern: null,
              summary_paragraph: result.cluster_summary,
              severity: result.severity,
              frequency: cluster.cluster_size,
              sample_report_ids: sampleIds,
            })
            promoted++
          }

          await db.from('mistake_clusters').update(updatePayload).eq('id', clusterId)
        } catch (err) {
          console.error(`[mistake-clusterer] coherence judge failed for cluster ${clusterId}:`, err)
        }
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        processed: (unprocessed ?? []).length,
        assigned,
        created,
        promoted,
        coherenceRan: runCoherence,
      }),
      { headers: { 'content-type': 'application/json' } },
    )
  }),
)

/** True if current UTC hour is 0, 6, 12, or 18 — the 4 coherence windows */
function isCoherenceWindow() {
  const h = new Date().getUTCHours()
  return h % 6 === 0
}
