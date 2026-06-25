import type { Hono } from 'npm:hono@4';
import type { Variables } from '../types.ts';
import { z } from 'npm:zod@3';
import { getServiceClient } from '../../_shared/db.ts';
import { jwtAuth } from '../../_shared/auth.ts';
import { requireFeature, resolveActiveEntitlement } from '../../_shared/entitlements.ts';
import { dbError, callerProjectIds, resolveOwnedProject, scopedOwnedProjectIds } from '../shared.ts';
import { sanitizeRenderedHtml } from '../../_shared/html-sanitize.ts';
import { log } from '../../_shared/logger.ts';

const syntheticTriggerSchema = z.object({
  count: z.number().int().min(1).max(50).optional(),
});

export function registerIntelligenceSyntheticRoutes(app: Hono<{ Variables: Variables }>): void {
  app.post('/v1/admin/synthetic', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const rawBody = await c.req.json().catch(() => ({}));
    const parsedBody = syntheticTriggerSchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return c.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: parsedBody.error.message } },
        400,
      );
    }
    const db = getServiceClient();
    const resolvedProject = await resolveOwnedProject(c, db, userId);
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;

    const count = parsedBody.data.count ?? 10;
    const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-synthetic`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ projectId: project.id, count }),
    });
    const result = await res.json();
    return c.json({ ok: true, data: result.data });
  });

  app.get('/v1/admin/synthetic', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await callerProjectIds(c, db, userId);
    const { data } = await db
      .from('synthetic_reports')
      .select(
        'id, project_id, generated_report, expected_classification, actual_classification, match_score, generated_at',
      )
      .in('project_id', projectIds)
      .order('generated_at', { ascending: false })
      .limit(50);
    return c.json({ ok: true, data: { reports: data ?? [] } });
  });

  // GET /v1/admin/intelligence/stats — posture banner + INTELLIGENCE SNAPSHOT.
  app.get('/v1/admin/intelligence/stats', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const empty = {
      hasAnyProject: false,
      projectId: null as string | null,
      projectName: null as string | null,
      projectCount: 0,
      featureUnlocked: false,
      planName: null as string | null,
      reportCount: 0,
      latestReportAt: null as string | null,
      latestWeekStart: null as string | null,
      daysSinceLastDigest: null as number | null,
      totalReportsInLatest: 0,
      totalFixAttempts: 0,
      fixCompletionRatePct: 0,
      activeJobCount: 0,
      failedJobCount: 0,
      completedJobCount: 0,
      lastJobStatus: null as string | null,
      lastJobError: null as string | null,
      lastJobAt: null as string | null,
      pendingFindings: 0,
      securityFindings: 0,
      benchmarkOptIn: false,
      topPriority: 'no_project' as
        | 'no_project'
        | 'feature_locked'
        | 'job_running'
        | 'job_failed'
        | 'stale_digest'
        | 'no_reports'
        | 'pending_findings'
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

    const entitlement = await resolveActiveEntitlement(c);
    const featureUnlocked = entitlement?.hasFeature('intelligence_reports') ?? false;
    const planName = entitlement?.plan?.display_name ?? null;

    const [reportsRes, jobsRes, findingsRes, settingsRes] = await Promise.all([
      db
        .from('intelligence_reports')
        .select('id, week_start, stats, created_at')
        .eq('project_id', pid)
        .order('week_start', { ascending: false })
        .limit(52),
      db
        .from('intelligence_generation_jobs')
        .select('id, status, error, created_at, started_at, finished_at')
        .eq('project_id', pid)
        .order('created_at', { ascending: false })
        .limit(20),
      db
        .from('modernization_findings')
        .select('id, severity, status')
        .eq('project_id', pid)
        .eq('status', 'pending'),
      db
        .from('project_settings')
        .select('benchmarking_optin')
        .eq('project_id', pid)
        .maybeSingle(),
    ]);

    const reports = reportsRes.data ?? [];
    const jobs = jobsRes.data ?? [];
    const findings = findingsRes.data ?? [];
    const latestReport = reports[0] ?? null;
    const latestJob = jobs[0] ?? null;
    const activeJobs = jobs.filter((j) => j.status === 'queued' || j.status === 'running');
    const failedJobs = jobs.filter((j) => j.status === 'failed');
    const completedJobs = jobs.filter((j) => j.status === 'completed');

    const daysSinceLastDigest = latestReport?.created_at
      ? Math.floor((Date.now() - new Date(latestReport.created_at).getTime()) / (24 * 60 * 60 * 1000))
      : null;

    const latestStats = (latestReport?.stats as { reports?: { total?: number }; fixes?: { total?: number; completionRate?: number } } | null) ?? null;
    const totalReportsInLatest = latestStats?.reports?.total ?? 0;
    const totalFixAttempts = reports.reduce(
      (sum, r) => sum + (((r.stats as { fixes?: { total?: number } } | null)?.fixes?.total) ?? 0),
      0,
    );
    const rawRate = latestStats?.fixes?.completionRate ?? 0;
    const fixCompletionRatePct =
      rawRate <= 1 ? Math.round(rawRate * 1000) / 10 : Math.round(rawRate * 10) / 10;
    const pendingFindings = findings.length;
    const securityFindings = findings.filter((f) => f.severity === 'security').length;
    const benchmarkOptIn = settingsRes.data?.benchmarking_optin === true;

    let topPriority = empty.topPriority;
    let topPriorityLabel: string | null = null;
    let topPriorityTo: string | null = null;

    if (!featureUnlocked) {
      topPriority = 'feature_locked';
      topPriorityLabel = `Intelligence reports require a plan upgrade${planName ? ` (current: ${planName})` : ''}.`;
      topPriorityTo = '/billing';
    } else if (activeJobs.length > 0) {
      topPriority = 'job_running';
      topPriorityLabel = `Job ${activeJobs[0]!.id.slice(0, 8)}… is ${activeJobs[0]!.status} — digest lands in Reports when complete (typical 20–60s).`;
      topPriorityTo = '/intelligence?tab=pipeline';
    } else if (latestJob?.status === 'failed') {
      topPriority = 'job_failed';
      topPriorityLabel = latestJob.error ?? 'Last generation failed — check Settings → LLM Keys and retry.';
      topPriorityTo = '/intelligence?tab=pipeline';
    } else if (reports.length === 0) {
      topPriority = 'no_reports';
      topPriorityLabel = 'No weekly digests archived yet — Monday cron writes automatically, or generate one now.';
      topPriorityTo = '/intelligence?tab=overview';
    } else if (daysSinceLastDigest != null && daysSinceLastDigest > 7) {
      topPriority = 'stale_digest';
      topPriorityLabel = `Last digest was ${daysSinceLastDigest} days ago — generate a fresh weekly narrative.`;
      topPriorityTo = '/intelligence?tab=overview';
    } else if (pendingFindings > 0) {
      topPriority = 'pending_findings';
      topPriorityLabel = `${pendingFindings} library modernization finding${pendingFindings === 1 ? '' : 's'} pending triage${securityFindings > 0 ? ` · ${securityFindings} security` : ''}.`;
      topPriorityTo = '/intelligence?tab=pipeline';
    } else {
      topPriority = 'healthy';
      topPriorityLabel = `${reports.length} digest${reports.length === 1 ? '' : 's'} on file · last ${daysSinceLastDigest ?? 0}d ago${benchmarkOptIn ? ' · benchmarking on' : ''}.`;
      topPriorityTo = '/intelligence?tab=reports';
    }

    return c.json({
      ok: true,
      data: {
        hasAnyProject: true,
        projectId: pid,
        projectName: activeProject.project_name ?? null,
        projectCount: projectIds.length,
        featureUnlocked,
        planName,
        reportCount: reports.length,
        latestReportAt: latestReport?.created_at ?? null,
        latestWeekStart: latestReport?.week_start ?? null,
        daysSinceLastDigest,
        totalReportsInLatest,
        totalFixAttempts,
        fixCompletionRatePct,
        activeJobCount: activeJobs.length,
        failedJobCount: failedJobs.length,
        completedJobCount: completedJobs.length,
        lastJobStatus: latestJob?.status ?? null,
        lastJobError: latestJob?.error ?? null,
        lastJobAt: latestJob?.created_at ?? null,
        pendingFindings,
        securityFindings,
        benchmarkOptIn,
        topPriority,
        topPriorityLabel,
        topPriorityTo,
      },
    });
  });

  // Async generation: enqueue a job, kick the worker fire-and-forget, return
  // the job id immediately. The page polls /v1/admin/intelligence/jobs and
  // shows a progress card. Avoids the 30s+ "spinner forever" symptom users hit
  // when the call was synchronous.
  app.post('/v1/admin/intelligence', jwtAuth, requireFeature('intelligence_reports'), async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const resolvedProject = await resolveOwnedProject(c, db, userId);
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;

    // Wave S (2026-04-23): Intelligence reports run a multi-LLM pipeline
    // (stage1 classify → stage2 synthesize → summary). Even with the queue
    // de-dupe below, a scripted loop can still enqueue one job, cancel it,
    // enqueue the next, and drain Anthropic budget. 20 reports/hour is far
    // more than any human operator needs and cleanly rate-limits bots.
    {
      const { error: rateErr } = await db.rpc('scoped_rate_limit_claim', {
        p_user_id: userId,
        p_scope: 'intelligence',
        p_max_per_window: 20,
        p_window: '1 hour',
      });
      if (rateErr) {
        const msg = rateErr.message ?? '';
        if (msg.includes('rate_limit_exceeded')) {
          return c.json(
            {
              ok: false,
              error: {
                code: 'RATE_LIMITED',
                message: 'Intelligence report hourly limit reached (20/hour). Try again next hour.',
              },
            },
            429,
          );
        }
        log.warn('rate limit RPC failed', { scope: 'intelligence', err: msg });
      }
    }

    // De-dupe: if there's already a queued/running job for this user+project,
    // return it instead of stacking duplicates that would burn LLM credits.
    const { data: existing } = await db
      .from('intelligence_generation_jobs')
      .select('id, status')
      .eq('project_id', project.id)
      .in('status', ['queued', 'running'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) {
      return c.json({ ok: true, data: { jobId: existing.id, deduplicated: true } });
    }

    const { data: job, error: insertErr } = await db
      .from('intelligence_generation_jobs')
      .insert({
        project_id: project.id,
        requested_by: userId,
        trigger: 'manual',
        status: 'queued',
      })
      .select('id')
      .single();
    if (insertErr || !job) {
      return dbError(c, insertErr ?? { message: 'Failed to enqueue' });
    }

    // Kick the worker without awaiting — it does its own status updates.
    // We deliberately don't `await` here so the user doesn't wait for the LLM.
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (supabaseUrl && serviceKey) {
      void (async () => {
        const startedAt = new Date().toISOString();
        await db
          .from('intelligence_generation_jobs')
          .update({ status: 'running', started_at: startedAt })
          .eq('id', job.id);
        try {
          const ctrl = new AbortController();
          // Hard ceiling so a misconfigured BYOK key never wedges the job row.
          const timeout = setTimeout(() => ctrl.abort(), 90_000);
          const res = await fetch(`${supabaseUrl}/functions/v1/intelligence-report`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${serviceKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ projectId: project.id, trigger: 'manual', jobId: job.id }),
            signal: ctrl.signal,
          });
          clearTimeout(timeout);
          const finishedAt = new Date().toISOString();
          if (!res.ok) {
            const errText = await res.text().catch(() => `HTTP ${res.status}`);
            await db
              .from('intelligence_generation_jobs')
              .update({
                status: 'failed',
                error: errText.slice(0, 500),
                finished_at: finishedAt,
              })
              .eq('id', job.id);
            return;
          }
          const payload = await res.json().catch(() => ({}));
          const firstReportId = Array.isArray(payload?.data?.reportIds)
            ? (payload.data.reportIds[0] ?? null)
            : null;
          await db
            .from('intelligence_generation_jobs')
            .update({
              status: 'completed',
              report_id: firstReportId,
              finished_at: finishedAt,
            })
            .eq('id', job.id);
        } catch (err) {
          await db
            .from('intelligence_generation_jobs')
            .update({
              status: 'failed',
              error: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
              finished_at: new Date().toISOString(),
            })
            .eq('id', job.id);
        }
      })();
    }

    return c.json({ ok: true, data: { jobId: job.id } });
  });

  app.get('/v1/admin/intelligence/jobs', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await scopedOwnedProjectIds(c, db, userId);
    if (projectIds.length === 0) return c.json({ ok: true, data: { jobs: [] } });
    const { data } = await db
      .from('intelligence_generation_jobs')
      .select(
        'id, project_id, status, trigger, report_id, error, created_at, started_at, finished_at',
      )
      .in('project_id', projectIds)
      .order('created_at', { ascending: false })
      .limit(20);
    return c.json({ ok: true, data: { jobs: data ?? [] } });
  });

  app.post(
    '/v1/admin/intelligence/jobs/:id/cancel',
    jwtAuth,
    requireFeature('intelligence_reports'),
    async (c) => {
      const userId = c.get('userId') as string;
      const id = c.req.param('id')!;
      const db = getServiceClient();
      const projectIds = await callerProjectIds(c, db, userId);
      if (projectIds.length === 0) return c.json({ ok: false, error: { code: 'FORBIDDEN' } }, 403);
      const { data: job } = await db
        .from('intelligence_generation_jobs')
        .select('id, project_id, status')
        .eq('id', id)
        .maybeSingle();
      if (!job || !projectIds.includes(job.project_id)) {
        return c.json({ ok: false, error: { code: 'NOT_FOUND' } }, 404);
      }
      if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
        return c.json(
          { ok: false, error: { code: 'TERMINAL', message: `Job is already ${job.status}` } },
          409,
        );
      }
      // We can't actually halt the in-flight LLM call (Supabase Edge Functions
      // don't expose process control), but flipping the row to cancelled stops
      // the UI from polling and prevents any further enqueue dedupe.
      await db
        .from('intelligence_generation_jobs')
        .update({ status: 'cancelled', finished_at: new Date().toISOString() })
        .eq('id', id);
      return c.json({ ok: true });
    },
  );

  // V5.3 §2.16 — list & download persisted intelligence reports.
  app.get('/v1/admin/intelligence', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await scopedOwnedProjectIds(c, db, userId);
    if (projectIds.length === 0) return c.json({ ok: true, data: { reports: [] } });

    const { data, error } = await db
      .from('intelligence_reports')
      .select(
        'id, project_id, week_start, summary_md, stats, benchmarks, llm_model, llm_tokens_in, llm_tokens_out, generated_by, created_at',
      )
      .in('project_id', projectIds)
      .order('week_start', { ascending: false })
      .limit(52);

    if (error) return dbError(c, error);
    return c.json({ ok: true, data: { reports: data ?? [] } });
  });

  // Returns the rendered HTML so the admin client can pop it open in a new
  // window and use the browser's native print pipeline to save as PDF.
  app.get('/v1/admin/intelligence/:id/html', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const id = c.req.param('id')!;
    const db = getServiceClient();
    const projectIds = await callerProjectIds(c, db, userId);
    if (projectIds.length === 0)
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'No reports' } }, 404);

    const { data, error } = await db
      .from('intelligence_reports')
      .select('rendered_html, project_id')
      .eq('id', id)
      .maybeSingle();
    if (error) return dbError(c, error);
    if (!data || !projectIds.includes(data.project_id))
      return c.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Report not visible to caller' } },
        404,
      );

    return new Response(
      sanitizeRenderedHtml(data.rendered_html ?? '<p>No rendered HTML available for this report.</p>'),
      {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': "default-src 'self'; img-src data: https:; style-src 'self' 'unsafe-inline'; script-src 'none';",
          'X-Content-Type-Options': 'nosniff',
        },
      },
    );
  });

  // V5.3 §2.17 — Apache AGE parallel-write graph backend status & drift.
  app.get('/v1/admin/graph-backend/status', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const resolvedProject = await resolveOwnedProject(c, db, userId);
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;

    const { data: settings } = await db
      .from('project_settings')
      .select('graph_backend')
      .eq('project_id', project.id)
      .maybeSingle();

    const { data: ageAvail } = await db.rpc('mushi_age_available');

    const { data: latestAudit } = await db
      .from('age_drift_audit')
      .select('*')
      .eq('project_id', project.id)
      .order('ran_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: nodesUnsynced } = await db
      .from('graph_nodes')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', project.id)
      .is('age_synced_at', null);

    const { data: edgesUnsynced } = await db
      .from('graph_edges')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', project.id)
      .is('age_synced_at', null);

    return c.json({
      ok: true,
      data: {
        backend: settings?.graph_backend ?? 'sql_only',
        ageAvailable: ageAvail === true,
        latestAudit,
        unsynced: {
          nodes: (nodesUnsynced as unknown as { count?: number } | null)?.count ?? null,
          edges: (edgesUnsynced as unknown as { count?: number } | null)?.count ?? null,
        },
      },
    });
  });

  app.post('/v1/admin/graph-backend/snapshot', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const resolvedProject = await resolveOwnedProject(c, db, userId);
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;

    const { data, error } = await db.rpc('mushi_age_snapshot_drift', { p_project_id: project.id });
    if (error) return dbError(c, error);
    return c.json({ ok: true, data: { auditId: data } });
  });

  // V5.3 §2.16 — privacy-preserving cross-customer benchmarking opt-in.
  app.put('/v1/admin/settings/benchmarking', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const body = await c.req.json().catch(() => ({}));
    const optIn = body?.optIn === true;
    const db = getServiceClient();
    const resolvedProject = await resolveOwnedProject(c, db, userId);
    if ('response' in resolvedProject) return resolvedProject.response;
    const project = resolvedProject.project;

    const { error } = await db
      .from('project_settings')
      .update({
        benchmarking_optin: optIn,
        benchmarking_optin_at: optIn ? new Date().toISOString() : null,
        benchmarking_optin_by: optIn ? userId : null,
      })
      .eq('project_id', project.id);

    if (error) return dbError(c, error);
    return c.json({ ok: true, data: { optIn } });
  });

}
