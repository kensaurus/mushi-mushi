import type { Hono } from 'npm:hono@4';
import type { Variables } from '../types.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { jwtAuth, adminOrApiKey } from '../../_shared/auth.ts';
import { callerProjectIds, resolveOwnedProject, scopedOwnedProjectIds } from '../shared.ts';
import { attachReportTitles, bucketFailedFixPreviews } from '../../_shared/failed-fix-preview.ts';

export function registerDashboardRoutes(app: Hono<{ Variables: Variables }>): void {
  app.get('/v1/admin/stats', adminOrApiKey(), async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const projectIds = await scopedOwnedProjectIds(c, db, userId);
    if (projectIds.length === 0)
      return c.json({ ok: true, data: { total: 0, byStatus: {}, byCategory: {}, bySeverity: {} } });

    const { count: total } = await db
      .from('reports')
      .select('id', { count: 'exact', head: true })
      .in('project_id', projectIds);

    const { data: statusRows } = await db
      .rpc('count_by_column', { col: 'status', project_ids: projectIds })
      .select('*');
    const { data: categoryRows } = await db
      .rpc('count_by_column', { col: 'category', project_ids: projectIds })
      .select('*');
    const { data: severityRows } = await db
      .rpc('count_by_column', { col: 'severity', project_ids: projectIds })
      .select('*');

    const toMap = (rows: Array<{ val: string; cnt: number }> | null) =>
      Object.fromEntries((rows ?? []).map((r) => [r.val, r.cnt]));

    // Fold legacy SDK statuses (triaged, resolved, queued, …) into the
    // canonical workflow buckets the admin UI labels use — otherwise quick-
    // filter chips show "0 Classified" while 15 rows sit under `triaged`.
    const rawByStatus = toMap(statusRows);
    const byStatus: Record<string, number> = {};
    const statusAlias: Record<string, string> = {
      triaged: 'classified',
      grouped: 'classified',
      dispatched: 'classified',
      resolved: 'fixed',
      completed: 'fixed',
      pending: 'new',
      submitted: 'new',
    };
    for (const [val, cnt] of Object.entries(rawByStatus)) {
      const canon = statusAlias[val] ?? val;
      byStatus[canon] = (byStatus[canon] ?? 0) + cnt;
    }

    return c.json({
      ok: true,
      data: {
        total: total ?? 0,
        byStatus,
        byCategory: toMap(categoryRows),
        bySeverity: toMap(severityRows),
      },
    });
  });

  // Lightweight posture for the Action Inbox shell — banner, KPI strip, tabs.
  app.get('/v1/admin/inbox/stats', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const empty = {
      hasAnyProject: false,
      projectId: null as string | null,
      projectName: null as string | null,
      projectCount: 0,
      setupDone: false,
      requiredComplete: 0,
      requiredTotal: 4,
      openActions: 0,
      clearStages: 0,
      totalSurfaces: 5,
      criticalReports14d: 0,
      openBacklog: 0,
      failedFixes14d: 0,
      integrationRed: 0,
      integrationAmber: 0,
      judgeStale: false,
      judgeStaleHours: null as number | null,
      topPriorityTitle: null as string | null,
      topPriorityStage: null as string | null,
      topPriorityTo: null as string | null,
      topPriority: 'no_project' as 'no_project' | 'setup' | 'actions' | 'clear',
      topPriorityLabel: null as string | null,
      nextStepTo: '/onboarding' as string | null,
      openPlan: false,
      openDo: false,
      openCheck: false,
      openAct: false,
      openOps: false,
      lastActivityAt: null as string | null,
      lastActivityKind: null as string | null,
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

    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 13);
    since.setUTCHours(0, 0, 0, 0);
    const sinceIso = since.toISOString();
    const now = Date.now();

    const [
      reportsRes,
      fixesRes,
      healthRes,
      evalRes,
      keysRes,
      heartbeatRes,
      reportCountRes,
    ] = await Promise.all([
      db
        .from('reports')
        .select('id, status, severity, created_at')
        .in('project_id', projectIds)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false })
        .limit(500),
      db
        .from('fix_attempts')
        .select('id, status, created_at')
        .in('project_id', projectIds)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false })
        .limit(200),
      db
        .from('integration_health_history')
        .select('kind, status, checked_at')
        .in('project_id', projectIds)
        .gte('checked_at', sinceIso)
        .order('checked_at', { ascending: false })
        .limit(500),
      db
        .from('classification_evaluations')
        .select('created_at')
        .in('project_id', projectIds)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      db
        .from('project_api_keys')
        .select('id')
        .eq('project_id', activeProject.id)
        .eq('is_active', true)
        .limit(1),
      db
        .from('project_api_keys')
        .select('last_seen_at')
        .eq('project_id', activeProject.id)
        .eq('is_active', true)
        .not('last_seen_at', 'is', null)
        .order('last_seen_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      db
        .from('reports')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', activeProject.id),
    ]);

    const recentReports = reportsRes.data ?? [];
    const recentFixes = fixesRes.data ?? [];

    let criticalReports14d = 0;
    for (const r of recentReports) {
      const sev = String(r.severity ?? '').toLowerCase();
      if (sev === 'critical') criticalReports14d += 1;
    }

    const openBacklog = recentReports.filter((r) => {
      const status = String(r.status ?? '');
      if (status !== 'new' && status !== 'queued') return false;
      return now - new Date(String(r.created_at)).getTime() > 60 * 60 * 1000;
    }).length;

    const failedFixes14d = recentFixes.filter((f) => f.status === 'failed').length;

    const healthByKind = new Map<string, string>();
    for (const row of healthRes.data ?? []) {
      const kind = String(row.kind);
      if (!healthByKind.has(kind)) healthByKind.set(kind, String(row.status));
    }
    let integrationRed = 0;
    let integrationAmber = 0;
    for (const status of healthByKind.values()) {
      if (status === 'red' || status === 'fail') integrationRed += 1;
      else if (status === 'amber' || status === 'degraded') integrationAmber += 1;
    }

    const lastEvalAt = evalRes.data?.created_at ?? null;
    let judgeStaleHours: number | null = null;
    if (lastEvalAt) {
      judgeStaleHours = (now - new Date(String(lastEvalAt)).getTime()) / (60 * 60 * 1000);
    }
    const judgeStale = judgeStaleHours == null || judgeStaleHours > 48;

    const openPlan = criticalReports14d > 0;
    const openDo = failedFixes14d > 0;
    const openCheck = judgeStale;
    const openOps = integrationRed > 0 || integrationAmber > 0;
    const openAct = integrationRed > 0;

    const pid = activeProject.id as string;
    const scoped = (path: string) =>
      `${path}${path.includes('?') ? '&' : '?'}project=${encodeURIComponent(pid)}`;

    const openFlags = [
      openPlan
        ? {
            stage: 'plan',
            title: `${criticalReports14d} critical report${criticalReports14d === 1 ? '' : 's'} need triage`,
            hint: 'Confirm severity on the worst bugs first — auto-fix waits for triage.',
            to: scoped('/reports?severity=critical&status=new'),
          }
        : null,
      openDo
        ? {
            stage: 'do',
            title: `${failedFixes14d} fix attempt${failedFixes14d === 1 ? '' : 's'} failed in 14d`,
            hint: 'Open each failure, read the error, then retry or hand off to Cursor.',
            to: scoped('/fixes?status=failed'),
          }
        : null,
      openCheck
        ? {
            stage: 'check',
            title:
              judgeStaleHours == null
                ? 'No judge scores yet — run an evaluation'
                : `Judge scores are ${Math.round(judgeStaleHours)}h old`,
            hint: 'The judge audits classifier quality — run after prompt changes.',
            to: scoped('/judge?action=run'),
          }
        : null,
      openAct
        ? {
            stage: 'act',
            title: `${integrationRed} integration${integrationRed === 1 ? '' : 's'} disconnected`,
            hint: 'Fix-worker cannot ship PRs until GitHub and routing are healthy.',
            to: scoped('/integrations/config'),
          }
        : null,
      openOps
        ? integrationRed > 0
          ? {
              stage: 'ops',
              title: `${integrationRed} health probe${integrationRed === 1 ? '' : 's'} failing`,
              hint: 'Run probes in Health — degraded tools may silently drop context.',
              to: scoped('/health?status=red'),
            }
          : {
              stage: 'ops',
              title: `${integrationAmber} probe${integrationAmber === 1 ? '' : 's'} degraded`,
              hint: 'Not blocking yet — fix before the next deploy.',
              to: scoped('/health?status=amber'),
            }
        : null,
    ].filter(Boolean) as Array<{ stage: string; title: string; hint: string; to: string }>;

    const openActions = openFlags.length;
    const clearStages = 5 - openActions;
    const top = openFlags[0] ?? null;

    const hasKey = (keysRes.data ?? []).length > 0;
    const hasSdk = Boolean(heartbeatRes.data?.last_seen_at);
    const reportCount = reportCountRes.count ?? 0;
    const requiredComplete =
      1 + (hasKey ? 1 : 0) + (hasSdk ? 1 : 0) + (reportCount > 0 ? 1 : 0);
    const setupDone = requiredComplete >= 4;

    const lastReport = recentReports[0]?.created_at ?? null;
    const lastFix = recentFixes[0]?.created_at ?? null;
    let lastActivityAt: string | null = null;
    let lastActivityKind: string | null = null;
    if (lastReport && lastFix) {
      if (new Date(String(lastReport)).getTime() >= new Date(String(lastFix)).getTime()) {
        lastActivityAt = String(lastReport);
        lastActivityKind = 'report';
      } else {
        lastActivityAt = String(lastFix);
        lastActivityKind = 'fix';
      }
    } else if (lastReport) {
      lastActivityAt = String(lastReport);
      lastActivityKind = 'report';
    } else if (lastFix) {
      lastActivityAt = String(lastFix);
      lastActivityKind = 'fix';
    }

    let topPriority: 'no_project' | 'setup' | 'actions' | 'clear' = 'clear';
    let topPriorityLabel: string | null = null;
    let nextStepTo: string | null = scoped('/onboarding?tab=steps');

    if (!setupDone) {
      topPriority = 'setup';
      topPriorityLabel = `${requiredComplete} of ${4} setup steps done — finish SDK + first report before the inbox fills up.`;
      nextStepTo = scoped('/onboarding?tab=steps');
    } else if (openActions > 0 && top) {
      topPriority = 'actions';
      topPriorityLabel = top.hint;
      nextStepTo = top.to;
    } else {
      topPriority = 'clear';
      topPriorityLabel = `All ${5} PDCA stages clear — new bugs and failed fixes will appear here automatically.`;
      nextStepTo = scoped('/inbox?tab=activity');
    }

    return c.json({
      ok: true,
      data: {
        hasAnyProject: true,
        projectId: pid,
        projectName: activeProject.name,
        projectCount: projectIds.length,
        setupDone,
        requiredComplete,
        requiredTotal: 4,
        openActions,
        clearStages,
        totalSurfaces: 5,
        criticalReports14d,
        openBacklog,
        failedFixes14d,
        integrationRed,
        integrationAmber,
        judgeStale,
        judgeStaleHours,
        topPriority,
        topPriorityLabel,
        nextStepTo,
        topPriorityTitle: top?.title ?? null,
        topPriorityStage: top?.stage ?? null,
        topPriorityTo: top?.to ?? null,
        openPlan,
        openDo,
        openCheck,
        openAct,
        openOps,
        lastActivityAt,
        lastActivityKind,
      },
    });
  });

  // Lightweight posture for the dashboard shell — banner, KPI strip, tabs.
  app.get('/v1/admin/dashboard/stats', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const empty = {
      hasAnyProject: false,
      projectId: null as string | null,
      projectName: null as string | null,
      projectCount: 0,
      hasData: false,
      setupDone: false,
      requiredComplete: 0,
      requiredTotal: 4,
      openBacklog: 0,
      reports14d: 0,
      fixesInProgress: 0,
      fixesFailed: 0,
      openPrs: 0,
      llmFailures14d: 0,
      llmCalls14d: 0,
      focusStage: null as string | null,
      focusLabel: null as string | null,
      bottleneck: null as string | null,
      integrationIssues: 0,
      lastActivityAt: null as string | null,
      lastActivityKind: null as string | null,
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

    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 13);
    since.setUTCHours(0, 0, 0, 0);
    const sinceIso = since.toISOString();
    const now = Date.now();

    const [
      reportsRes,
      fixesRes,
      llmRes,
      healthRes,
      keysRes,
      heartbeatRes,
      reportCountRes,
      failedFixesRes,
    ] = await Promise.all([
      db
        .from('reports')
        .select('id, status, created_at')
        .in('project_id', projectIds)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false })
        .limit(500),
      db
        .from('fix_attempts')
        .select('id, status, created_at, pr_number')
        .in('project_id', projectIds)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false })
        .limit(200),
      db
        .from('llm_invocations')
        .select('id, status, created_at')
        .in('project_id', projectIds)
        .gte('created_at', sinceIso)
        .limit(2000),
      db
        .from('integration_health_history')
        .select('kind, status, checked_at')
        .in('project_id', projectIds)
        .gte('checked_at', sinceIso)
        .order('checked_at', { ascending: false })
        .limit(500),
      db
        .from('project_api_keys')
        .select('id')
        .eq('project_id', activeProject.id)
        .eq('is_active', true)
        .limit(1),
      db
        .from('project_api_keys')
        .select('last_seen_at')
        .eq('project_id', activeProject.id)
        .eq('is_active', true)
        .not('last_seen_at', 'is', null)
        .order('last_seen_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      db
        .from('reports')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', activeProject.id),
      db
        .from('fix_attempts')
        .select('id, project_id, report_id, error, finished_at, created_at')
        .eq('project_id', activeProject.id)
        .eq('status', 'failed')
        .order('finished_at', { ascending: false })
        .limit(10),
    ]);

    const recentReports = reportsRes.data ?? [];
    const recentFixes = fixesRes.data ?? [];
    const recentLlm = llmRes.data ?? [];
    const failedPreviewRaw = bucketFailedFixPreviews(
      (failedFixesRes.data ?? []) as Array<{
        id: string
        project_id: string
        report_id: string
        error?: string | null
        finished_at?: string | null
        created_at?: string | null
      }>,
    )[activeProject.id] ?? [];
    // deno-ts-ignore is not needed; cast breaks the deep Supabase generic
    // instantiation that causes TS2589 when the full SupabaseClient type is
    // traversed to verify the narrow structural parameter type.
    const failedFixesPreview = await attachReportTitles(
      db as unknown as Parameters<typeof attachReportTitles>[0],
      failedPreviewRaw.slice(0, 3),
    );

    const openBacklog = recentReports.filter((r) => {
      const status = String(r.status ?? '');
      if (status !== 'new' && status !== 'queued') return false;
      return now - new Date(String(r.created_at)).getTime() > 60 * 60 * 1000;
    }).length;

    const fixesInProgress = recentFixes.filter(
      (f) => f.status === 'queued' || f.status === 'running',
    ).length;
    const fixesFailed = recentFixes.filter((f) => f.status === 'failed').length;
    const openPrs = recentFixes.filter(
      (f) => f.pr_number != null && f.status === 'completed',
    ).length;

    let llmCalls14d = 0;
    let llmFailures14d = 0;
    for (const inv of recentLlm) {
      llmCalls14d += 1;
      if (inv.status !== 'success') llmFailures14d += 1;
    }

    const healthByKind = new Map<string, string>();
    for (const row of healthRes.data ?? []) {
      const kind = String(row.kind);
      if (!healthByKind.has(kind)) healthByKind.set(kind, String(row.status));
    }
    const integrationIssues = [...healthByKind.values()].filter(
      (s) => s && s !== 'ok',
    ).length;

    const hasKey = (keysRes.data ?? []).length > 0;
    const hasSdk = Boolean(heartbeatRes.data?.last_seen_at);
    const reportCount = reportCountRes.count ?? 0;
    const requiredComplete =
      1 +
      (hasKey ? 1 : 0) +
      (hasSdk ? 1 : 0) +
      (reportCount > 0 ? 1 : 0);
    const setupDone = requiredComplete >= 4;

    let focusStage: string | null = null;
    let focusLabel: string | null = null;
    let bottleneck: string | null = null;
    if (openBacklog > 0) {
      focusStage = 'plan';
      focusLabel = 'Plan';
      bottleneck = `${openBacklog} report${openBacklog === 1 ? '' : 's'} waiting > 1h to triage`;
    } else if (fixesFailed > 0) {
      focusStage = 'do';
      focusLabel = 'Do';
      bottleneck = `${fixesFailed} failed fix${fixesFailed === 1 ? '' : 'es'} need retry`;
    } else if (integrationIssues > 0) {
      focusStage = 'act';
      focusLabel = 'Act';
      bottleneck = `${integrationIssues} integration${integrationIssues === 1 ? '' : 's'} failing health checks`;
    } else if (llmFailures14d > 0) {
      focusStage = 'check';
      focusLabel = 'Check';
      bottleneck = `${llmFailures14d} LLM failure${llmFailures14d === 1 ? '' : 's'} in 14d`;
    }

    const lastReport = recentReports[0]?.created_at ?? null;
    const lastFix = recentFixes[0]?.created_at ?? null;
    let lastActivityAt: string | null = null;
    let lastActivityKind: string | null = null;
    if (lastReport && lastFix) {
      if (new Date(String(lastReport)).getTime() >= new Date(String(lastFix)).getTime()) {
        lastActivityAt = String(lastReport);
        lastActivityKind = 'report';
      } else {
        lastActivityAt = String(lastFix);
        lastActivityKind = 'fix';
      }
    } else if (lastReport) {
      lastActivityAt = String(lastReport);
      lastActivityKind = 'report';
    } else if (lastFix) {
      lastActivityAt = String(lastFix);
      lastActivityKind = 'fix';
    }

    const pid = activeProject.id;
    let topPriority:
      | 'setup'
      | 'backlog'
      | 'fixes_failed'
      | 'integrations'
      | 'waiting_data'
      | 'healthy' = 'healthy';
    let topPriorityLabel: string | null = null;
    let topPriorityTo: string | null = null;

    if (!setupDone) {
      topPriority = 'setup';
      topPriorityLabel =
        'Finish project, API key, SDK install, and first report before the loop metrics unlock.';
      topPriorityTo = `/onboarding?tab=steps&project=${encodeURIComponent(pid)}`;
    } else if (openBacklog > 0) {
      topPriority = 'backlog';
      topPriorityLabel = `${openBacklog} report${openBacklog === 1 ? '' : 's'} waiting over an hour — triage the oldest first.`;
      topPriorityTo = `/reports?tab=queue&status=new&project=${encodeURIComponent(pid)}`;
    } else if (fixesFailed > 0) {
      topPriority = 'fixes_failed';
      topPriorityLabel =
        'The fix agent could not finish these runs — open each failure, read the error, then retry.';
      topPriorityTo = `/fixes?status=failed&project=${encodeURIComponent(pid)}`;
    } else if (integrationIssues > 0) {
      topPriority = 'integrations';
      topPriorityLabel = `${integrationIssues} integration${integrationIssues === 1 ? '' : 's'} failing — fixes may not reach GitHub until connections recover.`;
      topPriorityTo = `/integrations/config?project=${encodeURIComponent(pid)}`;
    } else if (!hasSdk && reportCount === 0) {
      topPriority = 'waiting_data';
      topPriorityLabel = 'Send a test report from Setup — charts populate once ingest is live.';
      topPriorityTo = `/onboarding?tab=verify&project=${encodeURIComponent(pid)}`;
    } else {
      topPriorityLabel = `${projectIds.length > 1 ? `${projectIds.length} projects · ` : ''}loop healthy.`;
      topPriorityTo = `/dashboard?project=${encodeURIComponent(pid)}`;
    }

    return c.json({
      ok: true,
      data: {
        hasAnyProject: true,
        projectId: activeProject.id,
        projectName: activeProject.name,
        projectCount: projectIds.length,
        hasData: recentReports.length > 0 || recentFixes.length > 0,
        setupDone,
        requiredComplete,
        requiredTotal: 4,
        openBacklog,
        reports14d: recentReports.length,
        fixesInProgress,
        fixesFailed,
        openPrs,
        llmFailures14d,
        llmCalls14d,
        focusStage,
        focusLabel,
        bottleneck,
        integrationIssues,
        lastActivityAt,
        lastActivityKind,
        topPriority,
        topPriorityLabel,
        topPriorityTo,
        failed_fixes_preview: failedFixesPreview,
      },
    });
  });

  // Richer dashboard data: 14-day trends, fix pipeline state, LLM cost,
  // triage backlog, top components, and recent activity. Powers the rebuilt
  // DashboardPage. Single round-trip so the page hydrates quickly without N
  // chained requests.
  app.get('/v1/admin/dashboard', adminOrApiKey(), async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    // Teams v1: dashboard shows every project the caller can access (owner
    // OR org member). The project name list is also returned to the FE so
    // the dashboard can render per-project breakouts — fetch both shapes.
    const projectIds = await callerProjectIds(c, db, userId);
    if (projectIds.length === 0) {
      return c.json({ ok: true, data: { empty: true } });
    }
    const { data: projects } = await db
      .from('projects')
      .select('id, name')
      .in('id', projectIds);

    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 13);
    since.setUTCHours(0, 0, 0, 0);
    const sinceIso = since.toISOString();

    // Reports — richer slice for triage backlog, top components, trend
    const { data: recentReports } = await db
      .from('reports')
      .select(
        'id, project_id, summary, description, status, severity, category, component, created_at, stage1_latency_ms, stage2_latency_ms',
      )
      .in('project_id', projectIds)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(500);

    // Fix attempts — for the auto-fix pipeline tile
    const { data: recentFixes } = await db
      .from('fix_attempts')
      .select(
        'id, report_id, project_id, status, agent, pr_url, pr_number, llm_model, llm_input_tokens, llm_output_tokens, started_at, completed_at, created_at',
      )
      .in('project_id', projectIds)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(100);

    // LLM invocations — for cost / latency trend
    const { data: recentLlm } = await db
      .from('llm_invocations')
      .select(
        'id, project_id, function_name, used_model, status, latency_ms, input_tokens, output_tokens, created_at, key_source',
      )
      .in('project_id', projectIds)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(2000);

    // Integration health — last 14 days, used to render a global "platform health" sparkline
    const { data: healthRows } = await db
      .from('integration_health_history')
      .select('kind, status, latency_ms, checked_at')
      .in('project_id', projectIds)
      .gte('checked_at', sinceIso)
      .order('checked_at', { ascending: true })
      .limit(2000);

    // Classification evals (judge) — last 14 days. Powers the Check stage of
    // the PDCA cockpit: how often does the LLM classifier agree with the
    // independent grader?
    const { data: recentEvals } = await db
      .from('classification_evaluations')
      .select('id, report_id, judge_score, classification_agreed, created_at')
      .in('project_id', projectIds)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(500);

    // Bucket helpers
    const dayKey = (iso: string) => iso.slice(0, 10);
    const days: string[] = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(since);
      d.setUTCDate(since.getUTCDate() + i);
      days.push(d.toISOString().slice(0, 10));
    }

    // Per-day report intake by severity (for stacked sparkline)
    const reportsByDay: Record<
      string,
      {
        total: number;
        critical: number;
        high: number;
        medium: number;
        low: number;
        unscored: number;
      }
    > = {};
    for (const d of days)
      reportsByDay[d] = { total: 0, critical: 0, high: 0, medium: 0, low: 0, unscored: 0 };
    for (const r of recentReports ?? []) {
      const d = dayKey(String(r.created_at));
      if (!reportsByDay[d]) continue;
      const bucket = reportsByDay[d];
      bucket.total++;
      const sev = (r.severity ?? '').toLowerCase();
      if (sev === 'critical' || sev === 'high' || sev === 'medium' || sev === 'low') {
        bucket[sev as 'critical' | 'high' | 'medium' | 'low']++;
      } else {
        bucket.unscored++;
      }
    }

    // Per-day LLM cost (token-based proxy: input + output tokens / 1k)
    const llmByDay: Record<
      string,
      { calls: number; tokens: number; latencyMs: number; failures: number }
    > = {};
    for (const d of days) llmByDay[d] = { calls: 0, tokens: 0, latencyMs: 0, failures: 0 };
    let totalTokens = 0;
    let totalLlmCalls = 0;
    let totalLlmFailures = 0;
    for (const inv of recentLlm ?? []) {
      const d = dayKey(String(inv.created_at));
      if (!llmByDay[d]) continue;
      llmByDay[d].calls++;
      const tok = (inv.input_tokens ?? 0) + (inv.output_tokens ?? 0);
      llmByDay[d].tokens += tok;
      llmByDay[d].latencyMs += inv.latency_ms ?? 0;
      if (inv.status !== 'success') llmByDay[d].failures++;
      totalTokens += tok;
      totalLlmCalls++;
      if (inv.status !== 'success') totalLlmFailures++;
    }

    // Triage SLA — mean minutes from created_at -> first stage classification
    // (proxied as stage2_latency_ms presence). For "open" backlog, count anything
    // still status='new' or 'queued' beyond 1h.
    const now = Date.now();
    const openBacklog = (recentReports ?? []).filter((r) => {
      const status = String(r.status ?? '');
      if (status !== 'new' && status !== 'queued') return false;
      return now - new Date(String(r.created_at)).getTime() > 60 * 60 * 1000;
    }).length;

    // Top components by report count
    const componentCounts = new Map<string, number>();
    for (const r of recentReports ?? []) {
      const comp = (r.component ?? '').trim();
      if (!comp) continue;
      componentCounts.set(comp, (componentCounts.get(comp) ?? 0) + 1);
    }
    const topComponents = [...componentCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([component, count]) => ({ component, count }));

    // Auto-fix pipeline summary
    const fixSummary = {
      total: (recentFixes ?? []).length,
      completed: (recentFixes ?? []).filter((f) => f.status === 'completed').length,
      failed: (recentFixes ?? []).filter((f) => f.status === 'failed').length,
      inProgress: (recentFixes ?? []).filter((f) => f.status === 'queued' || f.status === 'running')
        .length,
      openPrs: (recentFixes ?? []).filter((f) => f.pr_number != null && f.status === 'completed')
        .length,
    };

    // Triage queue — top 5 most recent reports needing attention
    const triageQueue = (recentReports ?? [])
      .filter((r) => {
        const s = String(r.status ?? '');
        return (
          s === 'new' ||
          s === 'queued' ||
          s === 'classified' ||
          s === 'triaged' ||
          s === 'grouped'
        );
      })
      .slice(0, 5)
      .map((r) => ({
        id: r.id,
        summary: r.summary ?? r.description?.slice(0, 140) ?? '(no summary)',
        severity: r.severity,
        category: r.category,
        status: r.status,
        created_at: r.created_at,
      }));

    // Recent activity — last 8 events across reports + fixes
    const activity = [
      ...(recentReports ?? []).slice(0, 6).map((r) => ({
        kind: 'report' as const,
        id: r.id,
        label: r.summary ?? r.description?.slice(0, 100) ?? '(no summary)',
        meta: r.severity ?? r.category ?? r.status,
        at: r.created_at,
      })),
      ...(recentFixes ?? []).slice(0, 4).map((f) => ({
        kind: 'fix' as const,
        // Use the fix attempt's own ID, not report_id — multiple attempts can
        // share the same report_id and would produce duplicate React keys.
        id: f.id,
        label: `Auto-fix ${f.status}`,
        meta: f.llm_model ?? f.agent ?? null,
        at: f.created_at,
      })),
    ]
      .sort((a, b) => new Date(String(b.at)).getTime() - new Date(String(a.at)).getTime())
      .slice(0, 8);

    // Integration health — group by kind, derive last status + uptime ratio
    const healthByKind = new Map<
      string,
      { last: string | null; lastAt: string | null; ok: number; total: number }
    >();
    for (const row of healthRows ?? []) {
      const k = String(row.kind);
      if (!healthByKind.has(k)) healthByKind.set(k, { last: null, lastAt: null, ok: 0, total: 0 });
      const entry = healthByKind.get(k)!;
      entry.total++;
      if (row.status === 'ok') entry.ok++;
      entry.last = String(row.status);
      entry.lastAt = String(row.checked_at);
    }
    const integrations = [...healthByKind.entries()].map(([kind, v]) => ({
      kind,
      lastStatus: v.last,
      lastAt: v.lastAt,
      uptime: v.total > 0 ? v.ok / v.total : null,
    }));

    // ---------------------------------------------------------------------------
    // PDCA Cockpit — four-stage strip rendered at the top of the dashboard.
    // Each stage exposes one headline number, a "current bottleneck" caption,
    // and a deep-link CTA so the user always sees "→ where do I act now?"
    // ---------------------------------------------------------------------------
    type StageTone = 'ok' | 'warn' | 'urgent';
    interface PdcaStage {
      id: 'plan' | 'do' | 'check' | 'act';
      label: string;
      icon: string;
      description: string;
      count: number;
      countLabel: string;
      bottleneck: string | null;
      tone: StageTone;
      cta: { to: string; label: string };
      /** Optional 7-day momentum series (oldest → newest). Rendered as a tiny
       *  spark in the cockpit header so each tile shows whether it's trending
       *  up, settling, or holding. Round 2 polish — added per audit
       *  POLISH-BACKLOG.md "PdcaCockpit micro-trend" item. */
      series?: number[];
    }

    // 7-day series for each PDCA stage. Reused across the four stage builders
    // so we only walk the recentReports / recentFixes / recentEvals arrays once.
    const last7Days: string[] = [];
    for (let i = 6; i >= 0; i--) {
      last7Days.push(new Date(now - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
    }
    const last7Index = new Map(last7Days.map((d, i) => [d, i]));
    const planSeries7d = new Array(7).fill(0) as number[];
    const doSeries7d = new Array(7).fill(0) as number[];
    const checkSeries7d = new Array(7).fill(0) as number[];
    for (const r of recentReports ?? []) {
      const i = last7Index.get(String(r.created_at).slice(0, 10));
      if (i !== undefined) planSeries7d[i] += 1;
    }
    for (const f of recentFixes ?? []) {
      const i = last7Index.get(String(f.created_at).slice(0, 10));
      if (i !== undefined) doSeries7d[i] += 1;
    }
    for (const e of recentEvals ?? []) {
      // recentEvals rows expose `created_at`; fall back to evaluated_at if the
      // row pre-dates the schema change.
      const ts = String(
        (e as { created_at?: string; evaluated_at?: string }).created_at ??
          (e as { evaluated_at?: string }).evaluated_at ??
          '',
      ).slice(0, 10);
      const i = last7Index.get(ts);
      if (i !== undefined) checkSeries7d[i] += 1;
    }

    // Plan: open reports waiting > 1h (already computed as `openBacklog`).
    const oldestNewMs = (recentReports ?? [])
      .filter((r) => r.status === 'new' || r.status === 'queued')
      .reduce<number>((min, r) => {
        const t = new Date(String(r.created_at)).getTime();
        return Math.min(min, t);
      }, Number.POSITIVE_INFINITY);
    const oldestNewHours = Number.isFinite(oldestNewMs)
      ? Math.floor((now - oldestNewMs) / 3_600_000)
      : 0;
    const planTone: StageTone = openBacklog > 5 ? 'urgent' : openBacklog > 0 ? 'warn' : 'ok';
    const planStage: PdcaStage = {
      id: 'plan',
      label: 'Plan',
      icon: 'inbox',
      description: 'Capture & classify',
      count: openBacklog,
      countLabel: openBacklog === 1 ? 'report waiting > 1h' : 'reports waiting > 1h',
      bottleneck:
        openBacklog > 0 && oldestNewHours > 0
          ? `Oldest report has been waiting ${oldestNewHours}h to triage`
          : null,
      tone: planTone,
      cta: { to: '/reports?status=new', label: 'Triage queue' },
      series: planSeries7d,
    };

    // Do: fixes in progress + failed = the active dispatch surface area.
    const doCount = fixSummary.inProgress + fixSummary.failed;
    const doTone: StageTone =
      fixSummary.failed > 0 ? 'urgent' : fixSummary.inProgress > 0 ? 'warn' : 'ok';
    const doStage: PdcaStage = {
      id: 'do',
      label: 'Do',
      icon: 'wrench',
      description: 'Dispatch fixes',
      count: doCount,
      countLabel: doCount === 1 ? 'fix in flight' : 'fixes in flight',
      bottleneck:
        fixSummary.failed > 0
          ? `${fixSummary.failed} failed ${fixSummary.failed === 1 ? 'fix needs' : 'fixes need'} retry`
          : null,
      tone: doTone,
      cta: { to: '/fixes', label: 'Open Fixes' },
      series: doSeries7d,
    };

    // Check: pending evals = classified reports without a judge_evaluated_at,
    // capped to the 14-day window we already pulled.
    const evaluatedReportIds = new Set((recentEvals ?? []).map((e) => e.report_id));
    const pendingEvals = (recentReports ?? []).filter((r) => {
      if (r.status !== 'classified' && r.status !== 'fixed') return false;
      return !evaluatedReportIds.has(r.id);
    }).length;
    const disagreements = (recentEvals ?? []).filter(
      (e) => e.classification_agreed === false,
    ).length;
    const checkTone: StageTone = disagreements > 3 ? 'urgent' : pendingEvals > 10 ? 'warn' : 'ok';
    const checkStage: PdcaStage = {
      id: 'check',
      label: 'Check',
      icon: 'magnifier',
      description: 'Verify quality',
      count: pendingEvals,
      countLabel: pendingEvals === 1 ? 'eval pending' : 'evals pending',
      bottleneck:
        disagreements > 0
          ? `${disagreements} ${disagreements === 1 ? 'disagreement' : 'disagreements'} between LLM and judge`
          : null,
      tone: checkTone,
      cta: { to: '/judge', label: 'Open Judge' },
      series: checkSeries7d,
    };

    // Act: integration destinations live + healthy.
    const liveIntegrations = integrations.filter((i) => i.lastStatus === 'ok').length;
    const failingIntegrations = integrations.filter(
      (i) => i.lastStatus && i.lastStatus !== 'ok',
    ).length;
    const actTone: StageTone =
      failingIntegrations > 0 ? 'urgent' : liveIntegrations === 0 ? 'warn' : 'ok';
    const actStage: PdcaStage = {
      id: 'act',
      label: 'Act',
      icon: 'plug',
      description: 'Integrate & scale',
      count: liveIntegrations,
      countLabel: liveIntegrations === 1 ? 'destination live' : 'destinations live',
      bottleneck:
        failingIntegrations > 0
          ? `${failingIntegrations} ${failingIntegrations === 1 ? 'integration is' : 'integrations are'} failing health checks`
          : liveIntegrations === 0
            ? 'No destinations connected — fixes have nowhere to land'
            : null,
      tone: actTone,
      cta: { to: '/integrations', label: 'Open Integrations' },
    };

    const pdcaStages: PdcaStage[] = [planStage, doStage, checkStage, actStage];
    // "Current focus" = the most-urgent stage, falling back to highest-count
    // warn stage so a quiet system still nudges the user forward.
    const focusStage =
      pdcaStages.find((s) => s.tone === 'urgent')?.id ??
      pdcaStages.filter((s) => s.tone === 'warn').sort((a, b) => b.count - a.count)[0]?.id ??
      null;

    return c.json({
      ok: true,
      data: {
        empty: false,
        projects: (projects ?? []).map((p) => ({ id: p.id, name: p.name })),
        window: { days, since: sinceIso },
        counts: {
          reports14d: (recentReports ?? []).length,
          openBacklog,
          fixesTotal: fixSummary.total,
          openPrs: fixSummary.openPrs,
          llmCalls14d: totalLlmCalls,
          llmTokens14d: totalTokens,
          llmFailures14d: totalLlmFailures,
        },
        reportsByDay: days.map((d) => ({ day: d, ...reportsByDay[d] })),
        llmByDay: days.map((d) => ({ day: d, ...llmByDay[d] })),
        fixSummary,
        topComponents,
        triageQueue,
        activity,
        integrations,
        pdcaStages,
        focusStage,
      },
    });
  });

  // ─── GET /v1/admin/activity ────────────────────────────────────────────────
  // Per-project activity dashboard powered by the project_activity_summary RPC.
  // Query param: ?window=30 (days, default 30, max 90).
  app.get('/v1/admin/activity', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const resolvedProject = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () =>
        c.json({ ok: false, error: { code: 'NO_PROJECT', message: 'No project found for this account' } }, 404),
    });
    if ('response' in resolvedProject) return resolvedProject.response;
    const projectId = resolvedProject.project.id as string;

    const windowDays = Math.min(90, Math.max(1, parseInt(c.req.query('window') ?? '30', 10) || 30));

    const { data, error } = await db.rpc('project_activity_summary', {
      p_project_id: projectId,
      p_window_days: windowDays,
    });
    if (error) return c.json({ ok: false, error: { code: 'RPC_ERROR', message: error.message } }, 500);

    return c.json({ ok: true, data });
  });

  // ─── GET /v1/admin/portfolio ───────────────────────────────────────────────
  // Org-scoped portfolio summary for the Overview page.
  // Returns one card per project with 7-day sessions/users/reports + sparkline.
  app.get('/v1/admin/portfolio', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    // Resolve the active org from context (x-org-id header set by apiFetch).
    const orgId = c.req.header('x-org-id') ?? c.get('orgId') as string | undefined;
    if (!orgId) return c.json({ ok: false, error: { code: 'NO_ORG', message: 'x-org-id header required' } }, 400);

    // Verify the caller is a member of this org.
    const { data: membership, error: memErr } = await db
      .from('organization_members')
      .select('role')
      .eq('organization_id', orgId)
      .eq('user_id', userId)
      .maybeSingle();
    if (memErr || !membership) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Not a member of this organisation' } }, 403);
    }

    const { data, error } = await db.rpc('org_portfolio_summary', { p_org_id: orgId });
    if (error) return c.json({ ok: false, error: { code: 'RPC_ERROR', message: error.message } }, 500);

    return c.json({ ok: true, data: data ?? [] });
  });

}
