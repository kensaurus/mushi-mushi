import type { Hono } from 'npm:hono@4';
import type { Variables } from '../types.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { jwtAuth, adminOrApiKey } from '../../_shared/auth.ts';
import { dbError, callerProjectIds, resolveOwnedProject } from '../shared.ts';

export function registerJudgeRoutes(app: Hono<{ Variables: Variables }>): void {
  // GET /v1/admin/judge/stats — posture banner + JUDGE SNAPSHOT.
  app.get('/v1/admin/judge/stats', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const empty = {
      hasAnyProject: false,
      projectId: null as string | null,
      projectName: null as string | null,
      projectCount: 0,
      totalEvaluations: 0,
      latestWeekScore: null as number | null,
      latestWeekEvalCount: 0,
      weekOverWeekDriftPct: null as number | null,
      disagreementCount: 0,
      disagreementRatePct: null as number | null,
      classifiedReports: 0,
      promptVersionCount: 0,
      activePromptCount: 0,
      lastEvalAt: null as string | null,
      staleHours: null as number | null,
      topPriority: 'no_project' as
        | 'no_project'
        | 'no_evals'
        | 'low_score'
        | 'drifting'
        | 'disagreements'
        | 'stale'
        | 'healthy',
      topPriorityLabel: null as string | null,
      topPriorityTo: null as string | null,
    };

    const projectIds = await callerProjectIds(c, db, userId);
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

    const [weekRes, evalCountRes, disagreeRes, lastEvalRes, classifiedRes, promptsRes] =
      await Promise.all([
        db.rpc('weekly_judge_scores', { p_project_id: pid, p_weeks: 2 }),
        db
          .from('classification_evaluations')
          .select('id', { count: 'exact', head: true })
          .eq('project_id', pid),
        db
          .from('classification_evaluations')
          .select('id', { count: 'exact', head: true })
          .eq('project_id', pid)
          .eq('classification_agreed', false),
        db
          .from('classification_evaluations')
          .select('created_at')
          .eq('project_id', pid)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        db
          .from('reports')
          .select('id', { count: 'exact', head: true })
          .eq('project_id', pid)
          .in('status', ['classified', 'triaged', 'grouped', 'dispatched']),
        db
          .from('prompt_versions')
          .select('id, is_active')
          .or(`project_id.is.null,project_id.eq.${pid}`)
          .limit(200),
      ]);

    const weeks = (weekRes.data ?? []) as Array<{
      week_start: string;
      avg_score: number;
      eval_count: number;
    }>;
    weeks.sort((a, b) => (a.week_start < b.week_start ? 1 : -1));
    const latest = weeks[0];
    const previous = weeks[1];

    const totalEvaluations = evalCountRes.count ?? 0;
    const disagreementCount = disagreeRes.count ?? 0;
    const classifiedReports = classifiedRes.count ?? 0;
    const prompts = promptsRes.data ?? [];
    const activePromptCount = prompts.filter((p) => p.is_active).length;

    const latestWeekScore = latest?.avg_score != null ? Number(latest.avg_score) : null;
    const latestWeekEvalCount = latest?.eval_count ?? 0;

    let weekOverWeekDriftPct: number | null = null;
    if (latest && previous && previous.avg_score > 0) {
      weekOverWeekDriftPct = Math.round(
        ((previous.avg_score - latest.avg_score) / previous.avg_score) * 100,
      );
    }

    const disagreementRatePct =
      totalEvaluations > 0
        ? Math.round((disagreementCount / totalEvaluations) * 100)
        : null;

    const lastEvalAt = lastEvalRes.data?.created_at ?? null;
    let staleHours: number | null = null;
    if (lastEvalAt) {
      staleHours = Math.floor(
        (Date.now() - new Date(lastEvalAt).getTime()) / (1000 * 60 * 60),
      );
    }

    let topPriority: typeof empty.topPriority = 'healthy';
    let topPriorityLabel: string | null = null;
    let topPriorityTo: string | null = null;
    const scoped = (path: string) =>
      `${path}${path.includes('?') ? '&' : '?'}project=${encodeURIComponent(pid)}`;

    if (totalEvaluations === 0) {
      topPriority = 'no_evals';
      topPriorityLabel =
        classifiedReports > 0
          ? `No judge scores yet — ${classifiedReports} classified report${classifiedReports === 1 ? '' : 's'} ready to grade.`
          : 'Classify a few bugs in Reports first — then run the judge.';
      topPriorityTo = classifiedReports > 0 ? scoped('/judge?action=run') : scoped('/reports?tab=queue');
    } else if (latestWeekScore != null && latestWeekScore < 0.6) {
      topPriority = 'low_score';
      topPriorityLabel = `Classifier scores are ${Math.round(latestWeekScore * 100)}% — triage quality may be wrong. Review recent evaluations or Prompt Lab.`;
      topPriorityTo = scoped('/prompt-lab?tab=prompts');
    } else if (weekOverWeekDriftPct != null && weekOverWeekDriftPct >= 5) {
      topPriority = 'drifting';
      topPriorityLabel = `Scores dropped ${weekOverWeekDriftPct}% week-over-week — review mismatches before merging fixes.`;
      topPriorityTo = scoped('/judge?tab=evaluations&filter=disagreement');
    } else if (disagreementRatePct != null && disagreementRatePct >= 20) {
      topPriority = 'disagreements';
      topPriorityLabel = `The judge disagreed with the classifier on ${disagreementRatePct}% of recent grades. Review mismatches before merging fixes.`;
      topPriorityTo = scoped('/judge?tab=evaluations&filter=disagreement');
    } else if (staleHours != null && staleHours > 72) {
      topPriority = 'stale';
      topPriorityLabel = `Last judge run was ${staleHours}h ago — run again so you know triage quality still holds.`;
      topPriorityTo = scoped('/judge?action=run');
    } else {
      topPriority = 'healthy';
      topPriorityLabel =
        latestWeekScore != null
          ? `${Math.round(latestWeekScore * 100)}% this week · ${latestWeekEvalCount} evals`
          : `${totalEvaluations} total evaluations`;
      topPriorityTo = scoped('/judge?tab=trend');
    }

    return c.json({
      ok: true,
      data: {
        hasAnyProject: true,
        projectId: pid,
        projectName: activeProject.name ?? null,
        projectCount: projectIds.length,
        totalEvaluations,
        latestWeekScore,
        latestWeekEvalCount,
        weekOverWeekDriftPct,
        disagreementCount,
        disagreementRatePct,
        classifiedReports,
        promptVersionCount: prompts.length,
        activePromptCount,
        lastEvalAt,
        staleHours,
        topPriority,
        topPriorityLabel,
        topPriorityTo,
      },
    });
  });

  // Judge scores / drift data
  app.get('/v1/admin/judge-scores', jwtAuth, async (c) => {
    // Aggregates across all owned projects so multi-project accounts see the
    // full picture, not the first project only. We call weekly_judge_scores
    // per project then bucket-merge in JS — RPC isn't variadic over project_ids.
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await callerProjectIds(c, db, userId);
    if (projectIds.length === 0) return c.json({ ok: true, data: { weeks: [] } });

    const perProject = await Promise.all(
      projectIds.map((pid) => db.rpc('weekly_judge_scores', { p_project_id: pid, p_weeks: 12 })),
    );
    const buckets = new Map<
      string,
      {
        week_start: string;
        sum_score: number;
        sum_acc: number;
        sum_sev: number;
        sum_comp: number;
        sum_repro: number;
        eval_count: number;
      }
    >();
    for (const r of perProject) {
      for (const w of r.data ?? []) {
        const key = String(w.week_start);
        const prev = buckets.get(key) ?? {
          week_start: key,
          sum_score: 0,
          sum_acc: 0,
          sum_sev: 0,
          sum_comp: 0,
          sum_repro: 0,
          eval_count: 0,
        };
        const n = Number(w.eval_count ?? 0);
        prev.sum_score += Number(w.avg_score ?? 0) * n;
        prev.sum_acc += Number(w.avg_accuracy ?? 0) * n;
        prev.sum_sev += Number(w.avg_severity ?? 0) * n;
        prev.sum_comp += Number(w.avg_component ?? 0) * n;
        prev.sum_repro += Number(w.avg_repro ?? 0) * n;
        prev.eval_count += n;
        buckets.set(key, prev);
      }
    }
    const weeks = [...buckets.values()]
      .sort((a, b) => (a.week_start < b.week_start ? 1 : -1))
      .map((b) => ({
        week_start: b.week_start,
        avg_score: b.eval_count ? b.sum_score / b.eval_count : 0,
        avg_accuracy: b.eval_count ? b.sum_acc / b.eval_count : 0,
        avg_severity: b.eval_count ? b.sum_sev / b.eval_count : 0,
        avg_component: b.eval_count ? b.sum_comp / b.eval_count : 0,
        avg_repro: b.eval_count ? b.sum_repro / b.eval_count : 0,
        eval_count: b.eval_count,
      }));
    return c.json({ ok: true, data: { weeks } });
  });

  // Per-report judge evaluations — paginated table for the Judge page.
  app.get('/v1/admin/judge/evaluations', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await callerProjectIds(c, db, userId);
    if (projectIds.length === 0) return c.json({ ok: true, data: { evaluations: [] } });

    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 50), 1), 200);
    const sort =
      c.req.query('sort') === 'score_asc'
        ? { col: 'judge_score', asc: true }
        : { col: 'created_at', asc: false };
    // Optional filter so the JudgePage leaderboard rows can drill into a
    // specific prompt version's evaluations. PageHelp
    // previously promised "click a row to see the evaluations that drove it"
    // but rows were inert. Filter is a string match on the stored prompt
    // version label (e.g. "v3-active", "v4-cand").
    const promptVersion = c.req.query('prompt_version')?.trim() || null;

    let q = db
      .from('classification_evaluations')
      .select(
        'id, report_id, project_id, judge_model, judge_score, accuracy_score, severity_score, component_score, repro_score, classification_agreed, judge_reasoning, prompt_version, created_at, judge_fallback_used',
      )
      .in('project_id', projectIds);
    if (promptVersion) q = q.eq('prompt_version', promptVersion);
    const { data, error } = await q.order(sort.col, { ascending: sort.asc }).limit(limit);
    if (error) return dbError(c, error);

    // Hydrate each row with the underlying report's human summary so the
    // Judge table can display "Submit button on /checkout has wrong size"
    // instead of "f9b3c2…" — the original UX audit called the hash-only
    // column literally unreadable for triage decisions.
    const reportIds = Array.from(
      new Set((data ?? []).map((r) => r.report_id as string).filter(Boolean)),
    );
    const summaryMap = new Map<
      string,
      {
        summary: string | null;
        description: string | null;
        severity: string | null;
        status: string | null;
      }
    >();
    if (reportIds.length > 0) {
      const { data: reportRows } = await db
        .from('reports')
        .select('id, summary, description, severity, status')
        .in('id', reportIds);
      for (const r of reportRows ?? []) {
        summaryMap.set(r.id as string, {
          summary: (r as { summary: string | null }).summary,
          description: (r as { description: string | null }).description,
          severity: (r as { severity: string | null }).severity,
          status: (r as { status: string | null }).status,
        });
      }
    }
    const enriched = (data ?? []).map((row) => {
      const meta = summaryMap.get(row.report_id as string);
      return {
        ...row,
        report_summary: meta?.summary ?? meta?.description ?? null,
        report_severity: meta?.severity ?? null,
        report_status: meta?.status ?? null,
      };
    });
    return c.json({ ok: true, data: { evaluations: enriched } });
  });

  // Score distribution histogram (bucketed into 10 deciles).
  app.get('/v1/admin/judge/distribution', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await callerProjectIds(c, db, userId);
    if (projectIds.length === 0)
      return c.json({ ok: true, data: { buckets: Array(10).fill(0), total: 0 } });

    const { data } = await db
      .from('classification_evaluations')
      .select('judge_score')
      .in('project_id', projectIds)
      .not('judge_score', 'is', null)
      .limit(2000);
    const buckets = Array(10).fill(0) as number[];
    for (const row of data ?? []) {
      const s = Math.max(0, Math.min(0.9999, Number(row.judge_score ?? 0)));
      const bin = Math.floor(s * 10);
      buckets[bin] = (buckets[bin] ?? 0) + 1;
    }
    return c.json({ ok: true, data: { buckets, total: (data ?? []).length } });
  });

  // Trigger judge-batch on demand for the user's projects (fire-and-forget).
  app.post('/v1/admin/judge/run', adminOrApiKey({ scope: 'mcp:write' }), async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await callerProjectIds(c, db, userId);
    if (projectIds.length === 0) {
      return c.json({ ok: false, error: { code: 'NO_PROJECT', message: 'No project found' } }, 404);
    }
    // Fire-and-forget per project; we don't await — the page polls or uses
    // realtime to pick up new evaluations.
    const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/judge-batch`;
    const headers = {
      Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      'Content-Type': 'application/json',
    };
    for (const pid of projectIds) {
      fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ projectId: pid, trigger: 'manual' }),
      }).catch(() => {
        /* best-effort */
      });
    }
    return c.json({ ok: true, data: { dispatched: projectIds.length } });
  });

  // Prompt-version leaderboard — joins prompt_versions with eval counts.
  app.get('/v1/admin/judge/prompts', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await callerProjectIds(c, db, userId);
    if (projectIds.length === 0) return c.json({ ok: true, data: { prompts: [] } });

    const { data } = await db
      .from('prompt_versions')
      .select(
        'id, project_id, stage, version, is_active, is_candidate, traffic_percentage, avg_judge_score, total_evaluations, created_at',
      )
      .or(`project_id.is.null,project_id.in.(${projectIds.join(',')})`)
      .order('avg_judge_score', { ascending: false, nullsFirst: false })
      .order('total_evaluations', { ascending: false })
      .limit(50);
    return c.json({ ok: true, data: { prompts: data ?? [] } });
  });

}
