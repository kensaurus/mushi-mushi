import type { Hono, Context } from 'npm:hono@4';
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
import { getActivePlugins, dispatchPluginEvent } from '../../_shared/plugins.ts';
import { getAvailableTags } from '../../_shared/ontology.ts';
import { executeNaturalLanguageQuery } from '../../_shared/nl-query.ts';
import { getPlan, listPlans } from '../../_shared/plans.ts';
import { estimateCallCostUsd } from '../../_shared/pricing.ts';
import { ANTHROPIC_SONNET } from '../../_shared/models.ts';
import { dbError, ownedProjectIds } from '../shared.ts';
import {
  canManageProjectSdkConfig,
  coerceSdkConfigUpdate,
  ingestReport,
  invokeFixWorker,
  normalizeSdkConfig,
  triggerClassification,
  type SdkConfigRow,
} from '../helpers.ts';

export function registerQueryFixesRepoRoutes(app: Hono): void {
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
    const id = c.req.param('id');
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
    const id = c.req.param('id');
    const db = getServiceClient();
    const { error } = await db.from('nl_query_history').delete().eq('id', id).eq('user_id', userId);
    if (error) return dbError(c, error);
    return c.json({ ok: true, data: { deleted: id } });
  });

  // ============================================================
  // PHASE 2: REPORT GROUPS
  // ============================================================

  app.get('/v1/admin/groups', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const { data: projects } = await db.from('projects').select('id').eq('owner_id', userId);
    const projectIds = projects?.map((p) => p.id) ?? [];

    const { data } = await db
      .from('report_groups')
      .select('*, reports:reports(id, summary, category, severity, status, created_at)')
      .in('project_id', projectIds)
      .order('created_at', { ascending: false })
      .limit(50);

    return c.json({ ok: true, data: { groups: data ?? [] } });
  });

  app.post('/v1/admin/groups/:id/merge', jwtAuth, async (c) => {
    const groupId = c.req.param('id');
    const { targetGroupId } = await c.req.json();
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const { data: projects } = await db.from('projects').select('id').eq('owner_id', userId);
    const projectIds = projects?.map((p) => p.id) ?? [];

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

    await db
      .from('reports')
      .update({ report_group_id: targetGroupId })
      .eq('report_group_id', groupId);
    const { count } = await db
      .from('reports')
      .select('id', { count: 'exact', head: true })
      .eq('report_group_id', targetGroupId);
    await db
      .from('report_groups')
      .update({ report_count: count ?? 0 })
      .eq('id', targetGroupId);
    await db.from('report_groups').delete().eq('id', groupId);

    return c.json({ ok: true });
  });

  // ============================================================
  // PHASE 2: FIX VERIFICATIONS
  // ============================================================

  app.get('/v1/admin/verifications', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const { data: projects } = await db.from('projects').select('id').eq('owner_id', userId);
    const projectIds = projects?.map((p) => p.id) ?? [];
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

  app.get('/v1/admin/fixes', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    // Use project_members so collaborators (not just owner_id) see fixes for
    // projects they belong to. Mirrors the membership pattern in dispatches.
    const { data: memberships } = await db
      .from('project_members')
      .select('project_id')
      .eq('user_id', userId);
    const projectIds = (memberships ?? []).map((m) => m.project_id);
    if (projectIds.length === 0) return c.json({ ok: true, data: { fixes: [] } });

    // Optional `q` substring search — the admin command palette needs fast
    // alias-matching against summary/rationale/branch, otherwise live search
    // never surfaces in-flight or completed fixes by their change text.
    const search = c.req.query('q')?.trim();
    const queryLimit = Math.min(Number(c.req.query('limit')) || 50, 200);

    let query = db
      .from('fix_attempts')
      .select(
        'id, report_id, project_id, agent, branch, pr_url, pr_number, commit_sha, status, files_changed, lines_changed, summary, rationale, review_passed, started_at, completed_at, created_at, langfuse_trace_id, llm_model, llm_input_tokens, llm_output_tokens, check_run_status, check_run_conclusion, pr_state, error',
      )
      .in('project_id', projectIds)
      .order('started_at', { ascending: false })
      .limit(queryLimit);

    if (search) {
      const escaped = search.replace(/[%,]/g, '');
      query = query.or(
        `summary.ilike.%${escaped}%,rationale.ilike.%${escaped}%,branch.ilike.%${escaped}%`,
      );
    }

    const { data } = await query;

    return c.json({ ok: true, data: { fixes: data ?? [] } });
  });

  app.post('/v1/admin/fixes', adminOrApiKey({ scope: 'mcp:write' }), async (c) => {
    const userId = c.get('userId') as string;
    const body = await c.req.json();
    const db = getServiceClient();

    const { data: projects } = await db.from('projects').select('id').eq('owner_id', userId);
    const projectIds = projects?.map((p) => p.id) ?? [];

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
  });

  // Aggregate KPIs for the Fixes page header — last 30 days.
  // MUST be registered before /v1/admin/fixes/:id so Hono doesn't match
  // the literal "summary" segment as a fix id.
  app.get('/v1/admin/fixes/summary', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await ownedProjectIds(db, userId);
    if (projectIds.length === 0) {
      return c.json({
        ok: true,
        data: {
          total: 0,
          completed: 0,
          failed: 0,
          inProgress: 0,
          prsOpen: 0,
          prsCiPassing: 0,
          prsMerged: 0,
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
        'id, status, pr_url, pr_number, check_run_conclusion, started_at, completed_at, created_at',
      )
      .in('project_id', projectIds)
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: true })
      .limit(500);

    const list = rows ?? [];
    const completed = list.filter((r) => r.status === 'completed').length;
    const failed = list.filter((r) => r.status === 'failed').length;
    const inProgress = list.filter(
      (r) => r.status === 'queued' || r.status === 'running' || r.status === 'pending',
    ).length;
    // GitHub's `check_run.conclusion` enum is success | failure | neutral |
    // cancelled | skipped | timed_out | action_required | stale — there is no
    // `merged` value, so the old `!== 'merged'` filter was a no-op. Use the
    // attempt's own status as the "open" gate; merge state lives elsewhere.
    const prsOpen = list.filter((r) => r.pr_url && r.status === 'completed').length;
    const prsCiPassing = list.filter((r) => r.check_run_conclusion === 'success').length;

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
      if (r.status === 'completed') bucket.completed++;
      if (r.status === 'failed') bucket.failed++;
    }

    return c.json({
      ok: true,
      data: {
        total: list.length,
        completed,
        failed,
        inProgress,
        prsOpen,
        prsCiPassing,
        // Deprecated alias so a stale admin FE deployed before this rename
        // doesn't blank-out the tile. Drop after one release cycle.
        prsMerged: prsCiPassing,
        days,
      },
    });
  });

  app.get('/v1/admin/fixes/:id', jwtAuth, async (c) => {
    const fixId = c.req.param('id');
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const { data: projects } = await db.from('projects').select('id').eq('owner_id', userId);
    const projectIds = projects?.map((p) => p.id) ?? [];
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
  app.post('/v1/admin/fixes/:id/refresh-ci', jwtAuth, async (c) => {
    const fixId = c.req.param('id');
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const { data: attempt } = await db
      .from('fix_attempts')
      .select('id, project_id')
      .eq('id', fixId)
      .maybeSingle();
    if (!attempt) return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404);

    const { data: membership } = await db
      .from('project_members')
      .select('role')
      .eq('user_id', userId)
      .eq('project_id', attempt.project_id)
      .maybeSingle();
    if (!membership) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);

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
        .select('check_run_status, check_run_conclusion, check_run_updated_at')
        .eq('id', fixId)
        .maybeSingle();

      return c.json({ ok: true, data: refreshed ?? body?.data ?? {} });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: { code: 'CI_SYNC_TIMEOUT', message: msg } }, 504);
    }
  });

  // PDCA timeline for a single fix attempt — merges fix_dispatch_jobs +
  // fix_attempts + check-run signals into an ordered event stream so the UI
  // can render a real branch graph.
  app.get('/v1/admin/fixes/:id/timeline', adminOrApiKey(), async (c) => {
    const fixId = c.req.param('id');
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await ownedProjectIds(db, userId);
    if (projectIds.length === 0)
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Fix not found' } }, 404);

    const { data: fix } = await db
      .from('fix_attempts')
      .select(
        'id, report_id, project_id, agent, branch, pr_url, pr_number, commit_sha, status, lines_changed, files_changed, llm_model, started_at, completed_at, created_at, check_run_status, check_run_conclusion, check_run_updated_at, error',
      )
      .eq('id', fixId)
      .in('project_id', projectIds)
      .single();
    if (!fix)
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Fix not found' } }, 404);

    const { data: dispatch } = await db
      .from('fix_dispatch_jobs')
      .select('id, status, created_at, started_at, finished_at, error')
      .eq('fix_attempt_id', fixId)
      .maybeSingle();

    type EventKind =
      | 'dispatched'
      | 'started'
      | 'branch'
      | 'commit'
      | 'pr_opened'
      | 'ci_started'
      | 'ci_resolved'
      | 'pr_state_changed'
      | 'completed'
      | 'failed';
    interface TimelineEvent {
      kind: EventKind;
      at: string;
      label: string;
      detail?: string | null;
      status?: 'ok' | 'fail' | 'pending' | null;
    }

    // Preferred source: the append-only `fix_events` stream written by the
    // GitHub webhook handler (push / pull_request / check_run). When we have
    // any rows for this attempt we use them verbatim so multi-commit /
    // multi-CI timelines render faithfully. Falls back to the synthesised
    // stream below for pre-`fix_events` attempts.
    const { data: storedEvents } = await db
      .from('fix_events')
      .select('kind, status, label, detail, at')
      .eq('fix_attempt_id', fixId)
      .order('at', { ascending: true })
      .limit(200);

    if (storedEvents && storedEvents.length > 0) {
      const events = storedEvents.map((e) => ({
        kind: e.kind as EventKind,
        at: e.at,
        label: e.label,
        detail: e.detail ?? undefined,
        status: (e.status ?? undefined) as 'ok' | 'fail' | 'pending' | undefined,
      }));
      // Always prepend the dispatch/start events so the graph's top always
      // shows the "how we got here" context even if the webhook stream starts
      // mid-way through (e.g. feature was enabled after the fix ran).
      const leading: TimelineEvent[] = [];
      if (dispatch) {
        leading.push({
          kind: 'dispatched',
          at: dispatch.created_at,
          label: 'Dispatch requested',
          status: 'pending',
        });
        if (dispatch.started_at) {
          leading.push({
            kind: 'started',
            at: dispatch.started_at,
            label: 'Worker started',
            status: 'pending',
          });
        }
      } else if (fix.created_at) {
        leading.push({
          kind: 'dispatched',
          at: fix.created_at,
          label: 'Fix attempt created',
          status: 'pending',
        });
      }
      const combined = [...leading, ...events].sort(
        (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
      );
      return c.json({ ok: true, data: { fix, dispatch, events: combined, source: 'fix_events' } });
    }

    const events: TimelineEvent[] = [];

    if (dispatch) {
      events.push({
        kind: 'dispatched',
        at: dispatch.created_at,
        label: 'Dispatch requested',
        status: 'pending',
      });
      if (dispatch.started_at) {
        events.push({
          kind: 'started',
          at: dispatch.started_at,
          label: 'Worker started',
          status: 'pending',
        });
      }
    } else if (fix.created_at) {
      events.push({
        kind: 'dispatched',
        at: fix.created_at,
        label: 'Fix attempt created',
        status: 'pending',
      });
    }

    if (fix.started_at) {
      events.push({
        kind: 'started',
        at: fix.started_at,
        label: 'Agent started',
        detail: fix.llm_model,
        status: 'pending',
      });
    }
    if (fix.branch) {
      events.push({
        kind: 'branch',
        at: fix.started_at ?? fix.created_at,
        label: 'Branch created',
        detail: fix.branch,
        status: 'ok',
      });
    }
    if (fix.commit_sha) {
      events.push({
        kind: 'commit',
        at: fix.completed_at ?? fix.started_at ?? fix.created_at,
        label: `Commit ${fix.commit_sha.slice(0, 7)}`,
        detail: `${fix.files_changed?.length ?? 0} files · ${fix.lines_changed ?? 0} lines`,
        status: 'ok',
      });
    }
    if (fix.pr_url) {
      events.push({
        kind: 'pr_opened',
        at: fix.completed_at ?? fix.started_at ?? fix.created_at,
        label: `PR opened${fix.pr_number ? ` #${fix.pr_number}` : ''}`,
        detail: fix.pr_url,
        status: 'ok',
      });
    }
    if (fix.check_run_status || fix.check_run_conclusion) {
      const conclusion = (fix.check_run_conclusion ?? '').toLowerCase();
      const ciStatus: 'ok' | 'fail' | 'pending' =
        conclusion === 'success'
          ? 'ok'
          : conclusion === 'failure' || conclusion === 'cancelled'
            ? 'fail'
            : 'pending';
      events.push({
        kind: ciStatus === 'pending' ? 'ci_started' : 'ci_resolved',
        at: fix.check_run_updated_at ?? fix.completed_at ?? fix.started_at ?? fix.created_at,
        label:
          ciStatus === 'pending'
            ? `CI ${fix.check_run_status?.replace(/_/g, ' ') ?? 'running'}`
            : `CI ${conclusion}`,
        status: ciStatus,
      });
    }
    if (fix.status === 'completed') {
      events.push({
        kind: 'completed',
        at: fix.completed_at ?? new Date().toISOString(),
        label: 'Fix completed',
        status: 'ok',
      });
    } else if (fix.status === 'failed') {
      events.push({
        kind: 'failed',
        at: fix.completed_at ?? new Date().toISOString(),
        label: 'Fix failed',
        detail: fix.error,
        status: 'fail',
      });
    }

    events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

    return c.json({ ok: true, data: { fix, dispatch, events, source: 'synthesized' } });
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

    // Membership check: owner OR project_members. Keeps collaborators seeing
    // the same repo overview without having to own the project.
    const { data: membership } = await db
      .from('project_members')
      .select('project_id')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .maybeSingle();
    const { data: ownerRow } = await db
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('owner_id', userId)
      .maybeSingle();
    if (!membership && !ownerRow) {
      return c.json(
        { ok: false, error: { code: 'FORBIDDEN', message: 'Not a member of this project' } },
        403,
      );
    }

    const [{ data: primaryRepo }, { data: settings }, { data: fixes }] = await Promise.all([
      db
        .from('project_repos')
        .select(
          'repo_url, default_branch, github_app_installation_id, last_indexed_at, indexing_enabled',
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
    const { data: membership } = await db
      .from('project_members')
      .select('project_id')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .maybeSingle();
    const { data: ownerRow } = await db
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('owner_id', userId)
      .maybeSingle();
    if (!membership && !ownerRow) {
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
    const fixId = c.req.param('id');
    const userId = c.get('userId') as string;
    const body = await c.req.json();
    const db = getServiceClient();
    const { data: projects } = await db.from('projects').select('id').eq('owner_id', userId);
    const projectIds = projects?.map((p) => p.id) ?? [];

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
        void dispatchPluginEvent(db, fix.project_id, 'fix.applied', {
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
      }
    } else if (updates.status === 'failed') {
      const { data: fix } = await db
        .from('fix_attempts')
        .select('report_id, project_id, agent, error')
        .eq('id', fixId)
        .in('project_id', projectIds)
        .single();
      if (fix) {
        void dispatchPluginEvent(db, fix.project_id, 'fix.failed', {
          report: { id: fix.report_id },
          fix: { id: fixId, agent: fix.agent, error: updates.error ?? fix.error },
        }).catch((e) =>
          log.warn('Plugin dispatch failed', { event: 'fix.failed', err: String(e) }),
        );
      }
    } else if (updates.status === 'proposed') {
      const { data: fix } = await db
        .from('fix_attempts')
        .select('report_id, project_id, agent, branch, pr_url')
        .eq('id', fixId)
        .in('project_id', projectIds)
        .single();
      if (fix) {
        void dispatchPluginEvent(db, fix.project_id, 'fix.proposed', {
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
      }
    }

    return c.json({ ok: true });
  });
}
