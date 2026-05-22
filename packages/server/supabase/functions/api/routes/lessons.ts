// ============================================================
// lessons.ts — Mistake clusters + lessons admin endpoints
//
// Admin (JWT, org-scoped):
//   GET  /v1/admin/lessons               — list lessons for a project
//   GET  /v1/admin/lessons/:id           — lesson detail + source reports
//   PATCH /v1/admin/lessons/:id          — retire a lesson or update fields
//   GET  /v1/admin/lessons/:id/reports   — sample reports for a cluster
//   GET  /v1/admin/clusters              — list mistake clusters
//   GET  /v1/admin/clusters/:id          — cluster detail
//   POST /v1/admin/clusters/:id/promote  — manually promote to lesson
//   POST /v1/admin/lessons/query         — token-budget retrieval (lessons.query)
//
// SDK / CI (API-key-authenticated, read-only):
//   GET  /v1/sync/lessons                — pull promoted lessons for CLI sync
//                                          Accepts X-Mushi-Api-Key. Used by
//                                          `npx @mushi-mushi/cli sync-lessons`
//                                          and mushi-mcp lessons.query.
// ============================================================

import type { Hono } from 'npm:hono@4'
import { z } from 'npm:zod@3'
import { getServiceClient } from '../../_shared/db.ts'
import { jwtAuth, apiKeyAuth, getOrgIdFromContext } from '../../_shared/auth.ts'
import { ownedProjectIds, resolveOwnedProject } from '../shared.ts'

