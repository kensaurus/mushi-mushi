import type { Hono } from 'npm:hono@4';
import type { Variables } from '../types.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { jwtAuth, adminOrApiKey, getOrgIdFromContext } from '../../_shared/auth.ts';
import {
  callerProjectIds,
  resolveOwnedProject,
  scopedOwnedProjectIds,
  rpcError,
  dbError,
  OPEN_REPORT_STATUSES,
  TRIAGE_BACKLOG_STATUSES,
} from '../shared.ts';
import { summarizeFixTruths } from '../../_shared/fix-report-truth.ts';
import { failedFixPreviews, loadRecentFixTruths } from '../../_shared/fix-report-truth-load.ts';
import { JUDGE_ELIGIBLE_STATUSES, isJudgeStale } from '../../_shared/judge-eligibility.ts';
import { reportWindowStartIso } from '../../_shared/report-list-filters.ts';
import {
  IntegrationHealthReadError,
  countHealthIssues,
  loadIntegrationHealth,
  summarizeHealthByKind,
} from '../../_shared/integration-health-rollup.ts';

/** Activity-feed line for one fix attempt, read against its report's current state. */
function fixActivityLabel(
  f: { status?: string | null; pr_number?: number | null; pr_state?: string | null; merged_at?: string | null },
  reportMergedPr: number | null,
): string {
  const status = String(f.status ?? '').toLowerCase();
  if (f.merged_at || f.pr_state === 'merged') {
    return f.pr_number != null ? `Fix merged — PR #${f.pr_number}` : 'Fix merged';
  }
  if (reportMergedPr != null) return `Earlier attempt — superseded by PR #${reportMergedPr}`;
  if (status === 'queued' || status === 'running' || status === 'pending') return 'Auto-fix running';
  if (status === 'failed' || status.startsWith('skipped')) return 'Auto-fix attempt stopped';
  if (f.pr_state === 'closed') return f.pr_number != null ? `Fix PR #${f.pr_number} closed without merge` : 'Fix PR closed';
  if (f.pr_number != null) return `Fix PR #${f.pr_number} opened`;
  return `Auto-fix ${status || 'recorded'}`;
}

type DashDb = ReturnType<typeof getServiceClient>;
type ReadError = { message?: string; code?: string; details?: string | null; hint?: string | null };

/** A dashboard read failed: answer with an error, never with a 0 that reads as "all clear". */
class DashboardReadError extends Error {
  constructor(
    readonly what: string,
    readonly readError: ReadError | null | undefined,
  ) {
    super(`${what}: ${readError?.message ?? 'read failed'}`);
    this.name = 'DashboardReadError';
  }
}

async function exactCount(
  what: string,
  query: PromiseLike<{ count: number | null; error: ReadError | null }>,
): Promise<number> {
  const { count, error } = await query;
  if (error) throw new DashboardReadError(what, error);
  return count ?? 0;
}

async function rowsOf<T>(
  what: string,
  query: PromiseLike<{ data: T[] | null; error: ReadError | null }>,
): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw new DashboardReadError(what, error);
  return data ?? [];
}


/**
 * The triage backlog: every report still in the `new` bucket, any age —
 * exactly what `/reports?status=new` lists. One definition for the
 * dashboard KPI, the Plan stage, dashboard/stats and inbox/stats.
 */
function triageBacklogCount(db: DashDb, projectIds: string[]): Promise<number> {
  return exactCount(
    'triage backlog',
    db
      .from('reports')
      .select('id', { count: 'exact', head: true })
      .in('project_id', projectIds)
      .in('status', [...TRIAGE_BACKLOG_STATUSES]),
  );
}

/** Reports judge-batch would grade now — the Check stage and the inbox Check flag. */
function ungradedReportCount(db: DashDb, projectIds: string[]): Promise<number> {
  return exactCount(
    'ungraded reports',
    db
      .from('reports')
      .select('id', { count: 'exact', head: true })
      .in('project_id', projectIds)
      .in('status', [...JUDGE_ELIGIBLE_STATUSES])
      .is('judge_evaluated_at', null),
  );
}

