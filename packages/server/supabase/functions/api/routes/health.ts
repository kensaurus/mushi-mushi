import type { Hono } from 'npm:hono@4';
import type { Variables } from '../types.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { jwtAuth, adminOrApiKey } from '../../_shared/auth.ts';
import { estimateCallCostUsd } from '../../_shared/pricing.ts';
import { dbError, callerProjectIds, resolveOwnedProject } from '../shared.ts';

export function registerHealthRoutes(app: Hono<{ Variables: Variables }>): void {
  // ============================================================
  // Admin: telemetry & operational health
  // ============================================================

  // ============================================================
  // GET /v1/admin/integrations/health
  //
  // Returns the latest health check result for every configured BYOK
  // channel (Sentry, GitHub, LangFuse, etc.) for projects the caller
  // owns. Orchestrators (LangGraph, OpenAI Agents, CrewAI) can poll
  // this before dispatching a fix to fail-fast on broken channels rather
  // than burning LLM budget and time only to fail at the last step.
  //
  // Response shape:
  //   {
  //     ok: true,
  //     data: {
  //       channels: Array<{
  //         projectId: string
  //         kind: string           // e.g. "sentry", "github", "langfuse"
  //         status: "ok" | "degraded" | "error" | "unknown"
  //         latencyMs: number | null
  //         checkedAt: string      // ISO timestamp
  //         detail: string | null
  //       }>
  //       staleSince: string | null  // ISO — oldest check timestamp, null if no data
  //       summary: "healthy" | "degraded" | "error"
  //     }
  //   }
  // ============================================================
  app.get('/v1/admin/integrations/health', adminOrApiKey({ scope: 'mcp:read' }), async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await callerProjectIds(c, db, userId);
    if (projectIds.length === 0) {
      return c.json({ ok: true, data: { channels: [], staleSince: null, summary: 'healthy' } });
    }

    // Optional filter: ?projectId=<uuid> to scope to a single project.
    const filterProjectId = c.req.query('projectId');
    const scopedIds =
      filterProjectId && projectIds.includes(filterProjectId) ? [filterProjectId] : projectIds;

    // Return the most recent health row per (project_id, kind).
    // We use a subquery in JS since Supabase JS client doesn't expose
    // DISTINCT ON directly — we fetch the last 200 rows and dedupe in memory.
    const { data: rows, error } = await db
      .from('integration_health_history')
      .select('project_id, kind, status, latency_ms, checked_at, message, source')
      .in('project_id', scopedIds)
      .order('checked_at', { ascending: false })
      .limit(500);

    if (error) {
      return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500);
    }

    // Dedupe: keep only the newest row per (project_id, kind).
    const seen = new Set<string>();
    const channels: Array<{
      projectId: string;
      kind: string;
      status: string;
      latencyMs: number | null;
      checkedAt: string;
      message: string | null;
      source: string | null;
    }> = [];
    for (const row of rows ?? []) {
      const key = `${row.project_id}:${row.kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      channels.push({
        projectId: row.project_id,
        kind: row.kind,
        status: row.status ?? 'unknown',
        latencyMs: row.latency_ms ?? null,
        checkedAt: row.checked_at,
        message: row.message ?? null,
        source: row.source ?? null,
      });
    }

    const staleSince =
      channels.length > 0
        ? channels.reduce(
            (min, c) => (c.checkedAt < min ? c.checkedAt : min),
            channels[0].checkedAt,
          )
        : null;

    const hasError = channels.some((ch) => ch.status === 'error');
    const hasDegraded = channels.some((ch) => ch.status === 'degraded');
    const summary = hasError ? 'error' : hasDegraded ? 'degraded' : 'healthy';

    return c.json({ ok: true, data: { channels, staleSince, summary } });
  });

  // GET /v1/admin/health/stats — posture banner + HEALTH SNAPSHOT.
  app.get('/v1/admin/health/stats', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const windowParam = c.req.query('window') ?? '24h';
    const windowMs: Record<string, number> = {
      '1h': 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
    };
    const ms = windowMs[windowParam] ?? windowMs['24h'];

    const empty = {
      hasAnyProject: false,
      projectId: null as string | null,
      projectName: null as string | null,
      projectCount: 0,
      window: windowParam,
      totalCalls: 0,
      errorRatePct: 0,
      fallbackRatePct: 0,
      avgLatencyMs: 0,
      p95LatencyMs: 0,
      cronJobCount: 3,
      cronHealthyCount: 0,
      cronErrorCount: 0,
      cronStaleCount: 0,
      cronWarnCount: 0,
      redCount: 0,
      amberCount: 0,
      lastLlmCallAt: null as string | null,
      topPriority: 'no_project' as
        | 'no_project'
        | 'llm_errors'
        | 'cron_error'
        | 'llm_fallbacks'
        | 'cron_stale'
        | 'idle'
        | 'cron_warn'
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

    const since = new Date(Date.now() - ms).toISOString();
    const KNOWN_JOBS = ['judge-batch', 'intelligence-report', 'data-retention'] as const;
    const EXPECTED_CADENCE_MIN: Record<string, number> = {
      'judge-batch': 60,
      'intelligence-report': 60 * 24 * 7,
      'data-retention': 60 * 24,
    };

    const [invRes, cronRes, lastCallRes] = await Promise.all([
      db
        .from('llm_invocations')
        .select('fallback_used, status, latency_ms, created_at')
        .eq('project_id', pid)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(500),
      db
        .from('cron_runs')
        .select('job_name, status, started_at')
        .order('started_at', { ascending: false })
        .limit(100),
      db
        .from('llm_invocations')
        .select('created_at')
        .eq('project_id', pid)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const rows = invRes.data ?? [];
    const totalCalls = rows.length;
    const fallbacks = rows.filter((r) => r.fallback_used).length;
    const errors = rows.filter((r) => r.status !== 'success').length;
    const errorRatePct = totalCalls > 0 ? Math.round((errors / totalCalls) * 1000) / 10 : 0;
    const fallbackRatePct = totalCalls > 0 ? Math.round((fallbacks / totalCalls) * 1000) / 10 : 0;
    const latencies = rows.map((r) => r.latency_ms ?? 0).sort((a, b) => a - b);
    const avgLatencyMs =
      latencies.length > 0
        ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
        : 0;
    const p95LatencyMs =
      latencies.length > 0
        ? (latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] ?? 0)
        : 0;

    const cronRows = cronRes.data ?? [];
    const now = Date.now();
    let cronErrorCount = 0;
    let cronStaleCount = 0;
    let cronWarnCount = 0;
    let cronHealthyCount = 0;

    for (const job of KNOWN_JOBS) {
      const jobRuns = cronRows.filter((r) => r.job_name === job);
      const lastRun = jobRuns[0];
      const lastStatus = lastRun?.status ?? null;
      if (lastStatus === 'error') {
        cronErrorCount += 1;
        continue;
      }
      const lastRunIso = lastRun?.started_at ?? null;
      if (!lastRunIso) {
        cronStaleCount += 1;
        continue;
      }
      const ageMin = Math.max(0, Math.round((now - new Date(lastRunIso).getTime()) / 60_000));
      const expected = EXPECTED_CADENCE_MIN[job] ?? 60 * 24;
      if (ageMin > expected * 3) cronStaleCount += 1;
      else if (ageMin > expected) cronWarnCount += 1;
      else cronHealthyCount += 1;
    }

    const redCount = (errorRatePct > 5 ? 1 : 0) + cronErrorCount;
    const amberCount = (fallbackRatePct > 10 ? 1 : 0) + cronWarnCount + cronStaleCount;

    let topPriority = empty.topPriority;
    let topPriorityLabel: string | null = null;
    let topPriorityTo: string | null = null;

    if (errorRatePct > 5) {
      topPriority = 'llm_errors';
      topPriorityLabel = `LLM error rate ${errorRatePct}% over ${windowParam} — check provider status or rotate API keys.`;
      topPriorityTo = '/health?tab=llm';
    } else if (cronErrorCount > 0) {
      topPriority = 'cron_error';
      topPriorityLabel = `${cronErrorCount} cron job${cronErrorCount === 1 ? '' : 's'} failing — trigger manually to confirm, then inspect logs.`;
      topPriorityTo = '/health?tab=cron';
    } else if (fallbackRatePct > 10) {
      topPriority = 'llm_fallbacks';
      topPriorityLabel = `Fallback rate ${fallbackRatePct}% — primary provider may be rate-limiting.`;
      topPriorityTo = '/health?tab=llm';
    } else if (cronStaleCount > 0) {
      topPriority = 'cron_stale';
      topPriorityLabel = `${cronStaleCount} cron job${cronStaleCount === 1 ? '' : 's'} stale — last run exceeded 3× expected cadence.`;
      topPriorityTo = '/health?tab=cron';
    } else if (totalCalls === 0) {
      topPriority = 'idle';
      topPriorityLabel = `No LLM activity in the last ${windowParam} — send a test report to verify routing.`;
      topPriorityTo = '/onboarding';
    } else if (cronWarnCount > 0) {
      topPriority = 'cron_warn';
      topPriorityLabel = `${cronWarnCount} cron job${cronWarnCount === 1 ? '' : 's'} running late — not yet blocking.`;
      topPriorityTo = '/health?tab=cron';
    } else {
      topPriority = 'healthy';
      topPriorityLabel = `${totalCalls} LLM calls · ${errorRatePct}% errors · ${fallbackRatePct}% fallbacks — all systems nominal.`;
      topPriorityTo = '/health?tab=activity';
    }

    return c.json({
      ok: true,
      data: {
        hasAnyProject: true,
        projectId: pid,
        projectName: activeProject.project_name ?? null,
        projectCount: projectIds.length,
        window: windowParam,
        totalCalls,
        errorRatePct,
        fallbackRatePct,
        avgLatencyMs,
        p95LatencyMs,
        cronJobCount: KNOWN_JOBS.length,
        cronHealthyCount,
        cronErrorCount,
        cronStaleCount,
        cronWarnCount,
        redCount,
        amberCount,
        lastLlmCallAt: lastCallRes.data?.created_at ?? null,
        topPriority,
        topPriorityLabel,
        topPriorityTo,
      },
    });
  });

  app.get('/v1/admin/health/llm', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await callerProjectIds(c, db, userId);

    const windowParam = c.req.query('window') ?? '24h';
    const windowMs: Record<string, number> = {
      '1h': 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
    };
    const ms = windowMs[windowParam] ?? windowMs['24h'];

    if (projectIds.length === 0) {
      return c.json({
        ok: true,
        data: {
          window: windowParam,
          totalCalls: 0,
          fallbacks: 0,
          fallbackRate: 0,
          errors: 0,
          errorRate: 0,
          avgLatencyMs: 0,
          p95LatencyMs: 0,
          byModel: {},
          byFunction: {},
          recent: [],
        },
      });
    }

    const since = new Date(Date.now() - ms).toISOString();
    const { data: invocations } = await db
      .from('llm_invocations')
      .select(
        'function_name, used_model, primary_model, fallback_used, status, latency_ms, input_tokens, output_tokens, cost_usd, created_at, langfuse_trace_id, report_id, key_source',
      )
      .in('project_id', projectIds)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(500);

    const rows = invocations ?? [];
    const totalCalls = rows.length;
    const fallbacks = rows.filter((r) => r.fallback_used).length;
    const errors = rows.filter((r) => r.status !== 'success').length;
    const avgLatency =
      rows.length > 0
        ? Math.round(rows.reduce((sum, r) => sum + (r.latency_ms ?? 0), 0) / rows.length)
        : 0;

    // Per-function p95 + a global p95. Sort once, slice index = floor(0.95 * len).
    const sortedGlobal = rows.map((r) => r.latency_ms ?? 0).sort((a, b) => a - b);
    const p95Latency =
      sortedGlobal.length > 0
        ? (sortedGlobal[
            Math.min(sortedGlobal.length - 1, Math.floor(sortedGlobal.length * 0.95))
          ] ?? 0)
        : 0;

    const byModel: Record<string, { calls: number; errors: number; tokens: number }> = {};
    const byFunction: Record<
      string,
      {
        calls: number;
        errors: number;
        fallbacks: number;
        avgLatencyMs: number;
        p95LatencyMs: number;
        costUsd: number;
        lastFailureAt: string | null;
      }
    > = {};
    const fnLatency: Record<string, number[]> = {};
    for (const r of rows) {
      const modelKey = r.used_model;
      byModel[modelKey] ??= { calls: 0, errors: 0, tokens: 0 };
      byModel[modelKey].calls += 1;
      if (r.status !== 'success') byModel[modelKey].errors += 1;
      byModel[modelKey].tokens += (r.input_tokens ?? 0) + (r.output_tokens ?? 0);

      const fnKey = r.function_name;
      byFunction[fnKey] ??= {
        calls: 0,
        errors: 0,
        fallbacks: 0,
        avgLatencyMs: 0,
        p95LatencyMs: 0,
        costUsd: 0,
        lastFailureAt: null,
      };
      const fnAgg = byFunction[fnKey];
      fnAgg.calls += 1;
      if (r.status !== 'success') {
        fnAgg.errors += 1;
        // Track the most recent failure timestamp so the FE can render
        // "last failure 12m ago" without a second query.
        if (!fnAgg.lastFailureAt || r.created_at > fnAgg.lastFailureAt) {
          fnAgg.lastFailureAt = r.created_at as string;
        }
      }
      if (r.fallback_used) fnAgg.fallbacks += 1;
      // Prefer the persisted cost_usd column Fall back to the
      // shared estimator for ancient rows the backfill missed.
      fnAgg.costUsd +=
        r.cost_usd != null
          ? Number(r.cost_usd)
          : estimateCallCostUsd(r.used_model, r.input_tokens ?? 0, r.output_tokens ?? 0);
      fnLatency[fnKey] ??= [];
      fnLatency[fnKey].push(r.latency_ms ?? 0);
    }
    for (const fn of Object.keys(byFunction)) {
      const arr = fnLatency[fn].slice().sort((a, b) => a - b);
      byFunction[fn].avgLatencyMs =
        arr.length > 0 ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length) : 0;
      byFunction[fn].p95LatencyMs =
        arr.length > 0 ? (arr[Math.min(arr.length - 1, Math.floor(arr.length * 0.95))] ?? 0) : 0;
      byFunction[fn].costUsd = Math.round(byFunction[fn].costUsd * 10000) / 10000;
    }

    return c.json({
      ok: true,
      data: {
        window: windowParam,
        totalCalls,
        fallbacks,
        fallbackRate: totalCalls > 0 ? fallbacks / totalCalls : 0,
        errors,
        errorRate: totalCalls > 0 ? errors / totalCalls : 0,
        avgLatencyMs: avgLatency,
        p95LatencyMs: p95Latency,
        byModel,
        byFunction,
        recent: rows.slice(0, 100),
      },
    });
  });

  app.get('/v1/admin/health/cron', jwtAuth, async (c) => {
    const db = getServiceClient();
    const { data: runs } = await db
      .from('cron_runs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(100);

    const byJob: Record<
      string,
      {
        lastRun: string | null;
        lastStatus: string | null;
        successRate: number;
        avgDurationMs: number;
        runs: number;
        /** Minutes since last run; null when the job has never executed. */
        stalenessMinutes: number | null;
        /** Staleness tier for the UI: `ok` (within expected cadence),
         *  `warn` (up to 3x expected), `stale` (beyond 3x), `never` (no run on record). */
        staleness: 'ok' | 'warn' | 'stale' | 'never';
      }
    > = {};

    // Expected cadences in minutes. Any job we don't know about defaults to
    // 24h (day-scale), which keeps the probe conservative for new crons.
    const EXPECTED_CADENCE_MIN: Record<string, number> = {
      'judge-batch': 60,
      'intelligence-report': 60 * 24 * 7,
      'data-retention': 60 * 24,
      'pipeline-recovery': 5,
      'repo-indexer': 60 * 24,
      'seer-poller': 15,
      'ci-sync': 60,
    };
    const now = Date.now();
    const rowsOrEmpty = runs ?? [];

    for (const r of rowsOrEmpty) {
      byJob[r.job_name] ??= {
        lastRun: null,
        lastStatus: null,
        successRate: 0,
        avgDurationMs: 0,
        runs: 0,
        stalenessMinutes: null,
        staleness: 'never',
      };
      const j = byJob[r.job_name];
      if (!j.lastRun) {
        j.lastRun = r.started_at;
        j.lastStatus = r.status;
      }
      j.runs += 1;
    }
    for (const job of Object.keys(byJob)) {
      const jobRuns = rowsOrEmpty.filter((r) => r.job_name === job);
      const successes = jobRuns.filter((r) => r.status === 'success').length;
      byJob[job].successRate = jobRuns.length > 0 ? successes / jobRuns.length : 0;
      const durations = jobRuns.map((r) => r.duration_ms ?? 0).filter((d) => d > 0);
      byJob[job].avgDurationMs =
        durations.length > 0
          ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
          : 0;
      // Staleness: how long since the most recent run compared to the
      // expected cadence. This lets the UI surface "judge-batch hasn't run
      // in 6h" without every page having to hard-code cadences.
      const lastRunIso = byJob[job].lastRun;
      if (lastRunIso) {
        const ageMin = Math.max(0, Math.round((now - new Date(lastRunIso).getTime()) / 60_000));
        const expected = EXPECTED_CADENCE_MIN[job] ?? 60 * 24;
        byJob[job].stalenessMinutes = ageMin;
        byJob[job].staleness =
          ageMin <= expected ? 'ok' : ageMin <= expected * 3 ? 'warn' : 'stale';
      }
    }

    return c.json({ ok: true, data: { byJob, recent: rowsOrEmpty.slice(0, 30) } });
  });

  // Wave T.5.8a: unified chart-annotation feed. Reads the admin_chart_events
  // view (deploys, non-success cron ticks, BYOK rotations) within the
  // requested window and kind filter. Output is capped at 200 events to
  // keep the overlay snappy on long time ranges; UIs can narrow the
  // window or `kinds` filter to see more.
  app.get('/v1/admin/chart-events', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const url = new URL(c.req.url);
    const projectIdRaw = url.searchParams.get('project_id');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const kindsParam = url.searchParams.get('kinds');
    const allowedKinds = new Set(['deploy', 'cron', 'byok']);
    const kinds = (kindsParam ?? 'deploy,cron,byok')
      .split(',')
      .map((k) => k.trim())
      .filter((k) => allowedKinds.has(k));
    if (kinds.length === 0) {
      return c.json(
        {
          ok: false,
          error: { code: 'INVALID_INPUT', message: 'kinds[] must include one of deploy/cron/byok' },
        },
        400,
      );
    }

    // Authorization: scope strictly to projects this user owns. The service
    // client bypasses RLS, and `admin_chart_events` is `SECURITY INVOKER` so
    // RLS only protects callers who use the user JWT — which we do not. We
    // therefore enforce ownership ourselves by computing the accessible
    // project ids (Teams v1: owner OR org-member OR project-member) and
    // filtering with `.in('project_id', ...)`. Global rows (cron ticks with
    // NULL project_id) are still surfaced because they don't belong to any
    // specific tenant.
    const db = getServiceClient();
    const ownedIds = await callerProjectIds(c, db, userId);

    // Validate the optional caller-supplied `project_id` filter as a UUID
    // before threading it into the query — both to reject obvious garbage
    // and to defuse PostgREST `.or()` filter-string injection (commas /
    // dots in a raw value can broaden the filter beyond ownership).
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let projectFilter: string[] | null = null;
    if (projectIdRaw) {
      if (!UUID_RE.test(projectIdRaw)) {
        return c.json(
          { ok: false, error: { code: 'INVALID_INPUT', message: 'project_id must be a UUID' } },
          400,
        );
      }
      if (!ownedIds.includes(projectIdRaw)) {
        return c.json(
          { ok: false, error: { code: 'FORBIDDEN', message: 'Not your project' } },
          403,
        );
      }
      projectFilter = [projectIdRaw];
    } else {
      projectFilter = ownedIds;
    }

    let query = db
      .from('admin_chart_events')
      .select('occurred_at, kind, label, href, project_id')
      .in('kind', kinds)
      .order('occurred_at', { ascending: false })
      .limit(200);
    if (from) query = query.gte('occurred_at', from);
    if (to) query = query.lte('occurred_at', to);
    // Owned rows OR globally-scoped rows (project_id IS NULL — deploy /
    // cron events that aren't tenant-specific). When the user owns no
    // projects, only the global rows are visible.
    if (projectFilter.length > 0) {
      const idList = projectFilter.map((id) => `"${id}"`).join(',');
      query = query.or(`project_id.in.(${idList}),project_id.is.null`);
    } else {
      query = query.is('project_id', null);
    }

    const { data, error } = await query;
    if (error) return dbError(c, error);

    return c.json({
      ok: true,
      data: {
        events: (data ?? []).map((e) => ({
          occurred_at: e.occurred_at,
          kind: e.kind,
          label: e.label,
          href: e.href ?? null,
          project_id: e.project_id ?? null,
        })),
      },
    });
  });

  app.post('/v1/admin/health/cron/:job/trigger', jwtAuth, async (c) => {
    const job = c.req.param('job')!;
    const allowed = ['judge-batch', 'intelligence-report'] as const;
    if (!allowed.includes(job as (typeof allowed)[number])) {
      return c.json(
        { ok: false, error: { code: 'UNKNOWN_JOB', message: `Unknown job: ${job}` } },
        400,
      );
    }
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const resolvedProject = await resolveOwnedProject(c, db, userId);
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;

    const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/${job}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ projectId: project.id, trigger: 'manual' }),
    });
    const result = await res.json().catch(() => ({}));
    return c.json({ ok: res.ok, data: result.data ?? result });
  });
}
