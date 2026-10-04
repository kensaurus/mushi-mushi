import type { Hono, Context } from 'npm:hono@4';
import type { Variables } from '../types.ts'
import { streamSSE } from 'npm:hono@4/streaming';

import { toSseEvent, sanitizeSseString, sseHeartbeat } from '../../_shared/sse.ts';
import { AguiEmitter } from '../../_shared/agui.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { log } from '../../_shared/logger.ts';
import { reportError } from '../../_shared/sentry.ts';
import { apiKeyAuth, jwtAuth, adminOrApiKey } from '../../_shared/auth.ts';
import {
  requireFeature,
  resolveActiveEntitlement,
  GATED_ROUTES,
  type FeatureFlag,
} from '../../_shared/entitlements.ts';
import { requireSuperAdmin } from '../../_shared/super-admin.ts';
import { checkIngestQuota } from '../../_shared/quota.ts';
import { currentRegion, lookupProjectRegion, regionEndpoint } from '../../_shared/region.ts';
import { getStorageAdapter, invalidateStorageCache } from '../../_shared/storage.ts';
import { reportSubmissionSchema } from '../../_shared/schemas.ts';
import { checkAntiGaming } from '../../_shared/anti-gaming.ts';
import { logAntiGamingEvent } from '../../_shared/telemetry.ts';
import { awardPoints, getReputation } from '../../_shared/reputation.ts';
import { createNotification, buildNotificationMessage } from '../../_shared/notifications.ts';
import { getBlastRadius } from '../../_shared/knowledge-graph.ts';
import { logAudit } from '../../_shared/audit.ts';
import { createExternalIssue } from '../../_shared/integrations.ts';
import { getActivePlugins, dispatchPluginEventDetached } from '../../_shared/plugins.ts';
import { withIdempotency } from '../../_shared/idempotency.ts';
import { getAvailableTags } from '../../_shared/ontology.ts';
import { executeNaturalLanguageQuery } from '../../_shared/nl-query.ts';
import { getPlan, listPlans } from '../../_shared/plans.ts';
import { estimateCallCostUsd } from '../../_shared/pricing.ts';
import { ANTHROPIC_SONNET } from '../../_shared/models.ts';
import {
  finalizeFixMerge,
  mergeGithubPullRequest,
  parsePrRepoRef,
  type MergeMethod,
} from '../../_shared/fix-merge.ts';
import {
  mergeStoredFixTimeline,
  synthesizeFixTimeline,
  type FixTimelineEvent,
} from '../../_shared/fix-timeline.ts';
import { isFixCountedFailed } from '../../_shared/fix-loop-status.ts';
import { summarizeFixTruths } from '../../_shared/fix-report-truth.ts';
import { loadRecentFixTruths, loadReportFixTruths, reportTitle } from '../../_shared/fix-report-truth-load.ts';
import { resolveUserDisplays } from '../../_shared/user-display.ts';
import {
  installationIdForAttempt,
  parseGithubRepoUrl,
  resolveProjectGithubToken,
} from '../../_shared/github.ts';
import { resolveBranchForConnect } from '../../_shared/github-branch.ts';
import { canMergeReportGroups, mergeReportGroups } from '../../_shared/report-groups.ts';
import { dbError, ownedProjectIds, callerProjectIds, resolveOwnedProject, scopedOwnedProjectIds, callerCanAccessProject } from '../shared.ts';
import {
  canManageProjectSdkConfig,
  coerceSdkConfigUpdate,
  ingestReport,
  invokeFixWorker,
  normalizeSdkConfig,
  triggerClassification,
  type SdkConfigRow,
} from '../helpers.ts';