async function newestCreatedAt(
  what: string,
  query: PromiseLike<{ data: Array<{ created_at: string | null }> | null; error: ReadError | null }>,
): Promise<string | null> {
  const rows = await rowsOf(what, query);
  return rows[0]?.created_at ?? null;
}

function latestActivity(
  lastReport: string | null,
  lastFix: string | null,
): { lastActivityAt: string | null; lastActivityKind: 'report' | 'fix' | null } {
  if (lastReport && lastFix) {
    return Date.parse(lastReport) >= Date.parse(lastFix)
      ? { lastActivityAt: lastReport, lastActivityKind: 'report' }
      : { lastActivityAt: lastFix, lastActivityKind: 'fix' };
  }
  if (lastReport) return { lastActivityAt: lastReport, lastActivityKind: 'report' };
  if (lastFix) return { lastActivityAt: lastFix, lastActivityKind: 'fix' };
  return { lastActivityAt: null, lastActivityKind: null };
}

function dashboardReadFailed(
  c: Parameters<typeof dbError>[0],
  err: unknown,
): Response {
  if (err instanceof DashboardReadError) return dbError(c, err.readError ?? { message: err.message });
  if (err instanceof IntegrationHealthReadError) return dbError(c, { message: err.message, code: err.code });
  throw err;
}

