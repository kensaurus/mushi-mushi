import type { Hono } from 'npm:hono@4';
import type { Variables } from '../types.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { jwtAuth } from '../../_shared/auth.ts';
import { logAudit } from '../../_shared/audit.ts';
import { callerProjectIds } from '../shared.ts';

export function registerPromptLabRoutes(app: Hono<{ Variables: Variables }>): void {
  // ============================================================
  // PROMPT LAB — manage prompt versions + view eval dataset.
  // Replaces the old "Fine-Tuning" page that nobody could complete.
  // ============================================================

  // GET /v1/admin/prompt-lab/stats — PromptLabStatusBanner posture data.
  app.get('/v1/admin/prompt-lab/stats', jwtAuth, async (c) => {
    const userId = c.get('userId') as string
    const db = getServiceClient()

    const empty = {
      hasAnyProject: false,
      projectId: null as string | null,
      projectName: null as string | null,
      projectCount: 0,
      totalPrompts: 0,
      activePrompts: 0,
      candidatePrompts: 0,
      abTestingCount: 0,
      untestedAbCount: 0,
      promoteReadyCount: 0,
      bestScore: null as number | null,
      bestStage: null as string | null,
      bestVersion: null as string | null,
      datasetTotal: 0,
      datasetLabelled: 0,
      datasetLabelPct: null as number | null,
      fineTuningPending: 0,
      topPriority: 'no_project' as
        | 'no_project' | 'no_dataset' | 'untested_ab' | 'promote_ready'
        | 'candidates_idle' | 'ab_running' | 'healthy',
      topPriorityLabel: null as string | null,
      topPriorityTo: null as string | null,
    }

    const projectIds = await callerProjectIds(c, db, userId)
    if (projectIds.length === 0) return c.json({ ok: true, data: empty })

    const projectRes = await db
      .from('projects')
      .select('id, project_name')
      .in('id', projectIds)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    const pid = projectRes.data?.id ?? projectIds[0]
    const projectName = projectRes.data?.project_name ?? null

    const [promptsRes, evalRes] = await Promise.all([
      db.from('prompt_versions')
        .select('id, stage, is_active, is_candidate, traffic_percentage, avg_judge_score')
        .or(`project_id.is.null,project_id.in.(${projectIds.join(',')})`)
        .limit(200),
      db.from('judge_results')
        .select('id, labelled_by', { count: 'exact', head: false })
        .in('project_id', projectIds)
        .limit(1000),
    ])

    const prompts = promptsRes.data ?? []
    const totalPrompts = prompts.length
    const activePrompts = prompts.filter((p) => p.is_active).length
    const candidatePrompts = prompts.filter((p) => p.is_candidate).length
    const abTestingCount = prompts.filter((p) => p.traffic_percentage !== null && p.traffic_percentage > 0 && p.traffic_percentage < 100).length
    const untestedAbCount = prompts.filter((p) => p.is_candidate && (p.avg_judge_score === null || p.avg_judge_score === 0)).length
    const promoteReadyCount = prompts.filter((p) => p.is_candidate && p.avg_judge_score !== null && p.avg_judge_score > 0.8).length

    const bestPrompt = prompts
      .filter((p) => p.avg_judge_score !== null)
      .sort((a, b) => (b.avg_judge_score ?? 0) - (a.avg_judge_score ?? 0))[0]

    const evalRows = evalRes.data ?? []
    const datasetTotal = evalRes.count ?? evalRows.length
    const datasetLabelled = evalRows.filter((r) => r.labelled_by).length
    const datasetLabelPct = datasetTotal > 0 ? Math.round((datasetLabelled / datasetTotal) * 100) : null

    let topPriority: typeof empty.topPriority = 'healthy'
    let topPriorityLabel: string | null = null
    let topPriorityTo: string | null = null
    const scoped = (path: string) =>
      `${path}${path.includes('?') ? '&' : '?'}project=${encodeURIComponent(pid)}`

    if (datasetTotal === 0) {
      topPriority = 'no_dataset'
      topPriorityLabel = 'No judge evaluations yet — run the Judge so you have scored examples to compare prompts.'
      topPriorityTo = scoped('/judge?action=run')
    } else if (untestedAbCount > 0) {
      topPriority = 'untested_ab'
      topPriorityLabel = `${untestedAbCount} candidate prompt${untestedAbCount === 1 ? '' : 's'} in A/B but not scored by the judge yet.`
      topPriorityTo = scoped('/prompt-lab?tab=prompts')
    } else if (promoteReadyCount > 0) {
      topPriority = 'promote_ready'
      topPriorityLabel = `${promoteReadyCount} candidate${promoteReadyCount === 1 ? '' : 's'} scored ≥ 80% — review and promote to production traffic.`
      topPriorityTo = scoped('/prompt-lab?tab=prompts')
    } else if (abTestingCount > 0) {
      topPriority = 'ab_running'
      topPriorityLabel = `${abTestingCount} prompt${abTestingCount === 1 ? '' : 's'} in A/B — waiting for more judge evaluations.`
      topPriorityTo = scoped('/prompt-lab?tab=prompts')
    } else if (candidatePrompts > 0) {
      topPriority = 'candidates_idle'
      topPriorityLabel = `${candidatePrompts} candidate prompt${candidatePrompts === 1 ? '' : 's'} idle — set Traffic % to start an A/B test.`
      topPriorityTo = scoped('/prompt-lab?tab=prompts')
    } else {
      topPriority = 'healthy'
      topPriorityLabel = `${activePrompts} active prompt${activePrompts === 1 ? '' : 's'} · clone a baseline to start iterating.`
      topPriorityTo = scoped('/prompt-lab')
    }

    return c.json({
      ok: true,
      data: {
        hasAnyProject: true,
        projectId: pid,
        projectName,
        projectCount: projectIds.length,
        totalPrompts,
        activePrompts,
        candidatePrompts,
        abTestingCount,
        untestedAbCount,
        promoteReadyCount,
        bestScore: bestPrompt?.avg_judge_score ?? null,
        bestStage: bestPrompt?.stage ?? null,
        bestVersion: null,
        datasetTotal,
        datasetLabelled,
        datasetLabelPct,
        fineTuningPending: 0,
        topPriority,
        topPriorityLabel,
        topPriorityTo,
      },
    })
  })

  app.get('/v1/admin/prompt-lab', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await callerProjectIds(c, db, userId);

    // Prompts: include global defaults (project_id IS NULL) + this user's own.
    // §4: also expose auto-generated metadata + parent_version_id so the
    // Prompt Lab UI can surface auto candidates and diff them against parent.
    let promptsQuery = db
      .from('prompt_versions')
      .select(
        'id, project_id, stage, version, prompt_template, is_active, is_candidate, traffic_percentage, avg_judge_score, total_evaluations, created_at, updated_at, auto_generated, auto_generation_metadata, parent_version_id',
      )
      .order('stage', { ascending: true })
      .order('version', { ascending: true })
      .limit(100);
    promptsQuery =
      projectIds.length === 0
        ? promptsQuery.is('project_id', null)
        : promptsQuery.or(`project_id.is.null,project_id.in.(${projectIds.join(',')})`);
    const { data: prompts } = await promptsQuery;

    // §2: per-prompt-version cost rollup so the Prompt Lab modal can
    // show "$ per evaluation" alongside avg judge score. Reads directly from
    // the persisted cost_usd column written by telemetry.ts.
    const promptCostByVersion = new Map<string, { totalCostUsd: number; calls: number }>();
    if (projectIds.length > 0 && (prompts ?? []).length > 0) {
      const versionList = Array.from(
        new Set((prompts ?? []).map((p) => p.version).filter(Boolean)),
      );
      if (versionList.length > 0) {
        const { data: costRows } = await db
          .from('llm_invocations')
          .select('prompt_version, cost_usd')
          .in('project_id', projectIds)
          .in('prompt_version', versionList)
          .not('cost_usd', 'is', null);
        for (const row of costRows ?? []) {
          const cur = promptCostByVersion.get(row.prompt_version) ?? { totalCostUsd: 0, calls: 0 };
          cur.totalCostUsd += Number(row.cost_usd);
          cur.calls += 1;
          promptCostByVersion.set(row.prompt_version, cur);
        }
      }
    }
    const promptsWithCost = (prompts ?? []).map((p) => {
      const agg = promptCostByVersion.get(p.version);
      return {
        ...p,
        cost_usd_total: agg ? Math.round(agg.totalCostUsd * 10000) / 10000 : 0,
        avg_cost_usd:
          agg && agg.calls > 0
            ? Math.round((agg.totalCostUsd / agg.calls) * 1000000) / 1000000
            : null,
      };
    });

    // Dataset stats — what reports could the next experiment be evaluated on?
    let totalReports = 0;
    let labelledReports = 0;
    let recentSamples: Array<{
      id: string;
      description: string;
      category: string | null;
      severity: string | null;
      component: string | null;
      created_at: string;
    }> = [];
    let fineTuningJobs: Array<{
      id: string;
      status: string;
      base_model: string | null;
      training_samples: number | null;
      created_at: string;
      project_id: string;
    }> = [];
    if (projectIds.length > 0) {
      const { count: total } = await db
        .from('reports')
        .select('id', { count: 'exact', head: true })
        .in('project_id', projectIds);
      totalReports = total ?? 0;
      const { count: labelled } = await db
        .from('reports')
        .select('id', { count: 'exact', head: true })
        .in('project_id', projectIds)
        .eq('status', 'classified')
        .not('category', 'is', null);
      labelledReports = labelled ?? 0;
      const { data: recent } = await db
        .from('reports')
        .select('id, description, category, severity, component, created_at')
        .in('project_id', projectIds)
        .eq('status', 'classified')
        .order('created_at', { ascending: false })
        .limit(8);
      recentSamples = recent ?? [];

      // Surface legacy fine-tuning jobs so operators can clean up the
      // pre-Prompt-Lab "pending" rows that are otherwise orphaned in the DB.
      const { data: ft } = await db
        .from('fine_tuning_jobs')
        .select('id, project_id, status, base_model, training_samples, created_at')
        .in('project_id', projectIds)
        .order('created_at', { ascending: false })
        .limit(20);
      fineTuningJobs = ft ?? [];
    }

    return c.json({
      ok: true,
      data: {
        prompts: promptsWithCost,
        dataset: {
          total: totalReports,
          labelled: labelledReports,
          recentSamples,
        },
        fineTuningJobs,
      },
    });
  });

  app.post('/v1/admin/prompt-lab/prompts', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const body = await c.req.json().catch(() => ({}));
    const db = getServiceClient();
    const projectIds = await callerProjectIds(c, db, userId);
    if (projectIds.length === 0) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'NO_PROJECT',
            message: 'You need at least one project to author prompts.',
          },
        },
        400,
      );
    }
    const stage = body.stage === 'stage1' || body.stage === 'stage2' ? body.stage : null;
    if (!stage)
      return c.json(
        { ok: false, error: { code: 'BAD_INPUT', message: 'stage must be stage1 or stage2' } },
        400,
      );
    const version = String(body.version ?? '').trim();
    const promptTemplate = String(body.promptTemplate ?? '').trim();
    if (!version)
      return c.json({ ok: false, error: { code: 'BAD_INPUT', message: 'version required' } }, 400);
    if (!promptTemplate)
      return c.json(
        { ok: false, error: { code: 'BAD_INPUT', message: 'promptTemplate required' } },
        400,
      );
    const projectId =
      body.projectId && projectIds.includes(body.projectId) ? body.projectId : projectIds[0];

    const { data, error } = await db
      .from('prompt_versions')
      .insert({
        project_id: projectId,
        stage,
        version,
        prompt_template: promptTemplate,
        is_candidate: true,
        is_active: false,
        traffic_percentage: Math.max(0, Math.min(100, Number(body.trafficPercentage ?? 0))),
      })
      .select('id')
      .single();
    if (error)
      return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 400);
    await logAudit(db, projectId, userId, 'settings.updated', 'prompt_version', data!.id, {
      stage,
      version,
    });
    return c.json({ ok: true, data: { id: data!.id } });
  });

  app.patch('/v1/admin/prompt-lab/prompts/:id', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const id = c.req.param('id')!;
    const body = await c.req.json().catch(() => ({}));
    const db = getServiceClient();
    const projectIds = await callerProjectIds(c, db, userId);
    if (projectIds.length === 0) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);

    const { data: existing } = await db
      .from('prompt_versions')
      .select('id, project_id, stage')
      .eq('id', id)
      .maybeSingle();
    if (!existing) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404);
    if (existing.project_id && !projectIds.includes(existing.project_id)) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
    }
    if (!existing.project_id) {
      // Global defaults are read-only from the UI to prevent shared corruption.
      return c.json(
        {
          ok: false,
          error: {
            code: 'READONLY',
            message: 'Global default prompts are read-only — clone first.',
          },
        },
        409,
      );
    }

    const updates: Record<string, unknown> = {};
    if (typeof body.promptTemplate === 'string') updates.prompt_template = body.promptTemplate;
    if (typeof body.trafficPercentage === 'number')
      updates.traffic_percentage = Math.max(0, Math.min(100, body.trafficPercentage));
    if (typeof body.isCandidate === 'boolean') updates.is_candidate = body.isCandidate;

    // Activating a prompt is exclusive: only one active per (project_id, stage).
    if (body.isActive === true) {
      await db
        .from('prompt_versions')
        .update({ is_active: false, traffic_percentage: 0 })
        .eq('project_id', existing.project_id)
        .eq('stage', existing.stage);
      updates.is_active = true;
      updates.is_candidate = false;
      if (updates.traffic_percentage == null) updates.traffic_percentage = 100;
    } else if (body.isActive === false) {
      updates.is_active = false;
    }

    const { error } = await db.from('prompt_versions').update(updates).eq('id', id);
    if (error)
      return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 400);
    await logAudit(
      db,
      existing.project_id,
      userId,
      'settings.updated',
      'prompt_version',
      id,
      updates,
    );
    return c.json({ ok: true });
  });

  app.delete('/v1/admin/prompt-lab/prompts/:id', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const id = c.req.param('id')!;
    const db = getServiceClient();
    const projectIds = await callerProjectIds(c, db, userId);
    if (projectIds.length === 0) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
    const { data: existing } = await db
      .from('prompt_versions')
      .select('id, project_id, is_active')
      .eq('id', id)
      .maybeSingle();
    if (!existing) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404);
    if (!existing.project_id) {
      return c.json(
        {
          ok: false,
          error: { code: 'READONLY', message: 'Global default prompts cannot be deleted.' },
        },
        409,
      );
    }
    if (!projectIds.includes(existing.project_id)) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
    }
    if (existing.is_active) {
      return c.json(
        { ok: false, error: { code: 'IN_USE', message: 'Deactivate before deleting.' } },
        409,
      );
    }
    const { error } = await db.from('prompt_versions').delete().eq('id', id);
    if (error)
      return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 400);
    await logAudit(
      db,
      existing.project_id,
      userId,
      'settings.updated',
      'prompt_version_delete',
      id,
      {},
    );
    return c.json({ ok: true });
  });
}
