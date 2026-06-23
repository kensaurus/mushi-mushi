import type { Hono } from 'npm:hono@4';
import type { Variables } from '../types.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { log } from '../../_shared/logger.ts';
import { jwtAuth, adminOrApiKey } from '../../_shared/auth.ts';
import { notifyReportStatusTransition } from '../../_shared/report-status-notify.ts';
import { normalizeAdminStatus, toStoredStatus } from '../../_shared/report-status.ts';
import { logAudit } from '../../_shared/audit.ts';
import { resolveExternalIssue } from '../../_shared/integrations.ts';
import { dispatchPluginEvent } from '../../_shared/plugins.ts';
import {
  dbError,
  callerProjectIds,
  canAccessReportProject,
  resolveOwnedProject,
  scopedOwnedProjectIds,
  parseUuidParam,
} from '../shared.ts';
import { buildUnifiedReportTimeline } from '../../_shared/unified-timeline.ts';
import { composeFixPacket, fixPacketContextFromReport, type FixPacketFile } from '../../_shared/fix-packet.ts';
import { getRelevantCode } from '../../_shared/rag.ts';
import { getStorageAdapter } from '../../_shared/storage.ts';

export function registerReportsRoutes(app: Hono<{ Variables: Variables }>): void {
  // ============================================================
  // ADMIN ROUTES (JWT auth)
  // ============================================================

  // Severity breakdown over a sliding window — drives the KPI strip on
  // /reports so triagers can see "5 critical · 12 high · …" before they scroll.
  // Uses a single small SELECT (severity-only) so it stays cheap even for
  // projects with millions of historical reports.
  app.get('/v1/admin/reports/stats', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const empty = {
      hasAnyProject: false,
      projectId: null as string | null,
      projectName: null as string | null,
      projectCount: 0,
      setupDone: false,
      hasIngest: false,
      totalAllTime: 0,
      total14d: 0,
      critical14d: 0,
      high14d: 0,
      newUntriaged: 0,
      openBacklog: 0,
      dismissed14d: 0,
      lastReportAt: null as string | null,
      topPriority: 'waiting_ingest' as 'critical' | 'backlog' | 'untriaged' | 'clear' | 'waiting_ingest',
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

    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 13);
    since.setUTCHours(0, 0, 0, 0);
    const sinceIso = since.toISOString();
    const now = Date.now();

    const [reportsRes, reportCountRes, keysRes, heartbeatRes] = await Promise.all([
      db
        .from('reports')
        .select('id, status, severity, created_at')
        .in('project_id', projectIds)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false })
        .limit(1000),
      db
        .from('reports')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', activeProject.id),
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
    ]);

    const recentReports = reportsRes.data ?? [];
    let total14d = 0;
    let critical14d = 0;
    let high14d = 0;
    let newUntriaged = 0;
    let openBacklog = 0;
    let dismissed14d = 0;

    for (const r of recentReports) {
      total14d += 1;
      const status = String(r.status ?? '');
      const sev = String(r.severity ?? '').toLowerCase();
      if (sev === 'critical') critical14d += 1;
      else if (sev === 'high') high14d += 1;
      if (status === 'dismissed') dismissed14d += 1;
      if (status === 'new' || status === 'queued') {
        newUntriaged += 1;
        if (now - new Date(String(r.created_at)).getTime() > 60 * 60 * 1000) {
          openBacklog += 1;
        }
      }
    }

    const totalAllTime = reportCountRes.count ?? 0;
    const hasKey = (keysRes.data ?? []).length > 0;
    const hasSdk = Boolean(heartbeatRes.data?.last_seen_at);
    const hasIngest = totalAllTime > 0;
    const setupDone = hasKey && hasSdk && hasIngest;
    const lastReportAt = recentReports[0]?.created_at ?? null;

    const pid = activeProject.id as string;
    const scoped = (path: string) =>
      `${path}${path.includes('?') ? '&' : '?'}project=${encodeURIComponent(pid)}`;

    let topPriority: 'critical' | 'backlog' | 'untriaged' | 'clear' | 'waiting_ingest' = 'waiting_ingest';
    let topPriorityLabel: string | null = null;
    let topPriorityTo: string | null = null;

    if (!hasIngest) {
      topPriority = 'waiting_ingest';
      topPriorityLabel =
        'No bugs received yet — send a test report from Setup to confirm the widget works.';
      topPriorityTo = scoped('/onboarding?tab=verify');
    } else if (critical14d > 0 && newUntriaged > 0) {
      topPriority = 'critical';
      topPriorityLabel = `${critical14d} critical bug${critical14d === 1 ? '' : 's'} still untriaged — users may be blocked right now.`;
      topPriorityTo = scoped('/reports?status=new&severity=critical');
    } else if (openBacklog > 0) {
      topPriority = 'backlog';
      topPriorityLabel = `${openBacklog} report${openBacklog === 1 ? '' : 's'} waiting over an hour — confirm severity before auto-fix runs.`;
      topPriorityTo = scoped('/reports?status=new');
    } else if (newUntriaged > 0) {
      topPriority = 'untriaged';
      topPriorityLabel = `${newUntriaged} new report${newUntriaged === 1 ? '' : 's'} — classifier scored severity; you confirm or dismiss.`;
      topPriorityTo = scoped('/reports?status=new');
    } else {
      topPriority = 'clear';
      topPriorityLabel = `Queue is current — ${total14d} report${total14d === 1 ? '' : 's'} in the last 14 days.`;
      topPriorityTo = scoped('/reports');
    }

    return c.json({
      ok: true,
      data: {
        hasAnyProject: true,
        projectId: activeProject.id,
        projectName: activeProject.name,
        projectCount: projectIds.length,
        setupDone,
        hasIngest,
        totalAllTime,
        total14d,
        critical14d,
        high14d,
        newUntriaged,
        openBacklog,
        dismissed14d,
        lastReportAt,
        topPriority,
        topPriorityLabel,
        topPriorityTo,
      },
    });
  });

  app.get('/v1/admin/reports/severity-stats', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const days = Math.min(Math.max(Number(c.req.query('days')) || 14, 1), 90);
    const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const projectIds = await scopedOwnedProjectIds(c, db, userId);
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

    const projectIds = await scopedOwnedProjectIds(c, db, userId);
    if (projectIds.length === 0) return c.json({ ok: true, data: { reports: [], total: 0 } });

    const status = c.req.query('status');
    const category = c.req.query('category');
    const userCategory = c.req.query('user_category');
    const severity = c.req.query('severity');
    const component = c.req.query('component');
    const reporter = c.req.query('reporter');
    const search = c.req.query('q')?.trim();
    // 2026-05-07 SDK observability filters. Each value is bounded and
    // sanitised: `tag` is `key:value`, both ≤ 120 chars; `trace` is a
    // 32-hex Sentry trace id (we don't enforce the format here — just
    // length-cap so it can't blow up the parser); `release` is the
    // user-supplied Sentry release string. Empty values are dropped so
    // the dashboard can submit the params unconditionally.
    const tagParam = c.req.query('tag')?.trim();
    const traceParam = c.req.query('trace')?.trim().slice(0, 80);
    const releaseParam = c.req.query('release')?.trim().slice(0, 200);
    const sentryEnvParam = c.req.query('sentryEnv')?.trim().slice(0, 80);
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
        // breadcrumbs / tags / sentry_* are pulled here so the list row
        // can render the breadcrumb-peek popover without a second
        // round-trip. The cost is ~2-5 KB per row of jsonb on average
        // (capped at 100 entries × ≤2 KB by the schema), well under the
        // existing per-row payload from `environment`/`screenshot_url`.
        // end_user_id + reporter_token_hash: needed to render reporter
        // display name + verified badge in the list row without an extra
        // round-trip (batch-fetched below).
        'id, project_id, description, category, severity, summary, status, created_at, environment, screenshot_url, user_category, confidence, component, report_group_id, last_reporter_reply_at, last_admin_reply_at, breadcrumbs, tags, sentry_trace_id, sentry_release, sentry_environment, sentry_event_id, sentry_replay_id, end_user_id, reporter_token_hash, session_id',
        { count: 'exact' },
      )
      .in('project_id', projectIds)
      .order(orderColumn, { ascending: sortDir === 'asc', nullsFirst: false })
      .range(offset, offset + limit - 1);

    if (status) {
      // Canonical UI status "classified" must include legacy `triaged` rows
      // until the backfill migration has run on every environment.
      const legacyClassified = new Set(['classified', 'triaged', 'grouped', 'dispatched']);
      const legacyFixed = new Set(['fixed', 'resolved', 'completed']);
      if (status === 'classified') query = query.in('status', [...legacyClassified]);
      else if (status === 'fixed') query = query.in('status', [...legacyFixed]);
      else if (status === 'new') query = query.in('status', ['new', 'queued', 'pending', 'submitted']);
      else query = query.eq('status', status);
    }
    if (category) query = query.eq('category', category);
    if (userCategory) query = query.eq('user_category', userCategory);
    if (severity) query = query.eq('severity', severity);
    if (component) query = query.eq('component', component);
    if (reporter) query = query.eq('reporter_token_hash', reporter);
    if (search) {
      // Bilateral OR — summary or description matches the search prefix.
      const escaped = search.replace(/[%,]/g, '');
      query = query.or(`summary.ilike.%${escaped}%,description.ilike.%${escaped}%`);
    }
    if (tagParam) {
      // `tag=key:value` → reports where tags @> {"key": "value"}. We
      // split only on the *first* `:` so values that themselves contain
      // a colon (e.g. `release:checkout@1.4.0`) round-trip correctly.
      //
      // Bare-key ("key exists") form is intentionally not supported on
      // this endpoint: the previous fallback used
      // `tags 'cs' '{"key":""}'`, which only matched empty-string values
      // (not key existence) AND interpolated user input into a JSON
      // string without escaping — quotes/backslashes in `key` could
      // break the filter. The dashboard always sends `key:value`; any
      // other shape is treated as no-op rather than silently doing the
      // wrong thing.
      const sepAt = tagParam.indexOf(':');
      if (sepAt > 0 && sepAt < tagParam.length - 1) {
        const k = tagParam.slice(0, sepAt).slice(0, 120);
        const v = tagParam.slice(sepAt + 1).slice(0, 120);
        // PostgREST `cs` (contains) operator on jsonb — uses the GIN
        // index on `reports.tags` for an indexed lookup.
        query = query.contains('tags', { [k]: v });
      }
    }
    if (traceParam) query = query.eq('sentry_trace_id', traceParam);
    if (releaseParam) query = query.eq('sentry_release', releaseParam);
    if (sentryEnvParam) query = query.eq('sentry_environment', sentryEnvParam);

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

    // Batch-fetch end_users for reporter identity (display name + verified badge).
    // Only fetch for reports that have an end_user_id; one DB round-trip for up
    // to 200 rows (the list limit) is far cheaper than per-row joins.
    const endUserIds = Array.from(
      new Set(
        (reports ?? [])
          .map((r) => (r as { end_user_id: string | null }).end_user_id)
          .filter((id): id is string => Boolean(id)),
      ),
    );
    const endUsersMap = new Map<string, { display_name: string | null; jwt_verified_at: string | null }>();
    if (endUserIds.length > 0) {
      const { data: endUsers } = await db
        .from('end_users')
        .select('id, display_name, jwt_verified_at')
        .in('id', endUserIds);
      for (const eu of endUsers ?? []) {
        endUsersMap.set(eu.id, { display_name: eu.display_name, jwt_verified_at: eu.jwt_verified_at });
      }
    }

    const enriched = (reports ?? []).map((r) => {
      const gid = (r as { report_group_id: string | null }).report_group_id;
      const stats = gid ? groupStatsMap.get(gid) : undefined;
      const endUserId = (r as { end_user_id: string | null }).end_user_id;
      const identity = endUserId ? endUsersMap.get(endUserId) : undefined;
      return {
        ...r,
        dedup_count: stats?.reports ?? 1,
        unique_users: stats?.users ?? 0,
        unique_sessions: stats?.sessions ?? 0,
        reporter_display_name: identity?.display_name ?? null,
        reporter_jwt_verified: Boolean(identity?.jwt_verified_at),
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
    let projectIds = await callerProjectIds(c, db, userId);
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
      const { createEmbedding } = await import('../../_shared/embeddings.ts');
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
    const idParsed = parseUuidParam(c);
    if (!idParsed.ok) return idParsed.error;
    const reportId = idParsed.value;
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const { data, error } = await db.from('reports').select('*').eq('id', reportId).single();
    if (error || !data) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Report not found' } }, 404);
    }

    const allowed = await canAccessReportProject(c, db, userId, data.project_id as string);
    if (!allowed) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Report not found' } }, 404);
    }

    // Attach the LLM invocation timeline for this report so the detail page can
    // deep-link to Langfuse traces for each pipeline stage (fast-filter, classify-report,
    // judge-batch). Cheaper to fetch alongside the report than as a separate round-trip.
    // Also pull the linked fix attempts + judge eval so the PDCA receipt strip
    // on the report detail page can render without another network hop.
    // Inventory anchor: walk graph_edges to find the action node this report is
    // filed against (edge type='reports_against') and return its metadata so
    // MCP get_fix_context.inventoryAction is always populated when one exists.
    const [invocationsRes, fixesRes, judgeRes, inventoryAnchorRes, endUserRes, childrenRes, testerSubRes] = await Promise.all([
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
          'id, status, agent, pr_url, pr_number, branch, commit_sha, files_changed, lines_changed, review_passed, check_run_status, check_run_conclusion, pr_state, llm_model, error, started_at, completed_at, created_at, langfuse_trace_id, inventory_action_node_id, spec_validation_warnings',
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
      // Resolve the inventory action this report was filed against via
      // `get_report_inventory_action` (migration 20260511120000). The RPC
      // walks two paths in order:
      //   1. graph_nodes(node_type='report_group', label=reportId)
      //        → graph_edges(edge_type='reports_against')
      //        → graph_nodes(node_type='action')
      //      (populated by classify-report → linkReportToAction)
      //   2. fix_dispatch_jobs.inventory_action_node_id fallback
      //      (covers reports that were dispatched but never classified)
      // Returns NULL when neither path resolves — UI shows no Origin drawer.
      db
        .rpc('get_report_inventory_action', { p_report_id: reportId })
        .maybeSingle(),
      // Join end_users for display_name + jwt_verified_at (reporter identity).
      // Only run if the report row has an end_user_id FK.
      data.end_user_id
        ? db
            .from('end_users')
            .select('id, display_name, email_hash, jwt_verified_at, external_user_id, jwt_provider')
            .eq('id', data.end_user_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      db
        .from('reports')
        .select('id')
        .eq('parent_report_id', reportId)
        .order('created_at', { ascending: false })
        .limit(20),
      data.tester_submission_id
        ? db
            .from('tester_submissions')
            .select(`
              id, status, points_awarded, reviewer_note,
              mushi_testers!tester_submissions_tester_id_fkey ( public_handle, display_name ),
              published_apps!tester_submissions_app_id_fkey ( name )
            `)
            .eq('id', data.tester_submission_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

    const testerSubRow = testerSubRes.data as {
      id: string
      status: string
      points_awarded: number | null
      reviewer_note: string | null
      mushi_testers: { public_handle?: string; display_name?: string } | null
      published_apps: { name?: string } | null
    } | null

    const tester_submission = testerSubRow
      ? {
          id: testerSubRow.id,
          status: testerSubRow.status,
          points_awarded: testerSubRow.points_awarded ?? 0,
          tester_handle:
            testerSubRow.mushi_testers?.public_handle
            ?? testerSubRow.mushi_testers?.display_name
            ?? null,
          app_name: testerSubRow.published_apps?.name ?? null,
          reviewer_note: testerSubRow.reviewer_note ?? null,
        }
      : null

    // Compose a first-class, paste-ready fix packet so every surface
    // (report-detail UI, MCP get_fix_context, CLI mushi fix) shares one
    // generator instead of each reshaping the row. Best-effort: RAG hints and
    // blast radius enrich the packet when available but never block the response.
    let fix_packet: string | null = null;
    try {
      let ragFiles: FixPacketFile[] = [];
      if (data.summary) {
        try {
          const rag = await getRelevantCode(db, data.project_id as string, {
            symptom: data.summary as string,
          });
          ragFiles = rag.slice(0, 5).map((f) => ({
            path: f.filePath,
            snippet: f.preview?.slice(0, 600) ?? '',
          }));
        } catch {
          // RAG is best-effort — a missing index must not break the report view.
        }
      }
      const anchor = inventoryAnchorRes.data as { label?: string; node_id?: string } | null;
      const blastRadius = anchor?.label
        ? `This report is filed against the "${anchor.label}" user-story action — changes here may affect that flow.`
        : null;
      fix_packet = composeFixPacket(
        fixPacketContextFromReport(data as Record<string, unknown>, { ragFiles, blastRadius }),
      );
    } catch {
      // Never let packet composition fail the detail fetch.
      fix_packet = null;
    }

    return c.json({
      ok: true,
      data: {
        ...data,
        // Re-sign screenshot URL when the original signed URL is stale/missing
        // but the storage path is present (e.g. old reports whose signed URL
        // expired, or reports where upload succeeded but the URL write failed).
        screenshot_url: await (async () => {
          if (data.screenshot_url) return data.screenshot_url as string;
          const storagePath = data.screenshot_path as string | null;
          if (!storagePath) return null;
          try {
            // storagePath format: storage://supabase/<bucket>/<key>
            const match = storagePath.match(/^storage:\/\/supabase\/([^/]+)\/(.+)$/);
            if (!match) return null;
            const [, , key] = match;
            const adapter = await getStorageAdapter(data.project_id as string);
            return await adapter.signedUrl(key, 220_752_000);
          } catch (err) {
            log.warn('Failed to re-sign screenshot URL on detail fetch', { err: String(err) });
            return null;
          }
        })(),
        llm_invocations: invocationsRes.data ?? [],
        fix_attempts: fixesRes.data ?? [],
        judge_eval: judgeRes.data ?? null,
        inventory_action: inventoryAnchorRes.data ?? null,
        reporter_identity: endUserRes.data ?? null,
        // Flat fallback so the console can show a reporter name even when
        // end_user_id was set after classification (or is missing entirely).
        reporter_display_name:
          (endUserRes.data as { display_name?: string | null } | null)?.display_name
          ?? (data as { reporter_user_id?: string | null }).reporter_user_id
          ?? null,
        child_report_ids: (childrenRes.data ?? []).map((r: { id: string }) => r.id),
        tester_submission,
        fix_packet,
      },
    });
  });

  // Unified timeline — merges reporter comments, fixes, QA, pipelines, Ask Mushi.
  app.get('/v1/admin/reports/:id/timeline', adminOrApiKey(), async (c) => {
    const idParsed = parseUuidParam(c);
    if (!idParsed.ok) return idParsed.error;
    const reportId = idParsed.value;
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const projectIds = await callerProjectIds(c, db, userId);

    const { data: report, error } = await db
      .from('reports')
      .select('id, project_id')
      .eq('id', reportId)
      .in('project_id', projectIds)
      .maybeSingle();

    if (error) return dbError(c, error);
    if (!report) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Report not found' } }, 404);
    }

    const timeline = await buildUnifiedReportTimeline(db, report.project_id as string, reportId);
    return c.json({ ok: true, data: { report_id: reportId, timeline } });
  });

  app.patch('/v1/admin/reports/:id', adminOrApiKey({ scope: 'mcp:write' }), async (c) => {
    const idParsed = parseUuidParam(c);
    if (!idParsed.ok) return idParsed.error;
    const reportId = idParsed.value;
    const userId = c.get('userId') as string;
    const body = await c.req.json();
    const db = getServiceClient();

    const projectIds = await callerProjectIds(c, db, userId);

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

    if (typeof updates.status === 'string') {
      const normalized = normalizeAdminStatus(updates.status as string);
      if (!normalized) {
        return c.json(
          { ok: false, error: { code: 'INVALID_STATUS', message: `Unknown status: ${updates.status}` } },
          400,
        );
      }
      // resolved (admin alias) maps to fixed for storage + reporter notifications
      updates.status = normalized === 'resolved' ? 'fixed' : normalized;
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

    // Award reputation points on status transitions. Compare on the stored
    // canonical form (resolved is persisted as fixed) so a legacy `resolved`
    // row being canonicalized to `fixed` isn't treated as a real transition —
    // otherwise it would re-award points and re-fire a `fixed` notification.
    if (report && updates.status && updates.status !== toStoredStatus(report.status)) {
      const newStatus = updates.status as string;
      try {
        void dispatchPluginEvent(db, report.project_id, 'report.status_changed', {
          report: { id: reportId, status: newStatus },
          previousStatus: report.status,
          actor: { kind: 'admin', userId },
        }).catch((e) =>
          log.warn('Plugin dispatch failed', { event: 'report.status_changed', err: String(e) }),
        );
      } catch (e) {
        log.warn('Plugin dispatch failed (sync)', { event: 'report.status_changed', err: String(e) });
      }
      if (newStatus === 'resolved') {
        resolveExternalIssue(reportId, report.project_id, db).catch((e: unknown) =>
          log.error('resolveExternalIssue failed', { reportId, err: String(e) }),
        );
      }
      if (report.reporter_token_hash) {
        notifyReportStatusTransition(db, {
          projectId: report.project_id,
          reportId,
          reporterTokenHash: report.reporter_token_hash,
          previousStatus: report.status,
          newStatus,
        }).catch((e) => log.error('Notification failed', { reportId, err: String(e) }));
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
    const projectIds = await callerProjectIds(c, db, userId);
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
        try {
          void dispatchPluginEvent(db, prev.project_id, 'report.status_changed', {
            report: { id, status: newStatus },
            previousStatus: prev.status,
            actor: { kind: 'admin', userId },
          }).catch((e) =>
            log.warn('Plugin dispatch failed', { event: 'report.status_changed', err: String(e) }),
          );
        } catch (e) {
          log.warn('Plugin dispatch failed (sync)', { event: 'report.status_changed', err: String(e) });
        }
        if (newStatus === 'resolved') {
          resolveExternalIssue(id, prev.project_id, db).catch((e: unknown) =>
            log.error('resolveExternalIssue failed', { reportId: id, err: String(e) }),
          );
        }
        if (prev.reporter_token_hash) {
          // Mirror the per-row PATCH path: a single consolidated helper owns
          // reputation + reporter notification so the two code paths never diverge.
          notifyReportStatusTransition(db, {
            projectId: prev.project_id,
            reportId: id,
            reporterTokenHash: prev.reporter_token_hash,
            previousStatus: prev.status,
            newStatus,
          }).catch((e) => log.error('Notification failed', { reportId: id, err: String(e) }));
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
    const mutationId = c.req.param('mutationId')!;
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
    const projectIds = await callerProjectIds(c, db, userId);
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

}