export function registerQueryFixesRepoRoutes(app: Hono<{ Variables: Variables }>): void {
  app.get('/v1/admin/query/stats', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const empty = {
      projectId: null as string | null,
      projectName: null as string | null,
      planId: 'hobby',
      planDisplayName: 'Hobby',
      savedCount: 0,
      recentCount: 0,
      teamSavedCount: 0,
      runs24h: 0,
      errors24h: 0,
      nlRuns24h: 0,
      rawRuns24h: 0,
      avgLatencyMs: null as number | null,
      lastRunAt: null as string | null,
      lastRunPrompt: null as string | null,
      lastRunError: null as string | null,
      schemaDegraded: false,
    };

    const resolvedProject = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () => c.json({ ok: true, data: empty }),
    });
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;

    const entitlement = await resolveActiveEntitlement(c);
    const plan = entitlement?.plan;
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [userHistoryRes, teamCountRes, runs24hRes] = await Promise.all([
      db
        .from('nl_query_history')
        .select('id, is_saved, error, latency_ms, mode, prompt, created_at')
        .eq('user_id', userId)
        .eq('project_id', project.id)
        .order('created_at', { ascending: false })
        .limit(200),
      db
        .from('nl_query_history')
        .select('id', { count: 'exact', head: true })
        .in('project_id', await callerProjectIds(c, db, userId))
        .eq('is_saved', true)
        .neq('user_id', userId),
      db
        .from('nl_query_history')
        .select('error, latency_ms, mode, created_at')
        .eq('project_id', project.id)
        .gte('created_at', since24h),
    ]);

    const schemaDegraded =
      userHistoryRes.error?.code === '42703' ||
      teamCountRes.error?.code === '42703' ||
      runs24hRes.error?.code === '42703';

    if (userHistoryRes.error && userHistoryRes.error.code !== '42703') {
      return dbError(c, userHistoryRes.error);
    }
    if (teamCountRes.error && teamCountRes.error.code !== '42703') {
      return dbError(c, teamCountRes.error);
    }
    if (runs24hRes.error && runs24hRes.error.code !== '42703') {
      return dbError(c, runs24hRes.error);
    }

    const userRows = userHistoryRes.data ?? [];
    let savedCount = 0;
    let recentCount = 0;
    for (const row of userRows) {
      if (row.is_saved) savedCount += 1;
      else recentCount += 1;
    }

    const runs24hRows = runs24hRes.data ?? [];
    let errors24h = 0;
    let nlRuns24h = 0;
    let rawRuns24h = 0;
    let latencySum = 0;
    let latencyCount = 0;
    for (const row of runs24hRows) {
      if (row.error) errors24h += 1;
      const mode = (row.mode as string | null) ?? 'nl';
      if (mode === 'raw') rawRuns24h += 1;
      else nlRuns24h += 1;
      if (typeof row.latency_ms === 'number') {
        latencySum += row.latency_ms;
        latencyCount += 1;
      }
    }

    const latest = userRows[0] ?? null;

    return c.json({
      ok: true,
      data: {
        projectId: project.id,
        projectName: project.name,
        planId: plan?.id ?? 'hobby',
        planDisplayName: plan?.display_name ?? 'Hobby',
        savedCount,
        recentCount,
        teamSavedCount: teamCountRes.count ?? 0,
        runs24h: runs24hRows.length,
        errors24h,
        nlRuns24h,
        rawRuns24h,
        avgLatencyMs: latencyCount > 0 ? Math.round(latencySum / latencyCount) : null,
        lastRunAt: latest?.created_at ?? null,
        lastRunPrompt: latest?.prompt ?? null,
        lastRunError: latest?.error ?? null,
        schemaDegraded,
      },
    });
  });

  app.get('/v1/admin/query/history', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 20), 1), 100);
    const onlySaved = c.req.query('saved') === '1';
    let query = db
      .from('nl_query_history')
      .select(
        'id, project_id, prompt, sql, summary, explanation, row_count, error, latency_ms, is_saved, created_at',
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (onlySaved) query = query.eq('is_saved', true);
    const { data, error } = await query;
    if (error) {
      // resilience: if the deploy is mid-flight (Edge Function is on
      // the new bundle but the `is_saved` migration hasn't landed yet — the
      // exact failure mode that bit the 04-20 dogfood), return an empty
      // history list with a soft-warning instead of 500. The saved sidebar
      // simply renders empty until the migration lands; the rest of the
      // /query page (POST endpoint, sample queries) keeps working.
      if (error.code === '42703') {
        reportError(error, {
          tags: {
            path: c.req.path,
            method: c.req.method,
            db_code: '42703',
            error_type: 'migration_drift',
          },
          extra: {
            hint: 'Run `supabase db push` to apply the nl_query_history.is_saved migration.',
          },
        });
        return c.json({ ok: true, data: { history: [], degraded: 'schema_pending' } });
      }
      return dbError(c, error);
    }
    return c.json({ ok: true, data: { history: data ?? [] } });
  });

  // PATCH the is_saved flag — used by the Query page Saved sidebar.
  app.patch('/v1/admin/query/history/:id', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const id = c.req.param('id')!;
    const body = (await c.req.json().catch(() => ({}))) as { is_saved?: boolean };
    if (typeof body.is_saved !== 'boolean') {
      return c.json(
        { ok: false, error: { code: 'BAD_REQUEST', message: 'is_saved boolean required' } },
        400,
      );
    }
    const db = getServiceClient();
    const { error } = await db
      .from('nl_query_history')
      .update({ is_saved: body.is_saved })
      .eq('id', id)
      .eq('user_id', userId);
    if (error) return dbError(c, error);
    return c.json({ ok: true, data: { id, is_saved: body.is_saved } });
  });

  app.delete('/v1/admin/query/history/:id', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const id = c.req.param('id')!;
    const db = getServiceClient();
    const { error } = await db.from('nl_query_history').delete().eq('id', id).eq('user_id', userId);
    if (error) return dbError(c, error);
    return c.json({ ok: true, data: { deleted: id } });
  });

  // Saved queries from *teammates* — anyone the caller shares an org/project
  // with (via `accessibleProjectIds`), excluding the caller themselves.
  // Powers the "Team" tab in the /query sidebar so a colleague's pinned
  // question is one click away instead of trapped in their console.
  // Each row carries the author's display name + email so the UI can
  // attribute the prompt without a second round-trip per row. Service
  // client + JWT auth: RLS already permits org-member SELECT on
  // nl_query_history, but we go through service-role to keep latency
  // predictable and to attach the author display info via auth.admin.
  app.get('/v1/admin/query/team', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 25), 1), 100);

    const projectIds = await callerProjectIds(c, db, userId);
    if (projectIds.length === 0) {
      return c.json({ ok: true, data: { team: [] } });
    }

    const { data, error } = await db
      .from('nl_query_history')
      .select(
        'id, project_id, user_id, prompt, sql, summary, explanation, row_count, error, latency_ms, is_saved, created_at',
      )
      .in('project_id', projectIds)
      .eq('is_saved', true)
      .neq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      // Same `is_saved`-column resilience the GET history endpoint has —
      // if a self-host is mid-migration we soft-degrade instead of 500.
      if (error.code === '42703') {
        reportError(error, {
          tags: {
            path: c.req.path,
            method: c.req.method,
            db_code: '42703',
            error_type: 'migration_drift',
          },
          extra: {
            hint: 'Run `supabase db push` to apply nl_query_history.is_saved migration.',
          },
        });
        return c.json({ ok: true, data: { team: [], degraded: 'schema_pending' } });
      }
      return dbError(c, error);
    }

    const rows = data ?? [];
    // Decorate each row with author display info. Dedupe by user_id first
    // because a single power user often owns 5+ saved prompts and we
    // don't want N admin.getUserById calls when 1 would do (mirrors the
    // organizations.ts inviter-email pattern).
    const authorById = await resolveUserDisplays(
      db as unknown as Parameters<typeof resolveUserDisplays>[0],
      rows.map((r) => r.user_id),
    );

    const decorated = rows.map((r) => {
      const author = (r.user_id && authorById.get(r.user_id)) || { email: null, name: null };
      return {
        ...r,
        author_email: author.email,
        author_name: author.name,
      };
    });

    return c.json({ ok: true, data: { team: decorated } });
  });

  // ============================================================
  // PHASE 2: REPORT GROUPS
  // ============================================================

  app.get('/v1/admin/groups', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await callerProjectIds(c, db, userId);

    const { data } = await db
      .from('report_groups')
      .select('*, reports:reports(id, summary, category, severity, status, created_at)')
      .in('project_id', projectIds)
      .order('created_at', { ascending: false })
      .limit(50);

    return c.json({ ok: true, data: { groups: data ?? [] } });
  });

  app.post('/v1/admin/groups/:id/merge', jwtAuth, async (c) => {
    const groupId = c.req.param('id')!;
    const body = (await c.req.json().catch(() => null)) as { targetGroupId?: unknown } | null;
    const targetGroupId = typeof body?.targetGroupId === 'string' ? body.targetGroupId : '';
    if (!targetGroupId || targetGroupId === groupId) {
      return c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Pick a different group to merge into.' } }, 400);
    }
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await callerProjectIds(c, db, userId);

    const { data: sourceGroup } = await db
      .from('report_groups')
      .select('id, project_id')
      .eq('id', groupId)
      .in('project_id', projectIds)
      .single();
    const { data: targetGroup } = await db
      .from('report_groups')
      .select('id, project_id')
      .eq('id', targetGroupId)
      .in('project_id', projectIds)
      .single();
    if (!sourceGroup || !targetGroup)
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Group not found' } }, 404);
    if (sourceGroup.project_id !== targetGroup.project_id)
      return c.json(
        {
          ok: false,
          error: { code: 'INVALID', message: 'Groups must belong to the same project' },
        },
        400,
      );
    // Merging deletes the source group: viewers are read-only.
    const access = await callerCanAccessProject(c, db, userId, sourceGroup.project_id as string);
    if (!access.allowed || !canMergeReportGroups(access.role)) {
      return c.json(
        { ok: false, error: { code: 'FORBIDDEN', message: 'Viewers cannot merge groups. Ask a member or admin.' } },
        403,
      );
    }

    const result = await mergeReportGroups(db, groupId, targetGroupId, sourceGroup.project_id as string);
    if (!result.ok) {
      log.error('report group merge failed', { groupId, targetGroupId, step: result.step, error: result.message });
      return c.json(
        { ok: false, error: { code: 'MERGE_FAILED', message: 'The merge stopped part way. No group was deleted; retry the merge.' } },
        500,
      );
    }

    return c.json({ ok: true, data: { moved: result.moved, report_count: result.reportCount } });
  });

  // ============================================================
  // PHASE 2: FIX VERIFICATIONS
  // ============================================================

  app.get('/v1/admin/verifications', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await callerProjectIds(c, db, userId);
    if (projectIds.length === 0) return c.json({ ok: true, data: { verifications: [] } });

    const { data } = await db
      .from('fix_verifications')
      .select('*, reports:report_id!inner(id, summary, category, project_id)')
      .in('reports.project_id', projectIds)
      .order('verified_at', { ascending: false })
      .limit(50);

    return c.json({ ok: true, data: { verifications: data ?? [] } });
  });

  // ============================================================
  // PHASE 3: FIX ATTEMPTS
  // ============================================================

  // GET /v1/admin/fixes/stats — FixesStatusBanner posture data.
  app.get('/v1/admin/fixes/stats', jwtAuth, async (c) => {
    const userId = c.get('userId') as string
    const db = getServiceClient()

    const empty = {
      hasAnyProject: false,
      projectId: null as string | null,
      projectName: null as string | null,
      projectCount: 0,
      hasGithub: false,
      codebaseIndexEnabled: false,
      indexedFiles: 0,
      totalAttempts: 0,
      failed: 0,
      retryable: 0,
      inProgress: 0,
      completed: 0,
      prsOpen: 0,
      prsCiPassing: 0,
      specWarnings: 0,
      inflightDispatches: 0,
      topFailureCategory: null as string | null,
      topFailureCount: 0,
      successRatePct: null as number | null,
      topPriority: 'no_project' as
        | 'no_project' | 'no_github' | 'no_index' | 'failed'
        | 'inflight' | 'waiting' | 'healthy',
      topPriorityLabel: null as string | null,
      topPriorityTo: null as string | null,
    }

    const projectIds = await callerProjectIds(c, db, userId)
    if (projectIds.length === 0) return c.json({ ok: true, data: empty })

    const resolvedProject = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () =>
        c.json({ ok: true, data: { ...empty, hasAnyProject: true, projectCount: projectIds.length } }),
    })
    if ('response' in resolvedProject) return resolvedProject.response
    const activeProject = resolvedProject.project
    const pid = activeProject.id

    const since = new Date()
    since.setUTCDate(since.getUTCDate() - 29)
    since.setUTCHours(0, 0, 0, 0)

    const [attemptsRes, integrationRes, codebaseRes, inflightRes] = await Promise.all([
      db.from('fix_attempts')
        .select('id, report_id, check_run_conclusion, spec_validation_warnings')
        .eq('project_id', pid)
        .gte('created_at', since.toISOString())
        .limit(500),
      // Check project_settings for GitHub connectivity — the fix-worker uses
      // github_installation_token_ref + github_repo_url (not project_integrations).
      // project_integrations uses integration_type/is_active columns (not provider/enabled).
      db.from('project_settings')
        .select('github_repo_url, github_installation_token_ref')
        .eq('project_id', pid)
        .maybeSingle(),
      db.from('project_codebase_files')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', pid),
      db.from('fix_dispatch_jobs')
        .select('report_id')
        .eq('project_id', pid)
        .in('status', ['queued', 'running'])
        .limit(200),
    ])

    const attempts = attemptsRes.data ?? []
    // Counts are per REPORT and from its current state (fix-report-truth.ts):
    // a report fixed by a merged PR never counts as failed or open, however
    // many earlier attempts failed (glot.it 2026-10-04).
    const { truths } = await loadRecentFixTruths(db as unknown as Parameters<typeof loadRecentFixTruths>[0], [pid])
    const truth = summarizeFixTruths(truths.values())
    const failed = truth.failed
    const retryable = truth.retryable
    const inProgress = truth.inFlight
    const completed = truth.fixed
    const prsOpen = truth.prOpen
    const prsCiPassing = attempts.filter((a) => a.check_run_conclusion === 'success').length
    const specWarnings = attempts.filter((a) => {
      const w = a.spec_validation_warnings as unknown
      return Array.isArray(w) && w.length > 0
    }).length

    const topEntry = truth.failureBreakdown[0]

    const hasGithub = !!(integrationRes.data?.github_repo_url) || !!(integrationRes.data?.github_installation_token_ref)
    const indexedFiles = codebaseRes.count ?? 0
    // Dispatches queued before their attempt row exists. A report already
    // counted in `inProgress` is not counted twice (the strip adds both).
    const inflightDispatches = new Set(
      (inflightRes.data ?? [])
        .map((d) => d.report_id as string)
        .filter((rid) => truths.get(rid)?.state !== 'in_flight'),
    ).size
    const successRatePct = completed + failed > 0
      ? Math.round((completed / (completed + failed)) * 100)
      : null

    let topPriority: typeof empty.topPriority = 'healthy'
    let topPriorityLabel: string | null = null
    let topPriorityTo: string | null = null

    if (!hasGithub) {
      topPriority = 'no_github'
      topPriorityLabel = 'Connect GitHub to enable auto-fix PR dispatch.'
      topPriorityTo = '/integrations/config'
    } else if (indexedFiles === 0) {
      topPriority = 'no_index'
      topPriorityLabel = 'Index your codebase to ground auto-fix in real file context.'
      topPriorityTo = '/integrations/config'
    } else if (failed > 0) {
      topPriority = 'failed'
      topPriorityLabel =
        retryable > 0
          ? `${failed} report${failed === 1 ? '' : 's'} still unfixed after the last attempt — ${retryable} can be retried now; open the rest to read why.`
          : `${failed} report${failed === 1 ? '' : 's'} still unfixed after the last attempt — open ${failed === 1 ? 'it' : 'each one'} to read why and what to do.`
      topPriorityTo = `/fixes?status=failed&project=${encodeURIComponent(pid)}`
    } else if (inflightDispatches + inProgress > 0) {
      topPriority = 'inflight'
      topPriorityLabel = `${inflightDispatches + inProgress} fix${inflightDispatches + inProgress === 1 ? '' : 'es'} dispatching — check back shortly.`
      topPriorityTo = '/fixes?status=running'
    } else if (prsOpen > 0) {
      topPriority = 'waiting'
      topPriorityLabel = `${prsOpen} PR${prsOpen === 1 ? '' : 's'} open — merge or close to advance the loop.`
      topPriorityTo = '/repo?tab=prs'
    } else {
      topPriorityLabel = `${completed} report${completed === 1 ? '' : 's'} fixed in the last 30 days.`
      topPriorityTo = '/fixes'
    }

    return c.json({
      ok: true,
      data: {
        hasAnyProject: true,
        projectId: pid,
        projectName: activeProject.name ?? null,
        projectCount: projectIds.length,
        hasGithub,
        codebaseIndexEnabled: indexedFiles > 0,
        indexedFiles,
        totalAttempts: attempts.length,
        failed,
        retryable,
        inProgress,
        completed,
        prsOpen,
        prsCiPassing,
        specWarnings,
        inflightDispatches,
        topFailureCategory: topEntry?.category ?? null,
        topFailureCount: topEntry?.count ?? 0,
        successRatePct,
        topPriority,
        topPriorityLabel,
        topPriorityTo,
      },
    })
  })

  app.get('/v1/admin/fixes', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    // Teams v1: use accessibleProjectIds() so collaborators reached via
    // organization membership (the new normal) AND project_members rows
    // (legacy / per-project shares) AND direct owner_id all see the same
    // pipeline. The previous project_members-only filter showed "0 fixes"
    // to invited org members.
    const projectIds = await callerProjectIds(c, db, userId);
    if (projectIds.length === 0) return c.json({ ok: true, data: { fixes: [] } });

    // Optional `q` substring search — the admin command palette needs fast
    // alias-matching against summary/rationale/branch, otherwise live search
    // never surfaces in-flight or completed fixes by their change text.
    const search = c.req.query('q')?.trim();
    const queryLimit = Math.min(Number(c.req.query('limit')) || 50, 200);
    // One report's attempts (the report page's progress panel). Without it
    // the panel searched the 50 newest fixes client-side and showed nothing
    // for a report whose fix was older.
    const reportIdParam = c.req.query('report_id')?.trim();
    if (reportIdParam && !/^[0-9a-f-]{36}$/i.test(reportIdParam)) {
      return c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'report_id must be a report id' } }, 400);
    }

    let query = db
      .from('fix_attempts')
      .select(
        'id, report_id, project_id, agent, branch, pr_url, pr_number, commit_sha, status, files_changed, lines_changed, summary, rationale, review_passed, started_at, completed_at, created_at, langfuse_trace_id, llm_model, llm_input_tokens, llm_output_tokens, check_run_status, check_run_conclusion, pr_state, merged_at, error, spec_validation_warnings, inventory_action_node_id, failure_category',
      )
      .in('project_id', projectIds)
      .order('started_at', { ascending: false })
      .limit(queryLimit);

    if (reportIdParam) query = query.eq('report_id', reportIdParam);
    if (search) {
      const escaped = search.replace(/[%,]/g, '');
      query = query.or(
        `summary.ilike.%${escaped}%,rationale.ilike.%${escaped}%,branch.ilike.%${escaped}%`,
      );
    }

    const { data } = await query;
    const fixes = data ?? [];

    // Every row carries its report's CURRENT fix state, so the console can
    // show "Superseded — fixed by PR #N" instead of a red failure, and only
    // offer Retry on reports that are still unfixed (fix-report-truth.ts).
    const loaded = await loadReportFixTruths(
      db as unknown as Parameters<typeof loadReportFixTruths>[0],
      fixes.map((f) => f.report_id as string),
    );
    const enriched = fixes.map((f) => {
      const t = loaded.truths.get(f.report_id as string);
      const report = loaded.reports.get(f.report_id as string);
      return {
        ...f,
        report_title: reportTitle(report),
        report_status: report?.status ?? null,
        report_fix_state: t?.state ?? null,
        report_fixed_by_pr: t?.mergedPrNumber ?? null,
        is_latest_attempt: t ? t.latestAttemptId === f.id : null,
        retryable: t ? t.retryable && t.latestAttemptId === f.id : false,
        credential_block: t && t.latestAttemptId === f.id ? t.credential : null,
      };
    });

    return c.json({ ok: true, data: { fixes: enriched } });
  });

  app.post('/v1/admin/fixes', adminOrApiKey({ scope: 'mcp:write' }), async (c) => {
    // withIdempotency: submit_fix_result (MCP) sends a stable derived
    // Idempotency-Key so a retried call must not insert a second
    // fix_attempts row — the wrapper was opt-in and this route never opted
    // in, so the key was silently ignored (2026-08-16 resilience audit C7).
    return withIdempotency(c, async () => {
    const userId = c.get('userId') as string;
    const body = await c.req.json();
    const db = getServiceClient();

    const projectIds = await callerProjectIds(c, db, userId);

    const { data: report } = await db
      .from('reports')
      .select('id, project_id')
      .eq('id', body.reportId)
      .in('project_id', projectIds)
      .single();

    if (!report)
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Report not found' } }, 404);

    const { data: fix, error } = await db
      .from('fix_attempts')
      .insert({
        report_id: report.id,
        project_id: report.project_id,
        agent: body.agent ?? 'claude_code',
        status: 'pending',
      })
      .select('id')
      .single();

    if (error) return dbError(c, error);

    return c.json({ ok: true, data: { fixId: fix!.id } });
    }); // withIdempotency
  });

  // Aggregate KPIs for the Fixes page header — last 30 days.
  // MUST be registered before /v1/admin/fixes/:id so Hono doesn't match
  // the literal "summary" segment as a fix id.
  app.get('/v1/admin/fixes/summary', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await scopedOwnedProjectIds(c, db, userId);
    if (projectIds.length === 0) {
      return c.json({
        ok: true,
        data: {
          total: 0,
          completed: 0,
          failed: 0,
          retryable: 0,
          inProgress: 0,
          prsOpen: 0,
          prsCiPassing: 0,
          prsMerged: 0,
          specWarnings: 0,
          failureBreakdown: [],
          days: [],
        },
      });
    }
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 29);
    since.setUTCHours(0, 0, 0, 0);

    const { data: rows } = await db
      .from('fix_attempts')
      .select(
        'id, report_id, status, pr_url, pr_number, pr_state, merged_at, check_run_conclusion, started_at, completed_at, created_at, spec_validation_warnings, failure_category',
      )
      .in('project_id', projectIds)
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: true })
      .limit(500);

    const list = rows ?? [];
    // Headline counts are per REPORT from its current state, the same rule
    // as /fixes/stats (fix-report-truth.ts). The per-day series below stays
    // per attempt: it is the history of runs, not the current state.
    const { truths } = await loadRecentFixTruths(db as unknown as Parameters<typeof loadRecentFixTruths>[0], projectIds);
    const truth = summarizeFixTruths(truths.values());
    const completed = truth.fixed;
    const failed = truth.failed;
    const inProgress = truth.inFlight;
    const prsOpen = truth.prOpen;
    const prsCiPassing = list.filter((r) => r.check_run_conclusion === 'success').length;
    // Loop-closure: count fix_attempts whose validateAgainstSpec gate raised
    // at least one soft warning over the trailing 30d. Surfaced as a tile
    // on the Fixes summary so operators can spot a trend ("12 fixes this
    // week skipped the spec gate — investigate the inventory contract")
    // before the warnings degrade into actual regressions.
    const specWarnings = list.filter((r) => {
      const w = r.spec_validation_warnings as unknown;
      return Array.isArray(w) && w.length > 0;
    }).length;

    // Why the still-unfixed reports failed, by the cause of their latest
    // attempt, most common first.
    const failureBreakdown = truth.failureBreakdown;

    const days: { day: string; total: number; completed: number; failed: number }[] = [];
    for (let i = 0; i < 30; i++) {
      const d = new Date(since);
      d.setUTCDate(since.getUTCDate() + i);
      days.push({ day: d.toISOString().slice(0, 10), total: 0, completed: 0, failed: 0 });
    }
    const byDay = new Map(days.map((d) => [d.day, d]));
    for (const r of list) {
      const k = String(r.created_at).slice(0, 10);
      const bucket = byDay.get(k);
      if (!bucket) continue;
      bucket.total++;
      if (isFixCountedFailed(r)) bucket.failed++;
      else if (r.status === 'completed') bucket.completed++;
    }

    return c.json({
      ok: true,
      data: {
        total: list.length,
        completed,
        failed,
        retryable: truth.retryable,
        inProgress,
        prsOpen,
        prsCiPassing,
        // Deprecated alias so a stale admin FE deployed before this rename
        // doesn't blank-out the tile. Drop after one release cycle.
        prsMerged: prsCiPassing,
        specWarnings,
        failureBreakdown,
        days,
      },
    });
  });

  app.get('/v1/admin/fixes/:id', jwtAuth, async (c) => {
    const fixId = c.req.param('id')!;
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await callerProjectIds(c, db, userId);
    const { data } = await db
      .from('fix_attempts')
      .select(
        'id, report_id, project_id, agent, branch, pr_url, commit_sha, status, files_changed, lines_changed, summary, review_passed, review_reasoning, error, started_at, completed_at, created_at',
      )
      .eq('id', fixId)
      .in('project_id', projectIds)
      .single();
    if (!data)
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Fix not found' } }, 404);
    return c.json({ ok: true, data });
  });

  // ---------------------------------------------------------------------------
  // Manual CI sync. Webhooks can drop (App not subscribed, webhook URL not
  // registered, GitHub flaky), and without a refresh the PDCA "Check" stage
  // stays null forever. This endpoint lets the user pull the latest
  // check-run conclusion on demand; the `mushi-ci-sync-10m` pg_cron runs the
  // same sync periodically for every completed attempt.
  // ---------------------------------------------------------------------------
  app.post('/v1/admin/fixes/:id/refresh-ci', adminOrApiKey({ scope: 'mcp:write' }), async (c) => {
    const fixId = c.req.param('id')!;
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const { data: attempt } = await db
      .from('fix_attempts')
      .select('id, project_id')
      .eq('id', fixId)
      .maybeSingle();
    if (!attempt) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404);

    const access = await callerCanAccessProject(c, db, userId, attempt.project_id);
    if (!access.allowed) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const internalSecret =
      Deno.env.get('MUSHI_INTERNAL_CALLER_SECRET') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !internalSecret) {
      return c.json({ ok: false, error: { code: 'SERVER_MISCONFIGURED' } }, 500);
    }

    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/ci-sync`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${internalSecret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fix_attempt_id: fixId }),
        signal: AbortSignal.timeout(15_000),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        return c.json(
          {
            ok: false,
            error: {
              code: 'CI_SYNC_FAILED',
              message: body?.error?.message ?? `ci-sync ${res.status}`,
            },
          },
          502,
        );
      }

      const { data: refreshed } = await db
        .from('fix_attempts')
        .select('check_run_status, check_run_conclusion, check_run_updated_at, pr_state, merged_at')
        .eq('id', fixId)
        .maybeSingle();

      return c.json({ ok: true, data: refreshed ?? body?.data ?? {} });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: { code: 'CI_SYNC_TIMEOUT', message: msg } }, 504);
    }
  });

  // ---------------------------------------------------------------------------
  // Merge PR from console — POST /v1/admin/fixes/:id/merge
  //
  // User-confirmed merge (not automatic). Calls GitHub's merge API, then runs
  // the same post-merge bookkeeping as the pull_request.merged webhook:
  // merged_at, report → fixed, reporter notification, fix.applied plugins.
  // ---------------------------------------------------------------------------
  app.post('/v1/admin/fixes/:id/merge', adminOrApiKey({ scope: 'mcp:write' }), async (c) => {
    const fixId = c.req.param('id')!;
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    let body: { mergeMethod?: MergeMethod } = {};
    try {
      body = await c.req.json();
    } catch {
      // empty body ok
    }

    const { data: attempt, error: fetchErr } = await db
      .from('fix_attempts')
      .select(
        'id, project_id, report_id, agent, branch, commit_sha, pr_url, pr_number, merged_at, pr_state, repo_id, summary',
      )
      .eq('id', fixId)
      .maybeSingle();
    if (fetchErr) return dbError(c, fetchErr);
    if (!attempt) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Fix not found' } }, 404);
    }

    const access = await callerCanAccessProject(c, db, userId, attempt.project_id);
    if (!access.allowed) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Not a member of this project' } }, 403);
    }

    if (attempt.merged_at || attempt.pr_state === 'merged') {
      const { reportStatus } = await finalizeFixMerge(db, attempt, {
        prUrl: attempt.pr_url!,
        prNumber: attempt.pr_number,
        actorUserId: userId,
      });
      return c.json({
        ok: true,
        data: { alreadyMerged: true, reportId: attempt.report_id, reportStatus },
      });
    }

    if (!attempt.pr_url || !attempt.pr_number) {
      return c.json(
        {
          ok: false,
          error: { code: 'NO_PR', message: 'This fix has no open pull request to merge' },
        },
        409,
      );
    }

    const ref = parsePrRepoRef(attempt.pr_url);
    if (!ref) {
      return c.json(
        { ok: false, error: { code: 'INVALID_PR_URL', message: 'Could not parse GitHub repo from PR URL' } },
        400,
      );
    }

    const installationId = await installationIdForAttempt(db, attempt);
    const token = await resolveProjectGithubToken(db, attempt.project_id, installationId);
    if (!token) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'GITHUB_NOT_CONNECTED',
            message: 'Connect GitHub (App or PAT) before merging from the console',
          },
        },
        409,
      );
    }

    let mergeResult;
    try {
      mergeResult = await mergeGithubPullRequest(token, ref, attempt.pr_number, {
        mergeMethod: body.mergeMethod ?? 'squash',
        commitTitle: attempt.summary
          ? `fix: ${String(attempt.summary).slice(0, 72)}`
          : undefined,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: { code: 'GITHUB_MERGE_FAILED', message: msg } }, 502);
    }

    if (!mergeResult.merged && !mergeResult.alreadyMerged) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'NOT_MERGEABLE',
            message: mergeResult.message ?? 'GitHub rejected the merge',
          },
        },
        409,
      );
    }

    const { justMerged, reportStatus } = await finalizeFixMerge(db, attempt, {
      prUrl: attempt.pr_url,
      prNumber: attempt.pr_number,
      repository: `${ref.owner}/${ref.repo}`,
      actorUserId: userId,
      // A fresh merge happened just now; an already-merged PR keeps GitHub's time.
      mergedAt: mergeResult.alreadyMerged ? mergeResult.mergedAt ?? null : null,
    });

    await logAudit(
      db,
      attempt.project_id,
      userId,
      'fix.merge',
      'fix_attempt',
      attempt.id,
      { report_id: attempt.report_id, pr_number: attempt.pr_number },
    ).catch(() => null);

    return c.json({
      ok: true,
      data: {
        merged: true,
        alreadyMerged: mergeResult.alreadyMerged,
        justMerged,
        reportId: attempt.report_id,
        reportStatus,
        sha: mergeResult.sha ?? null,
      },
    });
  });

  // PDCA timeline for a single fix attempt — merges fix_dispatch_jobs +
  // fix_attempts + check-run signals into an ordered event stream so the UI
  // can render a real branch graph.
  app.get('/v1/admin/fixes/:id/timeline', adminOrApiKey(), async (c) => {
    const fixId = c.req.param('id')!;
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await callerProjectIds(c, db, userId);
    if (projectIds.length === 0)
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Fix not found' } }, 404);

    const FIX_ATTEMPT_COLUMNS =
      'id, report_id, project_id, repo_id, agent, branch, pr_url, pr_number, pr_state, merged_at, commit_sha, status, lines_changed, files_changed, llm_model, started_at, completed_at, created_at, check_run_status, check_run_conclusion, check_run_updated_at, error';
    let { data: fix } = await db
      .from('fix_attempts')
      .select(FIX_ATTEMPT_COLUMNS)
      .eq('id', fixId)
      .in('project_id', projectIds)
      .maybeSingle();
    // `dispatch_fix` hands MCP clients the dispatch-job id (the fix_attempt
    // row is created by the worker seconds later), so accept either id here.
    // A queued job with no attempt yet gets a synthesised one-event timeline
    // instead of a 404 — polling right after dispatch must never dead-end.
    let dispatchByJobId: {
      id: string;
      status: string;
      created_at: string;
      started_at: string | null;
      finished_at: string | null;
      error: string | null;
    } | null = null;
    if (!fix) {
      const { data: job } = await db
        .from('fix_dispatch_jobs')
        .select('id, fix_attempt_id, project_id, status, created_at, started_at, finished_at, error')
        .eq('id', fixId)
        .in('project_id', projectIds)
        .maybeSingle();
      if (!job)
        return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Fix not found' } }, 404);
      dispatchByJobId = job;
      if (job.fix_attempt_id) {
        ({ data: fix } = await db
          .from('fix_attempts')
          .select(FIX_ATTEMPT_COLUMNS)
          .eq('id', job.fix_attempt_id)
          .maybeSingle());
      }
      if (!fix) {
        const events = [
          {
            kind: 'dispatched',
            at: job.created_at,
            label: job.status === 'failed' ? 'Dispatch failed' : 'Dispatch queued — worker not started yet',
            detail: job.error ?? undefined,
            status: job.status === 'failed' ? 'fail' : 'pending',
          },
        ];
        return c.json({ ok: true, data: { fix: null, dispatch: job, events, source: 'synthesized' } });
      }
    }

    const { data: dispatch } = dispatchByJobId
      ? { data: dispatchByJobId }
      : await db
          .from('fix_dispatch_jobs')
          .select('id, status, created_at, started_at, finished_at, error')
          .eq('fix_attempt_id', fix.id)
          .maybeSingle();

    // Preferred source: the append-only `fix_events` stream written by the
    // GitHub webhook handler (push / pull_request / check_run) and ci-sync.
    // Stored rows win per kind; stages they lack are filled from the attempt
    // columns (see _shared/fix-timeline.ts).
    const { data: storedEvents } = await db
      .from('fix_events')
      .select('kind, status, label, detail, at')
      .eq('fix_attempt_id', fix.id)
      .order('at', { ascending: true })
      .limit(200);

    // The graph's base lane: the repo the attempt targeted, else the
    // project's primary repo. Never a hard-coded 'main' — this repo is 'master'.
    const repoQuery = db.from('project_repos').select('default_branch');
    const { data: repoRow } = fix.repo_id
      ? await repoQuery.eq('id', fix.repo_id).maybeSingle()
      : await repoQuery.eq('project_id', fix.project_id).eq('is_primary', true).limit(1).maybeSingle();
    const baseBranch = (repoRow?.default_branch as string | null | undefined) ?? null;

    if (storedEvents && storedEvents.length > 0) {
      const events = mergeStoredFixTimeline(
        dispatch ?? null,
        fix,
        storedEvents.map((e) => ({
          kind: e.kind as FixTimelineEvent['kind'],
          at: e.at,
          label: e.label,
          detail: e.detail ?? undefined,
          status: (e.status ?? undefined) as FixTimelineEvent['status'],
        })),
      );
      return c.json({ ok: true, data: { fix, dispatch, events, base_branch: baseBranch, source: 'fix_events' } });
    }

    const events = synthesizeFixTimeline(dispatch ?? null, fix);
    return c.json({ ok: true, data: { fix, dispatch, events, base_branch: baseBranch, source: 'synthesized' } });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Repo-wide branch & PR graph endpoints
  //
  // These power the `/repo` admin page (V5.3 §2.18 — visualise the PR pipeline
  // at repo level, not just per-report). Auth model mirrors `/v1/admin/fixes`:
  // scoped to the current user's projects via `ownedProjectIds`. The caller
  // passes `project_id` so multi-project owners can toggle between repos
  // without us guessing.
  // ─────────────────────────────────────────────────────────────────────────

  // GET /v1/admin/repo/stats — RepoStatusBanner posture data.
  app.get('/v1/admin/repo/stats', jwtAuth, async (c) => {
    const userId = c.get('userId') as string
    const db = getServiceClient()

    const empty = {
      hasAnyProject: false,
      projectId: null as string | null,
      projectName: null as string | null,
      projectCount: 0,
      hasRepo: false,
      repoUrl: null as string | null,
      defaultBranch: null as string | null,
      hasGithubApp: false,
      indexingEnabled: false,
      lastIndexedAt: null as string | null,
      indexedFiles: 0,
      totalBranches: 0,
      prOpen: 0,
      ciPassing: 0,
      ciFailed: 0,
      merged: 0,
      failedToOpen: 0,
      topPriority: 'no_project' as
        | 'no_project' | 'no_repo' | 'no_github_app' | 'ci_failing'
        | 'stuck' | 'waiting' | 'healthy',
      topPriorityLabel: null as string | null,
      topPriorityTo: null as string | null,
    }

    const projectIds = await callerProjectIds(c, db, userId)
    if (projectIds.length === 0) return c.json({ ok: true, data: empty })

    const resolvedProject = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () =>
        c.json({ ok: true, data: { ...empty, hasAnyProject: true, projectCount: projectIds.length } }),
    })
    if ('response' in resolvedProject) return resolvedProject.response
    const activeProject = resolvedProject.project
    const pid = activeProject.id

    const [integrationRes, attemptsRes, codebaseRes, reposRes, settingsRes] = await Promise.all([
      db.from('project_integrations')
        .select('provider, enabled, config')
        .eq('project_id', pid)
        .eq('provider', 'github')
        .maybeSingle(),
      db.from('fix_attempts')
        .select('id, status, pr_url, check_run_conclusion, created_at')
        .eq('project_id', pid)
        .not('pr_url', 'is', null)
        .order('created_at', { ascending: false })
        .limit(200),
      db.from('project_codebase_files')
        .select('id, updated_at', { count: 'exact', head: false })
        .eq('project_id', pid)
        .order('updated_at', { ascending: false })
        .limit(1),
      // Check project_repos table (multi-repo path, authoritative)
      db.from('project_repos')
        .select('repo_url, github_app_installation_id')
        .eq('project_id', pid)
        .limit(10),
      // Legacy fallback: project_settings.github_repo_url
      db.from('project_settings')
        .select('github_repo_url')
        .eq('project_id', pid)
        .maybeSingle(),
    ])

    const integration = integrationRes.data
    const repoRows = reposRes.data ?? []
    const primaryRepo = repoRows.find((r) => r.repo_url) ?? repoRows[0] ?? null

    // hasRepo: check project_repos first (multi-repo), then legacy integration config,
    // then project_settings. This matches the /repo/overview logic so the banner
    // and the repo card agree on whether a repo is configured.
    const hasRepo = Boolean(
      primaryRepo?.repo_url ||
      (integration?.config as Record<string, unknown> | null)?.repo_url ||
      settingsRes.data?.github_repo_url,
    )
    const repoUrl =
      primaryRepo?.repo_url ??
      ((integration?.config as Record<string, unknown> | null)?.repo_url as string | null) ??
      settingsRes.data?.github_repo_url ??
      null
    // hasGithubApp: GitHub App installation on any linked repo OR the legacy enabled flag
    const hasGithubApp = repoRows.some((r) => r.github_app_installation_id) || !!(integration?.enabled)
    const indexedFiles = codebaseRes.count ?? 0
    const lastIndexedAt = codebaseRes.data?.[0]?.updated_at ?? null

    const attempts = attemptsRes.data ?? []
    const prOpen = attempts.filter((a) => a.pr_url && a.status === 'completed').length
    const ciPassing = attempts.filter((a) => a.check_run_conclusion === 'success').length
    const ciFailed = attempts.filter((a) =>
      a.check_run_conclusion && a.check_run_conclusion !== 'success' && a.check_run_conclusion !== 'neutral'
    ).length
    const merged = 0
    const failedToOpen = attempts.filter((a) => a.status === 'failed').length

    let topPriority: typeof empty.topPriority = 'healthy'
    let topPriorityLabel: string | null = null
    let topPriorityTo: string | null = null

    if (!hasRepo) {
      topPriority = 'no_repo'
      topPriorityLabel = 'No GitHub repository configured — connect one to start dispatching PRs.'
      topPriorityTo = '/integrations/config'
    } else if (!hasGithubApp) {
      topPriority = 'no_github_app'
      topPriorityLabel = 'GitHub integration is disconnected — re-enable it to restore PR dispatch.'
      topPriorityTo = '/integrations/config'
    } else if (ciFailed > 0) {
      topPriority = 'ci_failing'
      topPriorityLabel = `${ciFailed} PR${ciFailed === 1 ? '' : 's'} have failing CI — review before merging.`
      topPriorityTo = '/repo?tab=prs'
    } else if (failedToOpen > 0) {
      topPriority = 'stuck'
      topPriorityLabel = `${failedToOpen} fix${failedToOpen === 1 ? '' : 'es'} failed to open a PR — retry from Fixes.`
      topPriorityTo = '/fixes?status=failed'
    } else if (prOpen > 0) {
      topPriority = 'waiting'
      topPriorityLabel = `${prOpen} PR${prOpen === 1 ? '' : 's'} open and awaiting review.`
      topPriorityTo = '/repo?tab=prs'
    } else {
      topPriorityLabel = `${ciPassing} PR${ciPassing === 1 ? '' : 's'} passing CI.`
      topPriorityTo = '/repo'
    }

    return c.json({
      ok: true,
      data: {
        hasAnyProject: true,
        projectId: pid,
        projectName: activeProject.name ?? null,
        projectCount: projectIds.length,
        hasRepo,
        repoUrl,
        defaultBranch: null,
        hasGithubApp,
        indexingEnabled: indexedFiles > 0,
        lastIndexedAt,
        indexedFiles,
        totalBranches: 0,
        prOpen,
        ciPassing,
        ciFailed,
        merged,
        failedToOpen,
        topPriority,
        topPriorityLabel,
        topPriorityTo,
      },
    })
  })

  app.get('/v1/admin/repo/overview', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectId = c.req.query('project_id');
    if (!projectId) {
      return c.json(
        { ok: false, error: { code: 'BAD_REQUEST', message: 'project_id is required' } },
        400,
      );
    }

    // Authz: owner OR org-member OR project-member — single helper covers
    // all three (Teams v1 collaborators don't always have project_members
    // rows because membership is granted at the org level).
    const access = await callerCanAccessProject(c, db, userId, projectId);
    if (!access.allowed) {
      return c.json(
        { ok: false, error: { code: 'FORBIDDEN', message: 'Not a member of this project' } },
        403,
      );
    }

    const [{ data: primaryRepo }, { data: settings }, { data: fixes }] = await Promise.all([
      db
        .from('project_repos')
        // Coverage (gap 16a): a capped repo never sets last_indexed_at, so the
        // Repo page reads the last sweep of either kind.
        .select(
          'repo_url, default_branch, github_app_installation_id, last_indexed_at, indexing_enabled, index_swept_at, index_coverage_state, index_files_indexed, index_files_eligible',
        )
        .eq('project_id', projectId)
        .eq('is_primary', true)
        .maybeSingle(),
      db
        .from('project_settings')
        .select('github_repo_url, codebase_repo_url')
        .eq('project_id', projectId)
        .maybeSingle(),
      db
        .from('fix_attempts')
        .select(
          'id, report_id, branch, pr_url, pr_number, commit_sha, pr_state, agent, llm_model, status, check_run_status, check_run_conclusion, files_changed, lines_changed, started_at, completed_at, created_at, summary',
        )
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(50),
    ]);

    // Pull the human-readable summary off the linked reports in one batch
    // rather than joining per-row. Makes the branch list scannable without
    // making the client do another round-trip for each card.
    type ReportLite = { id: string; summary: string | null; user_category: string | null };
    let reportById: Map<string, ReportLite> = new Map();
    if (fixes && fixes.length > 0) {
      const reportIds = Array.from(new Set(fixes.map((f) => f.report_id).filter(Boolean)));
      if (reportIds.length > 0) {
        const { data: reports } = await db
          .from('reports')
          .select('id, summary, user_category')
          .in('id', reportIds);
        reportById = new Map((reports ?? []).map((r) => [r.id, r as ReportLite]));
      }
    }

    const branches = (fixes ?? []).map((f) => {
      const r = reportById.get(f.report_id);
      return {
        id: f.id,
        report_id: f.report_id,
        branch: f.branch,
        pr_url: f.pr_url,
        pr_number: f.pr_number,
        commit_sha: f.commit_sha,
        pr_state: f.pr_state,
        agent: f.agent,
        llm_model: f.llm_model,
        status: f.status,
        check_run_status: f.check_run_status,
        check_run_conclusion: f.check_run_conclusion,
        files_changed: f.files_changed ?? null,
        lines_changed: f.lines_changed,
        started_at: f.started_at,
        completed_at: f.completed_at,
        created_at: f.created_at,
        report_summary: r?.summary ?? null,
        report_category: r?.user_category ?? null,
        summary: f.summary ?? null,
      };
    });

    // Counts are cheap to derive FE-side but computing them here means the
    // header chips never disagree with the branch list rendered below.
    let open = 0;
    let ci_passing = 0;
    let ci_failed = 0;
    let merged = 0;
    let failed_to_open = 0;
    for (const b of branches) {
      const st = (b.status ?? '').toLowerCase();
      const concl = (b.check_run_conclusion ?? '').toLowerCase();
      if (st === 'failed' && !b.pr_url) failed_to_open += 1;
      if (b.pr_url && st !== 'failed') open += 1;
      if (concl === 'success') ci_passing += 1;
      if (concl === 'failure' || concl === 'timed_out') ci_failed += 1;
      if (st === 'completed' && concl === 'success' && b.pr_url) merged += 1;
    }

    const repoUrl =
      primaryRepo?.repo_url ?? settings?.github_repo_url ?? settings?.codebase_repo_url ?? null;

    return c.json({
      ok: true,
      data: {
        repo: {
          repo_url: repoUrl,
          default_branch: primaryRepo?.default_branch ?? null,
          github_app_installation_id: primaryRepo?.github_app_installation_id ?? null,
          last_indexed_at: primaryRepo?.last_indexed_at ?? null,
          indexing_enabled: primaryRepo?.indexing_enabled ?? null,
          index_swept_at: primaryRepo?.index_swept_at ?? null,
          index_coverage_state: primaryRepo?.index_coverage_state ?? null,
          index_files_indexed: primaryRepo?.index_files_indexed ?? null,
          index_files_eligible: primaryRepo?.index_files_eligible ?? null,
        },
        counts: { open, ci_passing, ci_failed, merged, failed_to_open, total: branches.length },
        branches,
      },
    });
  });

  app.get('/v1/admin/repo/activity', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectId = c.req.query('project_id');
    const limit = Math.min(Number(c.req.query('limit')) || 100, 200);
    if (!projectId) {
      return c.json(
        { ok: false, error: { code: 'BAD_REQUEST', message: 'project_id is required' } },
        400,
      );
    }
    // Authz: owner OR org-member OR project-member.
    const access = await callerCanAccessProject(c, db, userId, projectId);
    if (!access.allowed) {
      return c.json(
        { ok: false, error: { code: 'FORBIDDEN', message: 'Not a member of this project' } },
        403,
      );
    }

    // We don't have a dedicated `fix_events` table yet, so we derive a
    // repo-wide activity stream from the timestamps already stamped on
    // `fix_attempts` (+ its companion dispatch row). Each fix_attempt can
    // contribute up to 5 events; cap on row count + per-row synthesis keeps
    // the response well under a second.
    const { data: fixes } = await db
      .from('fix_attempts')
      .select(
        'id, report_id, branch, pr_url, pr_number, status, check_run_status, check_run_conclusion, commit_sha, started_at, completed_at, created_at, check_run_updated_at',
      )
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(limit);

    interface RepoActivityEvent {
      at: string;
      kind:
        | 'dispatched'
        | 'branch'
        | 'commit'
        | 'pr_opened'
        | 'ci_resolved'
        | 'completed'
        | 'failed';
      fix_attempt_id: string;
      report_id: string;
      branch: string | null;
      pr_url: string | null;
      pr_number: number | null;
      label: string;
      detail?: string | null;
      status?: 'ok' | 'fail' | 'pending';
    }

    const events: RepoActivityEvent[] = [];
    for (const f of fixes ?? []) {
      const base = {
        fix_attempt_id: f.id,
        report_id: f.report_id,
        branch: f.branch,
        pr_url: f.pr_url,
        pr_number: f.pr_number,
      };
      events.push({
        ...base,
        at: f.created_at,
        kind: 'dispatched',
        label: 'Fix dispatched',
        status: 'pending',
      });
      if (f.branch && f.started_at) {
        events.push({
          ...base,
          at: f.started_at,
          kind: 'branch',
          label: `Branch ${f.branch}`,
          detail: f.branch,
          status: 'ok',
        });
      }
      if (f.commit_sha) {
        events.push({
          ...base,
          at: f.completed_at ?? f.started_at ?? f.created_at,
          kind: 'commit',
          label: `Commit ${f.commit_sha.slice(0, 7)}`,
          detail: f.commit_sha,
          status: 'ok',
        });
      }
      if (f.pr_url) {
        events.push({
          ...base,
          at: f.completed_at ?? f.started_at ?? f.created_at,
          kind: 'pr_opened',
          label: `PR #${f.pr_number ?? '—'} opened`,
          detail: f.pr_url,
          status: 'ok',
        });
      }
      if (f.check_run_conclusion) {
        const concl = f.check_run_conclusion.toLowerCase();
        events.push({
          ...base,
          at: f.check_run_updated_at ?? f.completed_at ?? f.created_at,
          kind: 'ci_resolved',
          label: `CI ${concl}`,
          status: concl === 'success' ? 'ok' : 'fail',
        });
      }
      if (f.status === 'completed') {
        events.push({
          ...base,
          at: f.completed_at ?? f.created_at,
          kind: 'completed',
          label: 'Fix completed',
          status: 'ok',
        });
      } else if (f.status === 'failed') {
        events.push({
          ...base,
          at: f.completed_at ?? f.created_at,
          kind: 'failed',
          label: 'Fix failed',
          status: 'fail',
        });
      }
    }

    events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

    return c.json({ ok: true, data: { events: events.slice(0, limit) } });
  });

  app.patch('/v1/admin/fixes/:id', adminOrApiKey({ scope: 'mcp:write' }), async (c) => {
    const fixId = c.req.param('id')!;
    const userId = c.get('userId') as string;
    const body = await c.req.json();
    const db = getServiceClient();
    const projectIds = await callerProjectIds(c, db, userId);

    const allowed: Record<string, boolean> = {
      status: true,
      branch: true,
      pr_url: true,
      commit_sha: true,
      files_changed: true,
      lines_changed: true,
      summary: true,
      review_passed: true,
      review_reasoning: true,
      error: true,
      completed_at: true,
    };
    const updates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      if (allowed[key]) updates[key] = value;
    }

    const { error } = await db
      .from('fix_attempts')
      .update(updates)
      .eq('id', fixId)
      .in('project_id', projectIds);
    if (error) return dbError(c, error);

    if (updates.status === 'completed' && updates.pr_url) {
      const { data: fix } = await db
        .from('fix_attempts')
        .select('report_id, project_id, agent, branch, pr_url, commit_sha')
        .eq('id', fixId)
        .in('project_id', projectIds)
        .single();
      if (fix) {
        await db
          .from('reports')
          .update({
            fix_branch: updates.branch as string,
            fix_pr_url: updates.pr_url as string,
            fix_commit_sha: updates.commit_sha as string,
          })
          .eq('id', fix.report_id)
          .in('project_id', projectIds);
        try {
          dispatchPluginEventDetached(db, fix.project_id, 'fix.applied', {
            report: { id: fix.report_id },
            fix: {
              id: fixId,
              agent: fix.agent,
              branch: updates.branch ?? fix.branch,
              prUrl: updates.pr_url ?? fix.pr_url,
              commitSha: updates.commit_sha ?? fix.commit_sha,
            },
          }).catch((e) =>
            log.warn('Plugin dispatch failed', { event: 'fix.applied', err: String(e) }),
          );
        } catch (e) {
          log.warn('Plugin dispatch failed (sync)', { event: 'fix.applied', err: String(e) });
        }
      }
    } else if (updates.status === 'failed') {
      const { data: fix } = await db
        .from('fix_attempts')
        .select('report_id, project_id, agent, error')
        .eq('id', fixId)
        .in('project_id', projectIds)
        .single();
      if (fix) {
        try {
          dispatchPluginEventDetached(db, fix.project_id, 'fix.failed', {
            report: { id: fix.report_id },
            fix: { id: fixId, agent: fix.agent, error: updates.error ?? fix.error },
          }).catch((e) =>
            log.warn('Plugin dispatch failed', { event: 'fix.failed', err: String(e) }),
          );
        } catch (e) {
          log.warn('Plugin dispatch failed (sync)', { event: 'fix.failed', err: String(e) });
        }
      }
    } else if (updates.status === 'proposed') {
      const { data: fix } = await db
        .from('fix_attempts')
        .select('report_id, project_id, agent, branch, pr_url')
        .eq('id', fixId)
        .in('project_id', projectIds)
        .single();
      if (fix) {
        try {
          dispatchPluginEventDetached(db, fix.project_id, 'fix.proposed', {
            report: { id: fix.report_id },
            fix: {
              id: fixId,
              agent: fix.agent,
              branch: updates.branch ?? fix.branch,
              prUrl: updates.pr_url ?? fix.pr_url,
            },
          }).catch((e) =>
            log.warn('Plugin dispatch failed', { event: 'fix.proposed', err: String(e) }),
          );
        } catch (e) {
          log.warn('Plugin dispatch failed (sync)', { event: 'fix.proposed', err: String(e) });
        }
      }
    }

    return c.json({ ok: true });
  });

  // ── Multi-repo CRUD (/v1/admin/repo/repos) ─────────────────────────────────
  // GET  — list all project_repos for the active project
  // POST — add a new repo (role + path_globs + repo_url)
  // PUT  — update an existing repo by id
  // DELETE — remove a repo by id
  //
  // GET also takes an API key (mcp:read): `mushi fix --repo owner/name`
  // resolves the name to a project_repos.id here. A project-bound key only
  // reads its own project (callerCanAccessProject).

  app.get('/v1/admin/repo/repos', adminOrApiKey(), async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectId = c.req.query('project_id');
    if (!projectId) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'project_id required' } }, 400);
    }
    const access = await callerCanAccessProject(c, db, userId, projectId);
    if (!access.allowed) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Not a member' } }, 403);
    }
    const { data, error } = await db
      .from('project_repos')
      .select('id, repo_url, default_branch, github_app_installation_id, indexing_enabled, last_indexed_at, index_swept_at, index_coverage_state, index_files_indexed, index_files_eligible, role, path_globs, is_primary, created_at, updated_at')
      .eq('project_id', projectId)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true });
    if (error) return dbError(c, error);
    return c.json({ ok: true, data: data ?? [] });
  });

  app.post('/v1/admin/repo/repos', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const body = (await c.req.json().catch(() => ({}))) as {
      projectId?: string;
      repoUrl?: string;
      role?: string;
      pathGlobs?: string[];
      defaultBranch?: string;
      isPrimary?: boolean;
    };
    if (!body.projectId || !body.repoUrl) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'projectId and repoUrl required' } }, 400);
    }
    const access = await callerCanAccessProject(c, db, userId, body.projectId);
    if (!access.allowed) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Not a member' } }, 403);
    }
    // Normalize repo URL (strip trailing .git, trailing slash)
    const repoUrl = body.repoUrl.trim().replace(/\.git$/, '').replace(/\/$/, '');
    const validRoles = ['frontend', 'backend', 'monorepo', 'library', 'docs', 'other'];
    const role = validRoles.includes(body.role ?? '') ? body.role : 'monorepo';
    // The repo form pre-fills "main"; store the branch GitHub really has.
    const parsedRepo = parseGithubRepoUrl(repoUrl);
    const { branch: defaultBranch } = parsedRepo
      ? await resolveBranchForConnect({
          token: await resolveProjectGithubToken(db, body.projectId),
          owner: parsedRepo.owner,
          repo: parsedRepo.repo,
          requested: body.defaultBranch,
        })
      : { branch: body.defaultBranch?.trim() || 'main' };
    const { data, error } = await db
      .from('project_repos')
      .insert({
        project_id: body.projectId,
        repo_url: repoUrl,
        role,
        path_globs: body.pathGlobs ?? null,
        default_branch: defaultBranch,
        is_primary: body.isPrimary ?? false,
        indexing_enabled: true,
      })
      .select('id, repo_url, role, path_globs, default_branch, is_primary, created_at')
      .single();
    if (error) return dbError(c, error);
    return c.json({ ok: true, data });
  });

  app.put('/v1/admin/repo/repos/:repoId', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const repoId = c.req.param('repoId')!;
    const db = getServiceClient();
    const body = (await c.req.json().catch(() => ({}))) as {
      projectId?: string;
      repoUrl?: string;
      role?: string;
      pathGlobs?: string[];
      defaultBranch?: string;
      isPrimary?: boolean;
      indexingEnabled?: boolean;
    };
    if (!body.projectId) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'projectId required' } }, 400);
    }
    const access = await callerCanAccessProject(c, db, userId, body.projectId);
    if (!access.allowed) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Not a member' } }, 403);
    }
    const validRoles = ['frontend', 'backend', 'monorepo', 'library', 'docs', 'other'];
    const updates: Record<string, unknown> = {};
    if (body.repoUrl !== undefined) updates.repo_url = body.repoUrl.trim().replace(/\.git$/, '').replace(/\/$/, '');
    if (body.role !== undefined && validRoles.includes(body.role)) updates.role = body.role;
    if (body.pathGlobs !== undefined) updates.path_globs = body.pathGlobs;
    if (body.defaultBranch !== undefined) updates.default_branch = body.defaultBranch;
    if (body.isPrimary !== undefined) updates.is_primary = body.isPrimary;
    if (body.indexingEnabled !== undefined) updates.indexing_enabled = body.indexingEnabled;
    const { data, error } = await db
      .from('project_repos')
      .update(updates)
      .eq('id', repoId)
      .eq('project_id', body.projectId)
      .select('id, repo_url, role, path_globs, default_branch, is_primary, indexing_enabled, updated_at')
      .single();
    if (error) return dbError(c, error);
    return c.json({ ok: true, data });
  });

  app.delete('/v1/admin/repo/repos/:repoId', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const repoId = c.req.param('repoId')!;
    const db = getServiceClient();
    const projectId = c.req.query('project_id');
    if (!projectId) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'project_id required' } }, 400);
    }
    const access = await callerCanAccessProject(c, db, userId, projectId);
    if (!access.allowed) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Not a member' } }, 403);
    }
    const { error } = await db
      .from('project_repos')
      .delete()
      .eq('id', repoId)
      .eq('project_id', projectId);
    if (error) return dbError(c, error);
    return c.json({ ok: true });
  });
}
