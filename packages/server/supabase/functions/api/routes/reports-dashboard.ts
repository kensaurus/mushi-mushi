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

export function registerReportsDashboardRoutes(app: Hono): void {
  // ============================================================
  // ADMIN ROUTES (JWT auth)
  // ============================================================

  // Severity breakdown over a sliding window — drives the KPI strip on
  // /reports so triagers can see "5 critical · 12 high · …" before they scroll.
  // Uses a single small SELECT (severity-only) so it stays cheap even for
  // projects with millions of historical reports.
  app.get('/v1/admin/reports/severity-stats', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const days = Math.min(Math.max(Number(c.req.query('days')) || 14, 1), 90);
    const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const projectIds = await ownedProjectIds(db, userId);
    if (projectIds.length === 0) {
      return c.json({
        ok: true,
        data: {
          window_days: days,
          bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
          total: 0,
        },
      });
    }

    const { data: rows } = await db
      .from('reports')
      .select('severity, created_at')
      .in('project_id', projectIds)
      .gte('created_at', sinceIso)
      .neq('status', 'dismissed');

    const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 } as Record<string, number>;
    // Build a per-day, per-severity matrix so the Reports KPI strip can render
    // a 14d trend sparkline alongside each tile (Round 2 polish — KPI rows
    // need momentum, not just snapshots).
    const dayBuckets = new Map<
      string,
      { critical: number; high: number; medium: number; low: number; total: number }
    >();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      dayBuckets.set(key, { critical: 0, high: 0, medium: 0, low: 0, total: 0 });
    }
    for (const r of (rows ?? []) as Array<{ severity: string | null; created_at: string }>) {
      if (r.severity && r.severity in bySeverity) bySeverity[r.severity] += 1;
      const dayKey = (r.created_at ?? '').slice(0, 10);
      const bucket = dayBuckets.get(dayKey);
      if (bucket) {
        bucket.total += 1;
        if (r.severity && r.severity in bucket)
          bucket[r.severity as 'critical' | 'high' | 'medium' | 'low'] += 1;
      }
    }
    const byDay = Array.from(dayBuckets.entries()).map(([day, counts]) => ({ day, ...counts }));
    return c.json({
      ok: true,
      data: {
        window_days: days,
        bySeverity,
        byDay,
        total: (rows ?? []).length,
      },
    });
  });

  app.get('/v1/admin/reports', adminOrApiKey(), async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const projectIds = await ownedProjectIds(db, userId);
    if (projectIds.length === 0) return c.json({ ok: true, data: { reports: [], total: 0 } });

    const status = c.req.query('status');
    const category = c.req.query('category');
    const severity = c.req.query('severity');
    const component = c.req.query('component');
    const reporter = c.req.query('reporter');
    const search = c.req.query('q')?.trim();
    const limit = Math.min(Number(c.req.query('limit')) || 50, 200);
    const offset = Number(c.req.query('offset')) || 0;
    const sortField = c.req.query('sort') ?? 'created_at';
    const sortDir = c.req.query('dir') === 'asc' ? 'asc' : 'desc';
    const allowedSorts: Record<string, string> = {
      created_at: 'created_at',
      severity: 'severity',
      confidence: 'confidence',
      status: 'status',
      component: 'component',
    };
    const orderColumn = allowedSorts[sortField] ?? 'created_at';

    let query = db
      .from('reports')
      .select(
        'id, project_id, description, category, severity, summary, status, created_at, environment, screenshot_url, user_category, confidence, component, report_group_id, last_reporter_reply_at, last_admin_reply_at',
        { count: 'exact' },
      )
      .in('project_id', projectIds)
      .order(orderColumn, { ascending: sortDir === 'asc', nullsFirst: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq('status', status);
    if (category) query = query.eq('category', category);
    if (severity) query = query.eq('severity', severity);
    if (component) query = query.eq('component', component);
    if (reporter) query = query.eq('reporter_token_hash', reporter);
    if (search) {
      // Bilateral OR — summary or description matches the search prefix.
      const escaped = search.replace(/[%,]/g, '');
      query = query.or(`summary.ilike.%${escaped}%,description.ilike.%${escaped}%`);
    }

    const { data: reports, count, error } = await query;
    if (error) return dbError(c, error);

    // Enrich each report with the real blast radius for its dedup group:
    //   dedup_count      = total reports filed against the same fingerprint
    //   unique_users     = COUNT(DISTINCT reporter_token_hash) — how many distinct
    //                      devices felt it. Token hash is the right proxy for
    //                      "people" in the dominant anonymous shake-to-report case
    //                      where reporter_user_id is NULL.
    //   unique_sessions  = COUNT(DISTINCT session_id) — how many distinct visits
    // Powered by the report_group_blast_radius RPCso we get
    // one round-trip regardless of how many groups are visible on this page.
    const groupIds = Array.from(
      new Set(
        (reports ?? [])
          .map((r) => (r as { report_group_id: string | null }).report_group_id)
          .filter((g): g is string => Boolean(g)),
      ),
    );
    const groupStatsMap = new Map<string, { reports: number; users: number; sessions: number }>();
    if (groupIds.length > 0) {
      const { data: stats } = await db.rpc('report_group_blast_radius', { p_group_ids: groupIds });
      for (const s of (stats ?? []) as Array<{
        report_group_id: string;
        report_count: number;
        unique_users: number;
        unique_sessions: number;
      }>) {
        groupStatsMap.set(s.report_group_id, {
          reports: Number(s.report_count) || 0,
          users: Number(s.unique_users) || 0,
          sessions: Number(s.unique_sessions) || 0,
        });
      }
    }

    const enriched = (reports ?? []).map((r) => {
      const gid = (r as { report_group_id: string | null }).report_group_id;
      const stats = gid ? groupStatsMap.get(gid) : undefined;
      return {
        ...r,
        dedup_count: stats?.reports ?? 1,
        unique_users: stats?.users ?? 0,
        unique_sessions: stats?.sessions ?? 0,
      };
    });

    return c.json({ ok: true, data: { reports: enriched, total: count ?? 0 } });
  });

  // Wave S3 (PERF / MCP): server-side semantic similarity for reports.
  //
  // The MCP client used to fetch every report in a project and run cosine
  // similarity in JS — O(N) bytes over the wire per tool call. On a project
  // with 10k reports this was ~6 MB transfer and 300 ms of client compute.
  // We push it down into pgvector here; the response is the top-K report
  // headers with a similarity score attached.
  //
  // The query text is embedded on the server (voyage-3 or fallback) so the
  // caller never has to ship vectors. That also keeps the embedding model
  // pinned server-side, matching what `getRelevantCode` uses for RAG.
  app.post('/v1/admin/reports/similarity', adminOrApiKey(), async (c) => {
    const userId = c.get('userId') as string;
    const body = (await c.req.json().catch(() => ({}))) as {
      query?: string;
      projectId?: string;
      k?: number;
      threshold?: number;
    };
    const query = body.query?.trim();
    if (!query) return c.json({ ok: false, error: { code: 'MISSING_QUERY' } }, 400);

    const db = getServiceClient();

    // Scope: every project the caller can access (owner OR org member).
    // Optional projectId narrows further; we still require it to be inside
    // the accessible set so a member can't NL-query a project they don't see.
    let projectIds = await ownedProjectIds(db, userId);
    if (body.projectId) {
      if (!projectIds.includes(body.projectId)) {
        return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
      }
      projectIds = [body.projectId];
    }
    if (projectIds.length === 0) return c.json({ ok: true, data: { results: [] } });

    const k = Math.min(Math.max(Number(body.k) || 20, 1), 100);
    const threshold = Math.min(Math.max(Number(body.threshold) || 0.2, 0), 1);

    try {
      const { createEmbedding } = await import('../_shared/embeddings.ts');
      const embedding = await createEmbedding(query, { projectId: projectIds[0] });
      const embeddingLiteral = `[${embedding.join(',')}]`;

      // Fan out match_report_embeddings per project concurrently; merge,
      // sort, and trim. Per-project RPC lets us reuse the existing index.
      const perProject = await Promise.all(
        projectIds.map(async (pid) => {
          const { data, error } = await db.rpc('match_report_embeddings', {
            query_embedding: embeddingLiteral,
            match_threshold: threshold,
            match_count: k,
            p_project_id: pid,
          });
          if (error) throw error;
          return (data ?? []) as Array<{
            report_id: string;
            similarity: number;
            description: string;
            category: string;
            created_at: string;
            report_group_id: string | null;
          }>;
        }),
      );

      const merged = perProject
        .flat()
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, k)
        .map((r) => ({
          reportId: r.report_id,
          similarity: r.similarity,
          description: r.description,
          category: r.category,
          createdAt: r.created_at,
          reportGroupId: r.report_group_id,
        }));

      return c.json({ ok: true, data: { results: merged } });
    } catch (err) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'SIMILARITY_FAILED',
            message: err instanceof Error ? err.message : String(err),
          },
        },
        500,
      );
    }
  });

  app.get('/v1/admin/reports/:id', adminOrApiKey(), async (c) => {
    const reportId = c.req.param('id');
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const projectIds = await ownedProjectIds(db, userId);

    const { data, error } = await db
      .from('reports')
      .select('*')
      .eq('id', reportId)
      .in('project_id', projectIds)
      .single();
    if (error || !data)
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Report not found' } }, 404);

    // Attach the LLM invocation timeline for this report so the detail page can
    // deep-link to Langfuse traces for each pipeline stage (fast-filter, classify-report,
    // judge-batch). Cheaper to fetch alongside the report than as a separate round-trip.
    // Also pull the linked fix attempts + judge eval so the PDCA receipt strip
    // on the report detail page can render without another network hop.
    const [invocationsRes, fixesRes, judgeRes] = await Promise.all([
      db
        .from('llm_invocations')
        .select(
          'id, function_name, stage, used_model, primary_model, fallback_used, fallback_reason, status, error_message, latency_ms, input_tokens, output_tokens, key_source, langfuse_trace_id, prompt_version, created_at',
        )
        .eq('report_id', reportId)
        .order('created_at', { ascending: true })
        .limit(20),
      db
        .from('fix_attempts')
        .select(
          'id, status, agent, pr_url, pr_number, branch, commit_sha, files_changed, lines_changed, review_passed, check_run_status, check_run_conclusion, pr_state, llm_model, error, started_at, completed_at, created_at, langfuse_trace_id',
        )
        .eq('report_id', reportId)
        .order('created_at', { ascending: false })
        .limit(5),
      db
        .from('classification_evaluations')
        .select('id, judge_score, classification_agreed, judge_reasoning, created_at')
        .eq('report_id', reportId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    return c.json({
      ok: true,
      data: {
        ...data,
        llm_invocations: invocationsRes.data ?? [],
        fix_attempts: fixesRes.data ?? [],
        judge_eval: judgeRes.data ?? null,
      },
    });
  });

  app.patch('/v1/admin/reports/:id', adminOrApiKey({ scope: 'mcp:write' }), async (c) => {
    const reportId = c.req.param('id');
    const userId = c.get('userId') as string;
    const body = await c.req.json();
    const db = getServiceClient();

    const projectIds = await ownedProjectIds(db, userId);

    const allowedFields: Record<string, boolean> = {
      status: true,
      severity: true,
      category: true,
      component: true,
    };
    const updates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      if (allowedFields[key]) updates[key] = value;
    }

    if (Object.keys(updates).length === 0) {
      return c.json(
        { ok: false, error: { code: 'NO_FIELDS', message: 'No valid fields to update' } },
        400,
      );
    }

    // Fetch report before update for reputation tracking
    const { data: report } = await db
      .from('reports')
      .select('project_id, reporter_token_hash, status')
      .eq('id', reportId)
      .in('project_id', projectIds)
      .single();

    const { error } = await db
      .from('reports')
      .update(updates)
      .eq('id', reportId)
      .in('project_id', projectIds);
    if (error) return dbError(c, error);

    // Award reputation points on status transitions
    if (report && updates.status && updates.status !== report.status) {
      const newStatus = updates.status as string;
      void dispatchPluginEvent(db, report.project_id, 'report.status_changed', {
        report: { id: reportId, status: newStatus },
        previousStatus: report.status,
        actor: { kind: 'admin', userId },
      }).catch((e) =>
        log.warn('Plugin dispatch failed', { event: 'report.status_changed', err: String(e) }),
      );
      if (newStatus === 'fixing') {
        awardPoints(db, report.project_id, report.reporter_token_hash, {
          action: 'confirmed',
        }).catch((e) =>
          log.error('Reputation award failed', { action: 'confirmed', err: String(e) }),
        );
        createNotification(
          db,
          report.project_id,
          reportId,
          report.reporter_token_hash,
          'confirmed',
          {
            message: buildNotificationMessage('confirmed', { points: 50 }),
            points: 50,
            reportId,
          },
        ).catch((e) => log.error('Notification failed', { type: 'confirmed', err: String(e) }));
      } else if (newStatus === 'fixed') {
        awardPoints(db, report.project_id, report.reporter_token_hash, { action: 'fixed' }).catch(
          (e) => log.error('Reputation award failed', { action: 'fixed', err: String(e) }),
        );
        createNotification(db, report.project_id, reportId, report.reporter_token_hash, 'fixed', {
          message: buildNotificationMessage('fixed', { points: 25 }),
          points: 25,
          reportId,
        }).catch((e) => log.error('Notification failed', { type: 'fixed', err: String(e) }));
      } else if (newStatus === 'dismissed') {
        awardPoints(db, report.project_id, report.reporter_token_hash, {
          action: 'dismissed',
        }).catch((e) =>
          log.error('Reputation award failed', { action: 'dismissed', err: String(e) }),
        );
        createNotification(
          db,
          report.project_id,
          reportId,
          report.reporter_token_hash,
          'dismissed',
          {
            message: buildNotificationMessage('dismissed', {}),
            reportId,
          },
        ).catch((e) => log.error('Notification failed', { type: 'dismissed', err: String(e) }));
      }
    }

    return c.json({ ok: true });
  });

  // Bulk mutations on reports — drives the triage table's checkbox toolbar.
  // Limit batch size so a single request can't touch thousands of rows;
  // front-end sends ids in chunks if needed. Same allow-listed fields as the
  // per-row PATCH so we don't widen the attack surface.
  app.post('/v1/admin/reports/bulk', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const body = (await c.req.json().catch(() => null)) as {
      ids?: unknown;
      action?: unknown;
      value?: unknown;
    } | null;
    if (!body || !Array.isArray(body.ids) || body.ids.length === 0) {
      return c.json(
        { ok: false, error: { code: 'INVALID_INPUT', message: 'ids[] required' } },
        400,
      );
    }
    const ids = body.ids.filter((x): x is string => typeof x === 'string').slice(0, 200);
    if (ids.length === 0) {
      return c.json({ ok: false, error: { code: 'INVALID_INPUT', message: 'No valid ids' } }, 400);
    }
    const action = String(body.action ?? '');
    const allowedActions = new Set(['set_status', 'set_severity', 'set_category', 'dismiss']);
    if (!allowedActions.has(action)) {
      return c.json(
        { ok: false, error: { code: 'INVALID_ACTION', message: `Unsupported action: ${action}` } },
        400,
      );
    }

    const db = getServiceClient();
    const projectIds = await ownedProjectIds(db, userId);
    if (projectIds.length === 0) {
      return c.json(
        { ok: false, error: { code: 'NO_PROJECTS', message: 'No accessible projects for this user' } },
        403,
      );
    }

    const updates: Record<string, unknown> = {};
    if (action === 'dismiss') {
      updates.status = 'dismissed';
    } else if (action === 'set_status') {
      const allowed = new Set(['new', 'classified', 'fixing', 'fixed', 'dismissed']);
      if (!allowed.has(String(body.value))) {
        return c.json(
          { ok: false, error: { code: 'INVALID_VALUE', message: 'Invalid status value' } },
          400,
        );
      }
      updates.status = String(body.value);
    } else if (action === 'set_severity') {
      const allowed = new Set(['critical', 'high', 'medium', 'low']);
      if (!allowed.has(String(body.value))) {
        return c.json(
          { ok: false, error: { code: 'INVALID_VALUE', message: 'Invalid severity value' } },
          400,
        );
      }
      updates.severity = String(body.value);
    } else if (action === 'set_category') {
      const allowed = new Set(['bug', 'slow', 'visual', 'confusing', 'other']);
      if (!allowed.has(String(body.value))) {
        return c.json(
          { ok: false, error: { code: 'INVALID_VALUE', message: 'Invalid category value' } },
          400,
        );
      }
      updates.category = String(body.value);
    }

    // Snapshot pre-update rows so we can fan out reputation events for status
    // transitions, identical to the per-row PATCH path. We also capture
    // severity + category here so the Wave T.2.4a undo path can revert every
    // field this endpoint is capable of changing with a single replay.
    const { data: before } = await db
      .from('reports')
      .select('id, project_id, reporter_token_hash, status, severity, category')
      .in('id', ids)
      .in('project_id', projectIds);
    const beforeMap = new Map((before ?? []).map((r) => [r.id, r]));
    const allowedIds = [...beforeMap.keys()];
    if (allowedIds.length === 0) {
      return c.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'No reports matched' } },
        404,
      );
    }

    const { error: updErr } = await db
      .from('reports')
      .update(updates)
      .in('id', allowedIds)
      .in('project_id', projectIds);
    if (updErr) {
      return dbError(c, updErr);
    }

    // Record the mutation for undo. We only surface `mutation_id` to the
    // client when the insert succeeded — a failure here silently disables
    // undo but leaves the data change intact, which is the safer failure
    // mode than rolling back successful triage work.
    const priorState = allowedIds.map((id) => {
      const prev = beforeMap.get(id);
      return {
        id,
        status: prev?.status ?? null,
        severity: (prev as { severity?: string | null } | undefined)?.severity ?? null,
        category: (prev as { category?: string | null } | undefined)?.category ?? null,
      };
    });
    const firstProjectIdForLog = beforeMap.values().next().value?.project_id ?? projectIds[0];
    let mutationId: string | null = null;
    const { data: mutationRow, error: mutationErr } = await db
      .from('report_bulk_mutations')
      .insert({
        admin_id: userId,
        project_id: firstProjectIdForLog,
        action,
        payload: { action, value: body.value ?? null, ids: allowedIds },
        prior_state: priorState,
        affected_count: allowedIds.length,
      })
      .select('id')
      .single();
    if (mutationErr) {
      log.warn('Bulk mutation log insert failed', { err: String(mutationErr) });
    } else if (mutationRow) {
      mutationId = mutationRow.id as string;
    }

    // Side effects mirror PATCH: reputation, notifications, plugin dispatch on
    // status changes. Done sequentially per row but each kicked off without await
    // so the bulk endpoint stays snappy.
    if (typeof updates.status === 'string') {
      const newStatus = updates.status;
      for (const id of allowedIds) {
        const prev = beforeMap.get(id);
        if (!prev || prev.status === newStatus) continue;
        void dispatchPluginEvent(db, prev.project_id, 'report.status_changed', {
          report: { id, status: newStatus },
          previousStatus: prev.status,
          actor: { kind: 'admin', userId },
        }).catch((e) =>
          log.warn('Plugin dispatch failed', { event: 'report.status_changed', err: String(e) }),
        );
        const reputationAction =
          newStatus === 'fixing'
            ? 'confirmed'
            : newStatus === 'fixed'
              ? 'fixed'
              : newStatus === 'dismissed'
                ? 'dismissed'
                : null;
        if (reputationAction) {
          const points =
            reputationAction === 'confirmed' ? 50 : reputationAction === 'fixed' ? 25 : 0;
          awardPoints(db, prev.project_id, prev.reporter_token_hash, {
            action: reputationAction,
          }).catch((e) =>
            log.error('Reputation award failed', { action: reputationAction, err: String(e) }),
          );
          createNotification(db, prev.project_id, id, prev.reporter_token_hash, reputationAction, {
            message: buildNotificationMessage(reputationAction, points ? { points } : {}),
            ...(points ? { points } : {}),
            reportId: id,
          }).catch((e) =>
            log.error('Notification failed', { type: reputationAction, err: String(e) }),
          );
        }
      }
    }

    const firstProjectId = beforeMap.values().next().value?.project_id ?? '';
    await logAudit(db, firstProjectId, userId, 'report.triaged', 'report', undefined, {
      action,
      value: body.value ?? null,
      count: allowedIds.length,
      ids: allowedIds,
      mutation_id: mutationId,
    });

    return c.json({
      ok: true,
      data: { updated: allowedIds.length, ids: allowedIds, mutation_id: mutationId },
    });
  });

  // Wave T.2.4a: undo a bulk mutation within its 10-minute expiry window.
  // The logic is strictly "replay prior_state" — we don't try to compute a
  // diff against the current row because the user may have mutated some of
  // those reports individually in the meantime and those edits should be
  // respected (the undo just reverts the specific fields this bulk action
  // touched on the specific ids it touched).
  app.post('/v1/admin/reports/bulk/:mutationId/undo', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const mutationId = c.req.param('mutationId');
    if (!mutationId || !/^[0-9a-f-]{36}$/i.test(mutationId)) {
      return c.json(
        { ok: false, error: { code: 'INVALID_INPUT', message: 'mutationId must be a UUID' } },
        400,
      );
    }

    const db = getServiceClient();
    const { data: mutation, error: fetchErr } = await db
      .from('report_bulk_mutations')
      .select('id, admin_id, project_id, action, payload, prior_state, expires_at, undone_at')
      .eq('id', mutationId)
      .maybeSingle();
    if (fetchErr) return dbError(c, fetchErr);
    if (!mutation) {
      return c.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Mutation not found' } },
        404,
      );
    }
    if (mutation.admin_id !== userId) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Not your mutation' } }, 403);
    }
    if (mutation.undone_at) {
      return c.json(
        { ok: false, error: { code: 'ALREADY_UNDONE', message: 'Mutation already undone' } },
        409,
      );
    }
    if (new Date(mutation.expires_at).getTime() < Date.now()) {
      return c.json(
        { ok: false, error: { code: 'EXPIRED', message: 'Undo window has passed' } },
        410,
      );
    }

    const priorState = Array.isArray(mutation.prior_state) ? mutation.prior_state : [];
    if (priorState.length === 0) {
      return c.json(
        { ok: false, error: { code: 'EMPTY', message: 'No prior state to restore' } },
        422,
      );
    }

    // Only restore the field(s) this bulk action actually mutated. A
    // `set_status` undo must not clobber a severity that the admin tuned
    // between apply and undo, etc. The `action` column tells us which
    // field(s) to touch.
    type PriorRow = {
      id: string;
      status: string | null;
      severity: string | null;
      category: string | null;
    };
    const action = mutation.action as string;
    const restrictFields = (prev: PriorRow): Record<string, unknown> => {
      const patch: Record<string, unknown> = {};
      if (action === 'dismiss' || action === 'set_status') {
        if (prev.status !== null) patch.status = prev.status;
      } else if (action === 'set_severity') {
        patch.severity = prev.severity;
      } else if (action === 'set_category') {
        if (prev.category !== null) patch.category = prev.category;
      }
      return patch;
    };

    // Scope every write to projects this admin can still access so a stolen
    // undo call can't rewrite history across account boundaries. Teams v1:
    // org members with read access can also undo their own actions.
    const projectIds = await ownedProjectIds(db, userId);
    if (projectIds.length === 0) {
      return c.json(
        { ok: false, error: { code: 'NO_PROJECTS', message: 'No accessible projects for this user' } },
        403,
      );
    }

    let restored = 0;
    for (const raw of priorState as unknown[]) {
      const prev = raw as PriorRow;
      if (!prev || typeof prev.id !== 'string') continue;
      const patch = restrictFields(prev);
      if (Object.keys(patch).length === 0) continue;
      const { error: restoreErr, data: restoredRows } = await db
        .from('reports')
        .update(patch)
        .eq('id', prev.id)
        .in('project_id', projectIds)
        .select('id');
      if (restoreErr) {
        log.warn('Bulk undo restore failed for row', { id: prev.id, err: String(restoreErr) });
        continue;
      }
      if ((restoredRows?.length ?? 0) > 0) restored += 1;
    }

    await db
      .from('report_bulk_mutations')
      .update({ undone_at: new Date().toISOString() })
      .eq('id', mutationId);

    await logAudit(
      db,
      mutation.project_id as string,
      userId,
      'report.bulk_undone',
      'report',
      undefined,
      { mutation_id: mutationId, action, restored },
    );

    return c.json({ ok: true, data: { mutation_id: mutationId, restored } });
  });

  app.get('/v1/admin/stats', adminOrApiKey(), async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const projectIds = await ownedProjectIds(db, userId);
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

    return c.json({
      ok: true,
      data: {
        total: total ?? 0,
        byStatus: toMap(statusRows),
        byCategory: toMap(categoryRows),
        bySeverity: toMap(severityRows),
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
    const projectIds = await ownedProjectIds(db, userId);
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
      .filter((r) => r.status === 'new' || r.status === 'queued' || r.status === 'classified')
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
        id: f.report_id,
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

  // Judge scores / drift data
  app.get('/v1/admin/judge-scores', jwtAuth, async (c) => {
    // Aggregates across all owned projects so multi-project accounts see the
    // full picture, not the first project only. We call weekly_judge_scores
    // per project then bucket-merge in JS — RPC isn't variadic over project_ids.
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await ownedProjectIds(db, userId);
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
    const projectIds = await ownedProjectIds(db, userId);
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
    const projectIds = await ownedProjectIds(db, userId);
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
    const projectIds = await ownedProjectIds(db, userId);
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
    const projectIds = await ownedProjectIds(db, userId);
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

  // ============================================================
  // PROMPT LAB — manage prompt versions + view eval dataset.
  // Replaces the old "Fine-Tuning" page that nobody could complete.
  // ============================================================

  app.get('/v1/admin/prompt-lab', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await ownedProjectIds(db, userId);

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
    const projectIds = await ownedProjectIds(db, userId);
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
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const db = getServiceClient();
    const projectIds = await ownedProjectIds(db, userId);
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
    const id = c.req.param('id');
    const db = getServiceClient();
    const projectIds = await ownedProjectIds(db, userId);
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