export function registerLessonsRoutes(app: Hono) {
  // GET /v1/admin/lessons/stats — posture banner + LESSONS SNAPSHOT.
  app.get('/v1/admin/lessons/stats', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const empty = {
      hasAnyProject: false,
      projectId: null as string | null,
      projectName: null as string | null,
      projectCount: 0,
      activeLessons: 0,
      retiredLessons: 0,
      criticalLessons: 0,
      candidateClusters: 0,
      promotedClusters: 0,
      readyToPromote: 0,
      highCoherenceCandidates: 0,
      totalClusterReports: 0,
      lastLessonReinforcedAt: null as string | null,
      topPriority: 'no_project' as
        | 'no_project'
        | 'candidates_ready'
        | 'critical_lessons'
        | 'no_data'
        | 'no_lessons'
        | 'healthy',
      topPriorityLabel: null as string | null,
      topPriorityTo: null as string | null,
    };

    const projectIds = await ownedProjectIds(db, userId);
    if (projectIds.length === 0) {
      return c.json({ ok: true, data: empty });
    }

    const resolvedProject = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () =>
        c.json({
          ok: true,
          data: { ...empty, hasAnyProject: true, projectCount: projectIds.length },
        }),
    });
    if ('response' in resolvedProject) return resolvedProject.response;
    const activeProject = resolvedProject.project;
    const pid = activeProject.id;

    const [activeRes, retiredRes, criticalRes, clustersRes, lastLessonRes] = await Promise.all([
      db.from('lessons').select('id', { count: 'exact', head: true }).eq('project_id', pid).is('retired_at', null),
      db.from('lessons').select('id', { count: 'exact', head: true }).eq('project_id', pid).not('retired_at', 'is', null),
      db
        .from('lessons')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', pid)
        .eq('severity', 'critical')
        .is('retired_at', null),
      db
        .from('mistake_clusters')
        .select('id, status, cluster_size, judge_coherence_score')
        .eq('project_id', pid),
      db
        .from('lessons')
        .select('last_reinforced_at')
        .eq('project_id', pid)
        .is('retired_at', null)
        .order('last_reinforced_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const clusters = clustersRes.data ?? [];
    const candidateClusters = clusters.filter((cl) => cl.status === 'candidate').length;
    const promotedClusters = clusters.filter((cl) => cl.status === 'promoted').length;
    const readyToPromote = clusters.filter(
      (cl) => cl.status === 'candidate' && (cl.cluster_size ?? 0) >= 3,
    ).length;
    const highCoherenceCandidates = clusters.filter(
      (cl) =>
        cl.status === 'candidate' &&
        (cl.cluster_size ?? 0) >= 3 &&
        (cl.judge_coherence_score ?? 0) >= 0.75,
    ).length;
    const totalClusterReports = clusters.reduce((sum, cl) => sum + (cl.cluster_size ?? 0), 0);

    const activeLessons = activeRes.count ?? 0;
    const retiredLessons = retiredRes.count ?? 0;
    const criticalLessons = criticalRes.count ?? 0;

    let topPriority = empty.topPriority;
    let topPriorityLabel: string | null = null;
    let topPriorityTo: string | null = null;

    if (highCoherenceCandidates > 0 || readyToPromote > 0) {
      topPriority = 'candidates_ready';
      topPriorityLabel = `${readyToPromote} cluster${readyToPromote === 1 ? '' : 's'} ready to promote${highCoherenceCandidates > 0 ? ` · ${highCoherenceCandidates} above coherence threshold` : ''}.`;
      topPriorityTo = '/lessons?tab=clusters';
    } else if (criticalLessons > 0) {
      topPriority = 'critical_lessons';
      topPriorityLabel = `${criticalLessons} critical lesson${criticalLessons === 1 ? '' : 's'} active — review before PR context injection.`;
      topPriorityTo = '/lessons?tab=lessons';
    } else if (activeLessons === 0 && clusters.length === 0) {
      topPriority = 'no_data';
      topPriorityLabel = 'No clusters or lessons yet — submit bug reports to seed mistake memory.';
      topPriorityTo = '/reports';
    } else if (activeLessons === 0 && candidateClusters > 0) {
      topPriority = 'no_lessons';
      topPriorityLabel = `${candidateClusters} candidate cluster${candidateClusters === 1 ? '' : 's'} forming — promote when coherence ≥ 75%.`;
      topPriorityTo = '/lessons?tab=clusters';
    } else {
      topPriority = 'healthy';
      topPriorityLabel = `${activeLessons} active lesson${activeLessons === 1 ? '' : 's'} · ${candidateClusters} candidate cluster${candidateClusters === 1 ? '' : 's'}.`;
      topPriorityTo = '/lessons?tab=query';
    }

    return c.json({
      ok: true,
      data: {
        hasAnyProject: true,
        projectId: pid,
        projectName: activeProject.project_name ?? null,
        projectCount: projectIds.length,
        activeLessons,
        retiredLessons,
        criticalLessons,
        candidateClusters,
        promotedClusters,
        readyToPromote,
        highCoherenceCandidates,
        totalClusterReports,
        lastLessonReinforcedAt: lastLessonRes.data?.last_reinforced_at ?? null,
        topPriority,
        topPriorityLabel,
        topPriorityTo,
      },
    });
  });

  // ─── List lessons ────────────────────────────────────────────────────────
  app.get('/v1/admin/lessons', jwtAuth, async (c) => {
    const db = getServiceClient()
    const projectId = c.req.query('projectId') ?? c.req.header('x-mushi-project-id') ?? null
    const orgId = await getOrgIdFromContext(c)
    const limit = Math.min(parseInt(c.req.query('limit') ?? '50'), 500)
    const offset = parseInt(c.req.query('offset') ?? '0')
    const severity = c.req.query('severity')
    const retired = c.req.query('retired') === 'true'

    let query = db
      .from('lessons')
      .select('id, rule_text, anti_pattern, summary_paragraph, severity, frequency, last_reinforced_at, promoted_at, retired_at, cluster_id, mistake_clusters(name, status, judge_coherence_score, cluster_size)', { count: 'exact' })
      .order('frequency', { ascending: false })
      .order('last_reinforced_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (retired) {
      query = query.not('retired_at', 'is', null)
    } else {
      query = query.is('retired_at', null)
    }

    if (projectId) {
      query = query.eq('project_id', projectId)
    } else if (orgId) {
      // Get all project IDs for this org
      const { data: projects } = await db
        .from('projects')
        .select('id')
        .eq('organization_id', orgId)
      const projectIds = (projects ?? []).map((p) => p.id as string)
      if (projectIds.length === 0) {
        return c.json({ ok: true, data: [], meta: { total: 0, limit, offset } })
      }
      query = query.in('project_id', projectIds)
    }

    if (severity) query = query.eq('severity', severity)

    const { data, count, error } = await query
    if (error) return c.json({ ok: false, error: error.message }, 500)

    return c.json({ ok: true, data, meta: { total: count ?? 0, limit, offset } })
  })

  // ─── Lesson detail ────────────────────────────────────────────────────────
  app.get('/v1/admin/lessons/:id', jwtAuth, async (c) => {
    const db = getServiceClient()
    const { data, error } = await db
      .from('lessons')
      .select('*, mistake_clusters(id, name, summary, suggested_rule, cluster_size, status, judge_coherence_score, first_seen_at, last_seen_at)')
      .eq('id', c.req.param('id'))
      .single()

    if (error) return c.json({ ok: false, error: error.message }, error.code === 'PGRST116' ? 404 : 500)
    return c.json({ ok: true, data })
  })

  // ─── Retire / update a lesson ─────────────────────────────────────────────
  const patchLessonSchema = z.object({
    retired: z.boolean().optional(),
    rule_text: z.string().min(1).max(500).optional(),
    severity: z.enum(['info', 'warn', 'critical']).optional(),
  })

  app.patch('/v1/admin/lessons/:id', jwtAuth, async (c) => {
    const db = getServiceClient()
    const body = patchLessonSchema.safeParse(await c.req.json())
    if (!body.success) return c.json({ ok: false, error: body.error.flatten() }, 400)

    const updates: Record<string, unknown> = {}
    if (body.data.retired !== undefined) {
      updates.retired_at = body.data.retired ? new Date().toISOString() : null
    }
    if (body.data.rule_text !== undefined) updates.rule_text = body.data.rule_text
    if (body.data.severity !== undefined) updates.severity = body.data.severity

    const { data, error } = await db
      .from('lessons')
      .update(updates)
      .eq('id', c.req.param('id'))
      .select()
      .single()

    if (error) return c.json({ ok: false, error: error.message }, 500)
    return c.json({ ok: true, data })
  })

  // ─── Source reports for a lesson's cluster ────────────────────────────────
  app.get('/v1/admin/lessons/:id/reports', jwtAuth, async (c) => {
    const db = getServiceClient()
    const { data: lesson } = await db
      .from('lessons')
      .select('cluster_id, sample_report_ids')
      .eq('id', c.req.param('id'))
      .single()

    if (!lesson) return c.json({ ok: false, error: 'not found' }, 404)

    const sampleIds = (lesson.sample_report_ids as string[]) ?? []
    if (sampleIds.length === 0) return c.json({ ok: true, data: [] })

    const { data, error } = await db
      .from('reports')
      .select('id, title, description, severity, category, status, created_at')
      .in('id', sampleIds)

    if (error) return c.json({ ok: false, error: error.message }, 500)
    return c.json({ ok: true, data })
  })

  // ─── List clusters ────────────────────────────────────────────────────────
  app.get('/v1/admin/clusters', jwtAuth, async (c) => {
    const db = getServiceClient()
    const projectId = c.req.query('projectId') ?? c.req.header('x-mushi-project-id') ?? null
    const limit = Math.min(parseInt(c.req.query('limit') ?? '50'), 200)
    const offset = parseInt(c.req.query('offset') ?? '0')
    const status = c.req.query('status') // 'candidate' | 'promoted' | 'retired'

    let query = db
      .from('mistake_clusters')
      .select('id, project_id, cluster_size, severity_distribution, first_seen_at, last_seen_at, status, name, summary, suggested_rule, judge_coherence_score', { count: 'exact' })
      .order('cluster_size', { ascending: false })
      .range(offset, offset + limit - 1)

    if (projectId) query = query.eq('project_id', projectId)
    if (status) query = query.eq('status', status)

    const { data, count, error } = await query
    if (error) return c.json({ ok: false, error: error.message }, 500)
    return c.json({ ok: true, data, meta: { total: count ?? 0, limit, offset } })
  })

  // ─── Cluster detail ────────────────────────────────────────────────────────
  app.get('/v1/admin/clusters/:id', jwtAuth, async (c) => {
    const db = getServiceClient()
    const [clusterRes, membersRes] = await Promise.all([
      db.from('mistake_clusters').select('*').eq('id', c.req.param('id')).single(),
      db.from('report_cluster_membership')
        .select('report_id, distance, assigned_at, reports!inner(id, title, severity, category, status, created_at)')
        .eq('cluster_id', c.req.param('id'))
        .order('distance', { ascending: true })
        .limit(20),
    ])

    if (clusterRes.error) return c.json({ ok: false, error: clusterRes.error.message }, 404)
    return c.json({ ok: true, data: { ...clusterRes.data, members: membersRes.data ?? [] } })
  })

  // ─── Manually promote cluster to lesson ───────────────────────────────────
  app.post('/v1/admin/clusters/:id/promote', jwtAuth, async (c) => {
    const db = getServiceClient()
    const { data: cluster } = await db
      .from('mistake_clusters')
      .select('*')
      .eq('id', c.req.param('id'))
      .single()

    if (!cluster) return c.json({ ok: false, error: 'cluster not found' }, 404)

    const body = await c.req.json().catch(() => ({}))
    const rule = body.rule_text ?? cluster.suggested_rule ?? 'No rule suggested'

    const { data: lesson, error } = await db.from('lessons').insert({
      project_id: cluster.project_id,
      cluster_id: cluster.id,
      rule_text: rule,
      summary_paragraph: cluster.summary,
      severity: 'warn',
      frequency: cluster.cluster_size,
    }).select().single()

    if (error) return c.json({ ok: false, error: error.message }, 500)

    await db.from('mistake_clusters').update({ status: 'promoted' }).eq('id', c.req.param('id'))
    return c.json({ ok: true, data: lesson })
  })

  // ─── Token-budget lessons.query ────────────────────────────────────────────
  // Called by the MCP tool and PR review context injection.
  // Accepts diff_text, returns ranked lessons packed within max_tokens.
  const querySchema = z.object({
    diff_text: z.string().max(50_000),
    max_tokens: z.number().int().min(100).max(8000).default(3000),
    project_id: z.string().uuid().optional(),
    top_k: z.number().int().min(1).max(50).default(15),
  })

  app.post('/v1/admin/lessons/query', jwtAuth, async (c) => {
    const body = querySchema.safeParse(await c.req.json())
    if (!body.success) return c.json({ ok: false, error: body.error.flatten() }, 400)

    const { diff_text, max_tokens, project_id, top_k } = body.data
    const db = getServiceClient()

    // Embed the diff text
    const openaiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openaiKey) return c.json({ ok: false, error: 'OPENAI_API_KEY not configured' }, 500)

    const embedRes = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: diff_text.slice(0, 8000) }),
    })

    if (!embedRes.ok) {
      const err = await embedRes.text()
      return c.json({ ok: false, error: `Embedding failed: ${err}` }, 500)
    }

    const embedData = await embedRes.json() as { data: Array<{ embedding: number[] }> }
    const queryEmbedding = embedData.data[0]?.embedding
    if (!queryEmbedding) return c.json({ ok: false, error: 'No embedding returned' }, 500)

    // Stage 1: bi-encoder retrieval via match_lessons RPC
    const { data: stage1 } = await db.rpc('match_lessons', {
      query_embedding: queryEmbedding,
      match_threshold: 0.60,
      match_count: top_k * 3, // over-fetch for reranking
      p_project_id: project_id ?? null,
    })

    if (!stage1?.length) return c.json({ ok: true, data: { lessons: [], tokens_used: 0 } })

    // Stage 2: score = 0.5*similarity + 0.3*severity_weight + 0.2*recency_decay
    const now = Date.now()
    const severityWeight: Record<string, number> = { critical: 1.0, warn: 0.6, info: 0.2 }

    const scored = stage1.map((lesson) => {
      const ageDays = (now - new Date(lesson.last_reinforced_at ?? now).getTime()) / (1000 * 60 * 60 * 24)
      const recencyDecay = Math.log(1 + Math.max(0, 1 / (1 + ageDays)))
      const score =
        0.5 * (lesson.similarity as number) +
        0.3 * (severityWeight[lesson.severity] ?? 0.4) +
        0.2 * recencyDecay
      return { ...lesson, final_score: score }
    })
    scored.sort((a, b) => b.final_score - a.final_score)

    // Token budget packing — estimate ~4 chars per token
    const charsPerToken = 4
    const budgetChars = max_tokens * charsPerToken
    const packed: typeof scored = []
    let totalChars = 0

    for (const lesson of scored.slice(0, top_k)) {
      const text = `[${lesson.severity.toUpperCase()}] ${lesson.rule_text}\n${lesson.anti_pattern ?? ''}\n`
      if (totalChars + text.length > budgetChars) {
        // Hierarchical fallback: drop to rule_text only
        const shortText = `[${lesson.severity.toUpperCase()}] ${lesson.rule_text}\n`
        if (totalChars + shortText.length > budgetChars) break
        totalChars += shortText.length
      } else {
        totalChars += text.length
      }
      packed.push(lesson)
    }

    return c.json({
      ok: true,
      data: {
        lessons: packed,
        tokens_used: Math.ceil(totalChars / charsPerToken),
        total_candidates: stage1.length,
      },
    })
  })

  // ─── SDK / CI sync endpoint (API-key-authenticated, read-only) ──────────
  // Used by `npx @mushi-mushi/cli sync-lessons` and Cursor MCP `lessons.query`.
  // Unlike the admin lessons endpoints (which require a Supabase user JWT),
  // this accepts the project's API key so CI pipelines and the MCP server
  // can pull lessons without requiring an interactive login.
  //
  // Security: apiKeyAuth validates the key against `project_api_keys`, so
  // only requests with a valid, active key for the exact project can read
  // that project's lessons. No cross-project access is possible.
  app.get('/v1/sync/lessons', apiKeyAuth, async (c) => {
    const db = getServiceClient()
    const projectId = c.get('projectId') as string

    if (!projectId) {
      return c.json({ ok: false, error: { code: 'MISSING_PROJECT', message: 'projectId could not be resolved from API key' } }, 400)
    }

    const limit = Math.min(parseInt(c.req.query('limit') ?? '500'), 1000)
    const severity = c.req.query('severity')

    let query = db
      .from('lessons')
      .select('id, rule_text, anti_pattern, severity, frequency, last_reinforced_at, cluster_id')
      .eq('project_id', projectId)
      .is('retired_at', null)
      .order('frequency', { ascending: false })
      .order('last_reinforced_at', { ascending: false })
      .limit(limit)

    if (severity) query = query.eq('severity', severity)

    const { data, error } = await query
    if (error) {
      return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    }

    return c.json({
      ok: true,
      data: data ?? [],
      meta: { project_id: projectId, count: (data ?? []).length, limit },
    })
  })
}