/** Rows kept for the 14-day charts; the headline counts are exact counts. */
const CHART_ROW_CAP = 5000;

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
    // Count for the Reports page's "Open" chip (status=open). Kept out of
    // byStatus: it overlaps the per-status buckets rather than adding one.
    const openCount = OPEN_REPORT_STATUSES.reduce(
      (sum, s) => sum + (Number(rawByStatus[s]) || 0),
      0,
    );

    return c.json({
      ok: true,
      data: {
        total: total ?? 0,
        openCount,
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
      criticalUntriaged: 0,
      openBacklog: 0,
      failedFixes14d: 0,
      urgentOpenReports: 0,
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

    const sinceIso = reportWindowStartIso(14);
    const now = Date.now();

    let reads: {
      criticalReports14d: number;
      criticalUntriaged: number;
      openBacklog: number;
      urgentOpenReports: number;
      ungradedReports: number;
      lastEvalAt: string | null;
      hasKey: boolean;
      hasSdk: boolean;
      reportCount: number;
      lastReport: string | null;
      lastFix: string | null;
      integrationRed: number;
      integrationAmber: number;
      failedFixes14d: number;
    };
    try {
      const [
        criticalReports14d,
        criticalUntriaged,
        openBacklog,
        urgentOpenReports,
        ungradedReports,
        lastEvalAt,
        keyRows,
        heartbeatRows,
        reportCount,
        lastReport,
        lastFix,
        health,
        fixTruths,
      ] = await Promise.all([
        // The inbox "Critical 14d" tile: critical reports from the window that
        // still need a decision. Same predicate as its link
        // (status=open&severity=critical&days=14); fixed and dismissed ones
        // used to count, so inbox zero was unreachable for 14 days.
        exactCount(
          'critical reports 14d',
          db
            .from('reports')
            .select('id', { count: 'exact', head: true })
            .in('project_id', projectIds)
            .eq('severity', 'critical')
            .in('status', [...OPEN_REPORT_STATUSES])
            .gte('created_at', sinceIso),
        ),
        // The Plan flag: critical reports still waiting for triage, any age —
        // exactly what its link `/reports?severity=critical&status=new` lists.
        exactCount(
          'critical untriaged',
          db
            .from('reports')
            .select('id', { count: 'exact', head: true })
            .in('project_id', projectIds)
            .eq('severity', 'critical')
            .in('status', [...TRIAGE_BACKLOG_STATUSES]),
        ),
        triageBacklogCount(db, projectIds),
        // Critical/high reports still waiting on a decision, any age — the
        // "next best action" strip needs current, unfixed work.
        exactCount(
          'urgent open reports',
          db
            .from('reports')
            .select('id', { count: 'exact', head: true })
            .eq('project_id', activeProject.id)
            .in('severity', ['critical', 'high'])
            .in('status', [...OPEN_REPORT_STATUSES]),
        ),
        // What judge-batch would grade right now, scoped like the last-eval read.
        ungradedReportCount(db, projectIds),
        newestCreatedAt(
          'last judge evaluation',
          db
            .from('classification_evaluations')
            .select('created_at')
            .in('project_id', projectIds)
            .order('created_at', { ascending: false })
            .limit(1),
        ),
        rowsOf(
          'api keys',
          db.from('project_api_keys').select('id').eq('project_id', activeProject.id).eq('is_active', true).limit(1),
        ),
        rowsOf(
          'sdk heartbeat',
          db
            .from('project_api_keys')
            .select('last_seen_at')
            .eq('project_id', activeProject.id)
            .eq('is_active', true)
            .not('last_seen_at', 'is', null)
            .limit(1),
        ),
        exactCount(
          'report count',
          db.from('reports').select('id', { count: 'exact', head: true }).eq('project_id', activeProject.id),
        ),
        newestCreatedAt(
          'latest report',
          db
            .from('reports')
            .select('created_at')
            .in('project_id', projectIds)
            .gte('created_at', sinceIso)
            .order('created_at', { ascending: false })
            .limit(1),
        ),
        newestCreatedAt(
          'latest fix attempt',
          db
            .from('fix_attempts')
            .select('created_at')
            .in('project_id', projectIds)
            .gte('created_at', sinceIso)
            .order('created_at', { ascending: false })
            .limit(1),
        ),
        loadIntegrationHealth(db as unknown as Parameters<typeof loadIntegrationHealth>[0], projectIds, sinceIso),
        // Per REPORT from its current state: earlier failed attempts on a report
        // a merged PR fixed are history, not work (fix-report-truth.ts). Same
        // 30-day report window as every other fix count (fix-report-truth-load.ts).
        loadRecentFixTruths(db as unknown as Parameters<typeof loadRecentFixTruths>[0], projectIds),
      ]);
      const healthCounts = countHealthIssues(summarizeHealthByKind(health.rows));
      reads = {
        criticalReports14d,
        criticalUntriaged,
        openBacklog,
        urgentOpenReports,
        ungradedReports,
        lastEvalAt,
        hasKey: keyRows.length > 0,
        hasSdk: heartbeatRows.length > 0,
        reportCount,
        lastReport,
        lastFix,
        integrationRed: healthCounts.red,
        integrationAmber: healthCounts.amber,
        failedFixes14d: summarizeFixTruths(fixTruths.truths.values()).failed,
      };
    } catch (err) {
      return dashboardReadFailed(c, err);
    }
    const {
      criticalReports14d,
      criticalUntriaged,
      openBacklog,
      urgentOpenReports,
      failedFixes14d,
      integrationRed,
      integrationAmber,
      lastEvalAt,
    } = reads;

    let judgeStaleHours: number | null = null;
    if (lastEvalAt) {
      judgeStaleHours = (now - new Date(String(lastEvalAt)).getTime()) / (60 * 60 * 1000);
    }
    // Old scores alone are not actionable: with no ungraded report a re-run
    // evaluates nothing and the "Judge scores are Nh old" card never clears.
    const judgeStale = isJudgeStale({ judgeStaleHours, ungradedReports: reads.ungradedReports });

    const openPlan = criticalUntriaged > 0;
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
            title: `${criticalUntriaged} critical report${criticalUntriaged === 1 ? '' : 's'} need triage`,
            hint: 'Confirm severity on the worst bugs first — auto-fix waits for triage.',
            // Lists exactly what criticalUntriaged counts: the triage backlog, any age.
            to: scoped('/reports?severity=critical&status=new'),
          }
        : null,
      openDo
        ? {
            stage: 'do',
            title: `${failedFixes14d} report${failedFixes14d === 1 ? '' : 's'} still unfixed after an auto-fix attempt`,
            hint: 'Open each one to read why the last attempt stopped, then retry or hand off to your editor.',
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

    const requiredComplete =
      1 + (reads.hasKey ? 1 : 0) + (reads.hasSdk ? 1 : 0) + (reads.reportCount > 0 ? 1 : 0);
    const setupDone = requiredComplete >= 4;
    const { lastActivityAt, lastActivityKind } = latestActivity(reads.lastReport, reads.lastFix);

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
        criticalUntriaged,
        openBacklog,
        failedFixes14d,
        urgentOpenReports,
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

    const sinceIso = reportWindowStartIso(14);

    // Count-only reads: this route runs on every page through the sidebar
    // counters (nav-meta), so it must not pull rows it only counts.
    let reads: {
      reports14d: number;
      openBacklog: number;
      llmCalls14d: number;
      llmOk14d: number;
      hasKey: boolean;
      hasSdk: boolean;
      reportCount: number;
      lastReport: string | null;
      lastFix: string | null;
      integrationIssues: number;
      fixTruths: Awaited<ReturnType<typeof loadRecentFixTruths>>;
    };
    try {
      const [
        reports14d,
        openBacklog,
        llmCalls14d,
        llmOk14d,
        keyRows,
        heartbeatRows,
        reportCount,
        lastReport,
        lastFix,
        health,
        fixTruths,
      ] = await Promise.all([
        exactCount(
          'reports 14d',
          db
            .from('reports')
            .select('id', { count: 'exact', head: true })
            .in('project_id', projectIds)
            .gte('created_at', sinceIso),
        ),
        triageBacklogCount(db, projectIds),
        exactCount(
          'llm calls 14d',
          db
            .from('llm_invocations')
            .select('id', { count: 'exact', head: true })
            .in('project_id', projectIds)
            .gte('created_at', sinceIso),
        ),
        exactCount(
          'llm successes 14d',
          db
            .from('llm_invocations')
            .select('id', { count: 'exact', head: true })
            .in('project_id', projectIds)
            .gte('created_at', sinceIso)
            .eq('status', 'success'),
        ),
        rowsOf(
          'api keys',
          db.from('project_api_keys').select('id').eq('project_id', activeProject.id).eq('is_active', true).limit(1),
        ),
        rowsOf(
          'sdk heartbeat',
          db
            .from('project_api_keys')
            .select('last_seen_at')
            .eq('project_id', activeProject.id)
            .eq('is_active', true)
            .not('last_seen_at', 'is', null)
            .limit(1),
        ),
        exactCount(
          'report count',
          db.from('reports').select('id', { count: 'exact', head: true }).eq('project_id', activeProject.id),
        ),
        newestCreatedAt(
          'latest report',
          db
            .from('reports')
            .select('created_at')
            .in('project_id', projectIds)
            .gte('created_at', sinceIso)
            .order('created_at', { ascending: false })
            .limit(1),
        ),
        newestCreatedAt(
          'latest fix attempt',
          db
            .from('fix_attempts')
            .select('created_at')
            .in('project_id', projectIds)
            .gte('created_at', sinceIso)
            .order('created_at', { ascending: false })
            .limit(1),
        ),
        loadIntegrationHealth(db as unknown as Parameters<typeof loadIntegrationHealth>[0], projectIds, sinceIso),
        // Per REPORT from its current state (fix-report-truth.ts): glot.it read
        // "8 auto-fixes failed / 7 open PRs" over 4 reports already fixed by
        // merged PRs and 0 open PRs (2026-10-04).
        loadRecentFixTruths(db as unknown as Parameters<typeof loadRecentFixTruths>[0], projectIds),
      ]);
      reads = {
        reports14d,
        openBacklog,
        llmCalls14d,
        llmOk14d,
        hasKey: keyRows.length > 0,
        hasSdk: heartbeatRows.length > 0,
        reportCount,
        lastReport,
        lastFix,
        integrationIssues: countHealthIssues(summarizeHealthByKind(health.rows)).issues,
        fixTruths,
      };
    } catch (err) {
      return dashboardReadFailed(c, err);
    }
    const { reports14d, openBacklog, llmCalls14d, integrationIssues, hasSdk, reportCount } = reads;
    const llmFailures14d = Math.max(0, llmCalls14d - reads.llmOk14d);

    const fixTruth = summarizeFixTruths(reads.fixTruths.truths.values());
    const fixesInProgress = fixTruth.inFlight;
    const fixesFailed = fixTruth.failed;
    const openPrs = fixTruth.prOpen;
    const failedFixesPreview = failedFixPreviews(reads.fixTruths, { projectId: activeProject.id, limit: 3 });

    const requiredComplete =
      1 +
      (reads.hasKey ? 1 : 0) +
      (hasSdk ? 1 : 0) +
      (reportCount > 0 ? 1 : 0);
    const setupDone = requiredComplete >= 4;

    let focusStage: string | null = null;
    let focusLabel: string | null = null;
    let bottleneck: string | null = null;
    if (openBacklog > 0) {
      focusStage = 'plan';
      focusLabel = 'Plan';
      bottleneck = `${openBacklog} report${openBacklog === 1 ? '' : 's'} waiting to triage`;
    } else if (fixesFailed > 0) {
      focusStage = 'do';
      focusLabel = 'Do';
      bottleneck = `${fixesFailed} report${fixesFailed === 1 ? '' : 's'} still unfixed after an auto-fix attempt`;
    } else if (integrationIssues > 0) {
      focusStage = 'act';
      focusLabel = 'Act';
      bottleneck = `${integrationIssues} integration${integrationIssues === 1 ? '' : 's'} failing health checks`;
    } else if (llmFailures14d > 0) {
      focusStage = 'check';
      focusLabel = 'Check';
      bottleneck = `${llmFailures14d} LLM failure${llmFailures14d === 1 ? '' : 's'} in 14d`;
    }

    const { lastActivityAt, lastActivityKind } = latestActivity(reads.lastReport, reads.lastFix);

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
      topPriorityLabel = `${openBacklog} report${openBacklog === 1 ? '' : 's'} waiting to triage — start with the oldest.`;
      topPriorityTo = `/reports?tab=queue&status=new&project=${encodeURIComponent(pid)}`;
    } else if (fixesFailed > 0) {
      topPriority = 'fixes_failed';
      topPriorityLabel =
        'The last auto-fix attempt on these reports stopped — open each one to read why, then retry or fix it in your editor.';
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
        hasData: reports14d > 0 || reads.lastFix != null,
        setupDone,
        requiredComplete,
        requiredTotal: 4,
        openBacklog,
        reports14d,
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

    const sinceIso = reportWindowStartIso(14);
    const since = new Date(sinceIso);
    const now = Date.now();
    const sevenDaysAgoIso = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    type ChartReport = { created_at: string; severity: string | null; component: string | null };
    type ChartLlm = {
      created_at: string;
      status: string | null;
      latency_ms: number | null;
      input_tokens: number | null;
      output_tokens: number | null;
    };
    type RecentReport = {
      id: string;
      summary: string | null;
      description: string | null;
      severity: string | null;
      category: string | null;
      status: string | null;
      created_at: string;
    };
    type RecentFix = {
      id: string;
      report_id: string;
      status: string | null;
      agent: string | null;
      pr_number: number | null;
      pr_state: string | null;
      merged_at: string | null;
      llm_model: string | null;
      created_at: string;
    };

    let loaded: {
      reports14d: number;
      openBacklog: number;
      openCritical14d: number;
      oldestTriageAt: string | null;
      llmCalls14d: number;
      llmOk14d: number;
      pendingEvals: number;
      disagreements: number;
      chartReports: ChartReport[];
      chartLlm: ChartLlm[];
      latestReports: RecentReport[];
      recentFixes: RecentFix[];
      evalDays: Array<{ created_at: string }>;
      openReports: Array<RecentReport & { processing_error: string | null }>;
      healthRows: Awaited<ReturnType<typeof loadIntegrationHealth>>['rows'];
      dashTruths: Awaited<ReturnType<typeof loadRecentFixTruths>>;
    };
    try {
      const [
        reports14d,
        openBacklog,
        openCritical14d,
        oldestTriage,
        llmCalls14d,
        llmOk14d,
        pendingEvals,
        disagreements,
        chartReports,
        chartLlm,
        latestReports,
        recentFixes,
        evalDays,
        openReports,
        health,
        dashTruths,
      ] = await Promise.all([
        exactCount(
          'reports 14d',
          db
            .from('reports')
            .select('id', { count: 'exact', head: true })
            .in('project_id', projectIds)
            .gte('created_at', sinceIso),
        ),
        triageBacklogCount(db, projectIds),
        // The inbox "critical" card: critical reports from this window that
        // still need a decision (status=open&severity=critical&days=14).
        exactCount(
          'open critical 14d',
          db
            .from('reports')
            .select('id', { count: 'exact', head: true })
            .in('project_id', projectIds)
            .eq('severity', 'critical')
            .in('status', [...OPEN_REPORT_STATUSES])
            .gte('created_at', sinceIso),
        ),
        // Oldest report still waiting for triage, any age — the Plan bottleneck.
        rowsOf<{ created_at: string }>(
          'oldest untriaged report',
          db
            .from('reports')
            .select('created_at')
            .in('project_id', projectIds)
            .in('status', [...TRIAGE_BACKLOG_STATUSES])
            .order('created_at', { ascending: true })
            .limit(1),
        ),
        exactCount(
          'llm calls 14d',
          db
            .from('llm_invocations')
            .select('id', { count: 'exact', head: true })
            .in('project_id', projectIds)
            .gte('created_at', sinceIso),
        ),
        exactCount(
          'llm successes 14d',
          db
            .from('llm_invocations')
            .select('id', { count: 'exact', head: true })
            .in('project_id', projectIds)
            .gte('created_at', sinceIso)
            .eq('status', 'success'),
        ),
        // Check: what judge-batch would grade now, the same count as the
        // inbox Check flag (ungradedReportCount).
        ungradedReportCount(db, projectIds),
        exactCount(
          'judge disagreements 14d',
          db
            .from('classification_evaluations')
            .select('id', { count: 'exact', head: true })
            .in('project_id', projectIds)
            .gte('created_at', sinceIso)
            .eq('classification_agreed', false),
        ),
        // Chart rows only (newest first). Headline numbers above are exact counts.
        rowsOf<ChartReport>(
          'report chart rows',
          db
            .from('reports')
            .select('created_at, severity, component')
            .in('project_id', projectIds)
            .gte('created_at', sinceIso)
            .order('created_at', { ascending: false })
            .limit(CHART_ROW_CAP),
        ),
        rowsOf<ChartLlm>(
          'llm chart rows',
          db
            .from('llm_invocations')
            .select('created_at, status, latency_ms, input_tokens, output_tokens')
            .in('project_id', projectIds)
            .gte('created_at', sinceIso)
            .order('created_at', { ascending: false })
            .limit(CHART_ROW_CAP),
        ),
        rowsOf<RecentReport>(
          'latest reports',
          db
            .from('reports')
            .select('id, summary, description, severity, category, status, created_at')
            .in('project_id', projectIds)
            .gte('created_at', sinceIso)
            .order('created_at', { ascending: false })
            .limit(6),
        ),
        // Fix attempts of the last 7 days: the Do sparkline and the activity feed.
        rowsOf<RecentFix>(
          'recent fix attempts',
          db
            .from('fix_attempts')
            .select('id, report_id, status, agent, pr_number, pr_state, merged_at, llm_model, created_at')
            .in('project_id', projectIds)
            .gte('created_at', sevenDaysAgoIso)
            .order('created_at', { ascending: false })
            .limit(CHART_ROW_CAP),
        ),
        rowsOf<{ created_at: string }>(
          'judge evaluations 7d',
          db
            .from('classification_evaluations')
            .select('created_at')
            .in('project_id', projectIds)
            .gte('created_at', sevenDaysAgoIso)
            .order('created_at', { ascending: false })
            .limit(CHART_ROW_CAP),
        ),
        // Triage-queue source: open reports REGARDLESS of age. A windowed
        // slice silently dropped anything stuck open longer than the window,
        // so the dashboard claimed "All caught up" over a stalled queue
        // (2026-08-16 audit).
        rowsOf<RecentReport & { processing_error: string | null }>(
          'open reports',
          db
            .from('reports')
            .select('id, summary, description, status, severity, category, created_at, processing_error')
            .in('project_id', projectIds)
            .in('status', [...OPEN_REPORT_STATUSES])
            .order('created_at', { ascending: false })
            .limit(10),
        ),
        loadIntegrationHealth(db as unknown as Parameters<typeof loadIntegrationHealth>[0], projectIds, sinceIso),
        // Auto-fix pipeline summary, per REPORT from its current state: the
        // same rule as /dashboard/stats and /fixes (fix-report-truth.ts).
        loadRecentFixTruths(db as unknown as Parameters<typeof loadRecentFixTruths>[0], projectIds),
      ]);
      loaded = {
        reports14d,
        openBacklog,
        openCritical14d,
        oldestTriageAt: oldestTriage[0]?.created_at ?? null,
        llmCalls14d,
        llmOk14d,
        pendingEvals,
        disagreements,
        chartReports,
        chartLlm,
        latestReports,
        recentFixes,
        evalDays,
        openReports,
        healthRows: health.rows,
        dashTruths,
      };
    } catch (err) {
      return dashboardReadFailed(c, err);
    }
    const { reports14d, openBacklog, openCritical14d, pendingEvals, disagreements, recentFixes, dashTruths } = loaded;

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
    for (const r of loaded.chartReports) {
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
    for (const inv of loaded.chartLlm) {
      const d = dayKey(String(inv.created_at));
      if (!llmByDay[d]) continue;
      llmByDay[d].calls++;
      const tok = (inv.input_tokens ?? 0) + (inv.output_tokens ?? 0);
      llmByDay[d].tokens += tok;
      llmByDay[d].latencyMs += inv.latency_ms ?? 0;
      if (inv.status !== 'success') llmByDay[d].failures++;
      totalTokens += tok;
    }
    const totalLlmCalls = loaded.llmCalls14d;
    const totalLlmFailures = Math.max(0, loaded.llmCalls14d - loaded.llmOk14d);
    // True when a chart had more rows than CHART_ROW_CAP; the KPI counts stay exact.
    const chartsSampled =
      loaded.chartReports.length >= CHART_ROW_CAP || loaded.chartLlm.length >= CHART_ROW_CAP;

    // Top components by report count
    const componentCounts = new Map<string, number>();
    for (const r of loaded.chartReports) {
      const comp = (r.component ?? '').trim();
      if (!comp) continue;
      componentCounts.set(comp, (componentCounts.get(comp) ?? 0) + 1);
    }
    const topComponents = [...componentCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([component, count]) => ({ component, count }));

    // `total` is the number of reports with an attempt in the shared 30-day window.
    const dashTruth = summarizeFixTruths(dashTruths.truths.values());
    const fixSummary = {
      total: dashTruth.reports,
      completed: dashTruth.fixed,
      failed: dashTruth.failed,
      retryable: dashTruth.retryable,
      inProgress: dashTruth.inFlight,
      openPrs: dashTruth.prOpen,
    };

    // Triage queue: top 5 open reports needing attention, ANY age.
    const triageQueue = loaded.openReports
      .slice(0, 5)
      .map((r) => ({
        id: r.id,
        summary: r.summary ?? r.description?.slice(0, 140) ?? '(no summary)',
        severity: r.severity,
        category: r.category,
        status: r.status,
        created_at: r.created_at,
        // Surfaced so the console can show "auto-fix blocked" inline.
        processing_error: r.processing_error ?? null,
      }));

    // Recent activity: last 8 events across reports + fixes
    const activity = [
      ...loaded.latestReports.map((r) => ({
        kind: 'report' as const,
        id: r.id,
        label: r.summary ?? r.description?.slice(0, 100) ?? '(no summary)',
        meta: r.severity ?? r.category ?? r.status,
        at: r.created_at,
      })),
      ...recentFixes.slice(0, 4).map((f) => ({
        kind: 'fix' as const,
        // Use the fix attempt's own ID, not report_id: multiple attempts can
        // share the same report_id and would produce duplicate React keys.
        id: f.id,
        label: fixActivityLabel(f, dashTruths.truths.get(String(f.report_id))?.mergedPrNumber ?? null),
        meta: f.llm_model ?? f.agent ?? null,
        at: f.created_at,
      })),
    ]
      .sort((a, b) => new Date(String(b.at)).getTime() - new Date(String(a.at)).getTime())
      .slice(0, 8);

    // Integration health: latest status per kind (worst across the projects
    // in scope) and the ok/total uptime over the window. One definition with
    // dashboard/stats and inbox/stats (_shared/integration-health-rollup.ts).
    const integrations = summarizeHealthByKind(loaded.healthRows).map((h) => ({
      kind: h.kind,
      lastStatus: h.lastStatus,
      lastAt: h.lastAt,
      uptime: h.uptime,
      severity: h.severity,
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

    // 7-day series for each PDCA stage, from the chart / 7-day rows loaded above.
    const last7Days: string[] = [];
    for (let i = 6; i >= 0; i--) {
      last7Days.push(new Date(now - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
    }
    const last7Index = new Map(last7Days.map((d, i) => [d, i]));
    const planSeries7d = new Array(7).fill(0) as number[];
    const doSeries7d = new Array(7).fill(0) as number[];
    const checkSeries7d = new Array(7).fill(0) as number[];
    for (const r of loaded.chartReports) {
      const i = last7Index.get(String(r.created_at).slice(0, 10));
      if (i !== undefined) planSeries7d[i] += 1;
    }
    for (const f of recentFixes) {
      const i = last7Index.get(String(f.created_at).slice(0, 10));
      if (i !== undefined) doSeries7d[i] += 1;
    }
    for (const e of loaded.evalDays) {
      const i = last7Index.get(String(e.created_at).slice(0, 10));
      if (i !== undefined) checkSeries7d[i] += 1;
    }

    // Plan: reports waiting for triage, any age (`openBacklog`), and how long
    // the oldest of them has waited.
    const oldestNewMs = loaded.oldestTriageAt ? Date.parse(loaded.oldestTriageAt) : Number.NaN;
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
      countLabel: openBacklog === 1 ? 'report waiting to triage' : 'reports waiting to triage',
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
      countLabel: doCount === 1 ? 'fix running or stopped' : 'fixes running or stopped',
      bottleneck:
        fixSummary.failed > 0
          ? `Auto-fix stopped on ${fixSummary.failed} ${fixSummary.failed === 1 ? 'report' : 'reports'}`
          : null,
      tone: doTone,
      cta: { to: '/fixes', label: 'Open Fixes' },
      series: doSeries7d,
    };

    // Check: `pendingEvals` = reports the judge would grade now (counted above
    // with the inbox's definition); `disagreements` = judge vs classifier in 14d.
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
    const liveIntegrations = integrations.filter((i) => i.severity === 'ok').length;
    const failingIntegrations = countHealthIssues(integrations).issues;
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
          reports14d,
          openBacklog,
          openCritical14d,
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
        chartsSampled,
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
    if (error) return rpcError(c, error);

    return c.json({ ok: true, data });
  });

  // ─── GET /v1/admin/portfolio ───────────────────────────────────────────────
  // Org-scoped portfolio summary for the Overview page.
  // Returns one card per project with 7-day sessions/users/reports + sparkline.
  app.get('/v1/admin/portfolio', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    // Canonical: X-Mushi-Org-Id (apiFetch). Also accept legacy aliases that
    // shipped briefly on older console builds / mis-documented clients.
    const orgId =
      getOrgIdFromContext(c) ??
      c.req.header('x-organization-id') ??
      c.req.header('x-org-id') ??
      null;
    if (!orgId) {
      return c.json(
        { ok: false, error: { code: 'NO_ORG', message: 'X-Mushi-Org-Id header required' } },
        400,
      );
    }

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
    if (error) return rpcError(c, error);

    return c.json({ ok: true, data: data ?? [] });
  });

}
