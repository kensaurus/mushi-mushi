/**
 * FILE: packages/server/supabase/functions/api/routes/qa-coverage.ts
 * PURPOSE: REST endpoints backing the QA Coverage Suite — CRUD for qa_stories,
 *          runs history, evidence, aggregated coverage stats, platform health
 *          rollup, and manual "run now" trigger.
 *
 * OVERVIEW:
 * - GET  /v1/admin/projects/:id/qa-coverage          → list stories with 24h stats
 * - GET  /v1/admin/projects/:id/qa-coverage-summary  → tile summary (total/pass/fail/top_failing)
 * - GET  /v1/admin/projects/:id/qa-stories/:sid      → single story detail
 * - POST /v1/admin/projects/:id/qa-stories           → create story
 * - PATCH /v1/admin/projects/:id/qa-stories/:sid     → update story (name/script/schedule/enabled)
 * - DELETE /v1/admin/projects/:id/qa-stories/:sid    → delete story
 * - GET  /v1/admin/projects/:id/qa-stories/:sid/runs                → recent runs (all columns)
 * - POST /v1/admin/projects/:id/qa-stories/:sid/run               → queue a manual run
 * - GET  /v1/admin/projects/:id/qa-stories/:sid/runs/:rid/evidence → evidence artefacts + signed URLs
 * - GET  /v1/admin/projects/:id/platform-rollup                   → platform health tile data
 *
 * DEPENDENCIES:
 * - qa_stories, qa_story_runs, qa_story_coverage_24h, qa_platform_rollup_24h (migration 20260514)
 * - jwtAuth, ownedProjectIds, dbError
 */

import type { Hono } from 'npm:hono@4';
import type { Context, Next } from 'npm:hono@4';
import type { Variables } from '../types.ts';
import { z } from 'npm:zod@3';
import { jwtAuth, apiKeyAuth } from '../../_shared/auth.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { dbError, ownedProjectIds, jsonError } from '../shared.ts';

const CRON_FIELD = /^(\*(\/\d+)?|\d+(-\d+)?(,\d+(-\d+)?)*)(\/\d+)?$/;

const qaStoryCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  prompt: z.string().max(20_000).nullable().optional(),
  script: z.string().max(200_000).nullable().optional(),
  target_url: z.string().url().nullable().optional(),
  browser_provider: z.enum(['firecrawl_actions', 'browserbase', 'local']).optional(),
  schedule_cron: z
    .string()
    .max(120)
    .refine((v) => {
      const parts = v.trim().split(/\s+/);
      return parts.length === 5 && parts.every((p) => CRON_FIELD.test(p));
    }, 'schedule_cron must be a 5-field cron expression')
    .optional(),
  byok_provider: z.string().max(64).nullable().optional(),
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function assertUuid(c: Context, value: string, name: string) {
  if (!UUID_RE.test(value)) {
    return c.json({ ok: false, error: { code: 'INVALID_UUID', message: `${name} must be a full UUID (got: "${value}"). Use 'mushi qa stories' to get the complete story ID.` } }, 400);
  }
  return null;
}

// Dual-auth middleware for CLI + browser: accepts either a Supabase JWT (browser)
// or a project API key (X-Mushi-Api-Key). The API key must belong to the same project.
async function jwtOrApiKey(c: Context<{ Variables: Variables }>, next: Next) {
  const apiKey = c.req.header('X-Mushi-Api-Key');
  if (apiKey) {
    // Delegate to apiKeyAuth to validate and set projectId
    let called = false;
    await apiKeyAuth(c as never, async () => { called = true; });
    if (!called) return; // apiKeyAuth rejected — response already set
    // Verify the route's :pid matches the key's project
    const keyProjectId = c.get('projectId' as keyof Variables) as string | undefined;
    const routePid = c.req.param('pid');
    if (keyProjectId && routePid && keyProjectId !== routePid) {
      return c.json({ error: { code: 'FORBIDDEN', message: 'API key does not belong to this project' } }, 403);
    }
    // Set userId to empty string so downstream handlers don't crash
    c.set('userId' as keyof Variables, '' as never);
    await next();
    return;
  }
  // Fall back to Supabase JWT auth
  await jwtAuth(c as never, next);
}

export function registerQaCoverageRoutes(app: Hono<{ Variables: Variables }>): void {

  // ── helper ────────────────────────────────────────────────────────────────
  // When authenticated via API key, userId is '' and projectId is already validated
  // by the middleware above. When authenticated via JWT, userId is a real UUID and
  // we check project ownership the normal way.
  async function resolveProject(db: ReturnType<typeof getServiceClient>, userId: string, projectId: string, contextProjectId?: string) {
    // API key path: middleware already validated project ownership
    if (!userId && contextProjectId === projectId) return projectId;
    if (!userId && contextProjectId && contextProjectId !== projectId) return null;
    if (!userId) return null;
    // JWT path: check via ownership table
    const ids = await ownedProjectIds(db, userId);
    if (!ids.includes(projectId)) return null;
    return projectId;
  }

  // GET /v1/admin/projects/:pid/qa-coverage/stats — posture banner + QA SNAPSHOT.
  app.get('/v1/admin/projects/:pid/qa-coverage/stats', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const pid = c.req.param('pid')!;
    const db = getServiceClient();
    if (!(await resolveProject(db, userId, pid))) {
      return c.json({ ok: true, data: {
        hasAnyProject: false,
        projectId: null,
        projectName: null,
        totalStories: 0,
        enabledStories: 0,
        disabledStories: 0,
        passingStories: 0,
        failingStories: 0,
        noDataStories: 0,
        avgPassRatePct: null,
        totalRuns24h: 0,
        pendingRuns: 0,
        lastRunAt: null,
        topFailingStoryId: null,
        topFailingStoryName: null,
        topFailingPassRatePct: null,
        topPriority: 'no_project',
        topPriorityLabel: null,
        topPriorityTo: null,
      } });
    }

    const { data: project } = await db
      .from('projects')
      .select('id, project_name')
      .eq('id', pid)
      .maybeSingle();

    const [storiesRes, mvRes, pendingRes, lastRunRes] = await Promise.all([
      db.from('qa_stories').select('id, name, enabled').eq('project_id', pid),
      db.from('qa_story_coverage_24h').select('*').eq('project_id', pid),
      db
        .from('qa_story_runs')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', pid)
        .in('status', ['pending', 'running']),
      db
        .from('qa_story_runs')
        .select('started_at')
        .eq('project_id', pid)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const stories = storiesRes.data ?? [];
    const mvRows = mvRes.data ?? [];
    const mvMap = new Map(mvRows.map((r: Record<string, unknown>) => [r.story_id as string, r]));

    let totalRuns24h = 0;
    let passingStories = 0;
    let failingStories = 0;
    let noDataStories = 0;
    const passRates: number[] = [];
    let topFailing: { id: string; name: string; rate: number } | null = null;

    for (const s of stories) {
      const m = mvMap.get(s.id) as Record<string, unknown> | undefined;
      const runs24h = Number(m?.runs_24h ?? 0);
      const passRate = m?.pass_rate_pct != null ? Number(m.pass_rate_pct) : null;
      totalRuns24h += runs24h;

      if (runs24h === 0) {
        noDataStories += 1;
      } else if (passRate != null && passRate >= 80) {
        passingStories += 1;
        passRates.push(passRate);
      } else if (passRate != null && passRate < 80) {
        failingStories += 1;
        passRates.push(passRate);
        if (!topFailing || passRate < topFailing.rate) {
          topFailing = { id: s.id as string, name: s.name as string, rate: passRate };
        }
      }
    }

    const enabledStories = stories.filter((s) => s.enabled).length;
    const disabledStories = stories.length - enabledStories;
    const avgPassRatePct =
      passRates.length > 0
        ? Math.round((passRates.reduce((a, b) => a + b, 0) / passRates.length) * 10) / 10
        : null;
    const pendingRuns = pendingRes.count ?? 0;
    const lastRunAt = lastRunRes.data?.started_at ?? null;

    const scoped = (path: string) =>
      `${path}${path.includes('?') ? '&' : '?'}project=${encodeURIComponent(pid)}`;

    let topPriority: 'no_stories' | 'failing' | 'pending' | 'no_runs' | 'disabled_all' | 'healthy' = 'healthy';
    let topPriorityLabel: string | null = null;
    let topPriorityTo: string | null = null;

    if (stories.length === 0) {
      topPriority = 'no_stories';
      topPriorityLabel = 'No automated tests yet — write a user-flow check that runs on a schedule.';
      topPriorityTo = scoped('/qa-coverage?tab=overview');
    } else if (failingStories > 0) {
      topPriority = 'failing';
      topPriorityLabel = `${failingStories} test${failingStories === 1 ? '' : 's'} below 80% pass rate in the last 24h${topFailing ? ` — worst: ${topFailing.name} (${topFailing.rate}%)` : ''}.`;
      topPriorityTo = topFailing
        ? scoped(`/qa-coverage?tab=failing&highlight=${topFailing.id}`)
        : scoped('/qa-coverage?tab=failing');
    } else if (pendingRuns > 0) {
      topPriority = 'pending';
      topPriorityLabel = `${pendingRuns} run${pendingRuns === 1 ? '' : 's'} in progress — open a story to watch screenshots and logs.`;
      topPriorityTo = scoped('/qa-coverage?tab=stories');
    } else if (enabledStories === 0) {
      // Check disabled_all BEFORE no_runs: if all stories are disabled, "Run now"
      // is impossible — surfacing no_runs would give an unactionable instruction.
      topPriority = 'disabled_all';
      topPriorityLabel = 'All tests are turned off — re-enable at least one story to resume scheduled checks.';
      topPriorityTo = scoped('/qa-coverage?tab=stories');
    } else if (totalRuns24h === 0) {
      topPriority = 'no_runs';
      topPriorityLabel = `${stories.length} ${stories.length === 1 ? 'story' : 'stories'} configured but nothing ran in 24h — click Run now on a story.`;
      topPriorityTo = scoped('/qa-coverage?tab=stories');
    } else {
      topPriority = 'healthy';
      topPriorityLabel = `${passingStories}/${stories.length} stories passing · ${totalRuns24h} runs in 24h · avg ${avgPassRatePct ?? 100}% pass rate.`;
      topPriorityTo = scoped('/qa-coverage?tab=stories');
    }

    return c.json({
      ok: true,
      data: {
        hasAnyProject: true,
        projectId: pid,
        projectName: project?.project_name ?? null,
        totalStories: stories.length,
        enabledStories,
        disabledStories,
        passingStories,
        failingStories,
        noDataStories,
        avgPassRatePct,
        totalRuns24h,
        pendingRuns,
        lastRunAt,
        topFailingStoryId: topFailing?.id ?? null,
        topFailingStoryName: topFailing?.name ?? null,
        topFailingPassRatePct: topFailing?.rate ?? null,
        topPriority,
        topPriorityLabel,
        topPriorityTo,
      },
    });
  });

  // ── List stories + 24h coverage stats ────────────────────────────────────
  app.get('/v1/admin/projects/:pid/qa-coverage', jwtOrApiKey, async (c) => {
    const userId = c.get('userId') as string;
    const pid = c.req.param('pid')!;
    const contextPid = c.get('projectId' as keyof Variables) as string | undefined;
    const db = getServiceClient();
    if (!(await resolveProject(db, userId, pid, contextPid))) return c.json({ error: 'Not found' }, 404);

    // Left-join stories against MV to get live 24h stats
    const { data, error } = await db.rpc('get_qa_coverage', { p_project_id: pid });
    if (error) {
      // Fallback: direct query when the RPC doesn't exist yet
      const { data: stories, error: e2 } = await db
        .from('qa_stories')
        // Include live status columns so the card reflects a manual run
        // immediately — the MV (qa_story_coverage_24h) only refreshes every
        // 15 min, so without these the "Passing/Failing" badge and the
        // timestamp can lag by up to 15 min after a run completes.
        .select('id, project_id, name, enabled, browser_provider, last_run_status, updated_at, script')
        .eq('project_id', pid)
        .order('created_at');
      if (e2) return dbError(c, e2);
      // Attempt to get coverage from MV
      const { data: mv } = await db
        .from('qa_story_coverage_24h')
        .select('*')
        .eq('project_id', pid);
      const mvMap = new Map((mv ?? []).map((r: Record<string, unknown>) => [r.story_id as string, r]));
      const coverage = (stories ?? []).map((s) => {
        const m = mvMap.get(s.id) as Record<string, unknown> | undefined;
        // Prefer live qa_stories.updated_at as the timestamp when
        // last_run_status is set — it reflects the most recent run write
        // without waiting for the MV refresh cycle.
        const liveAt = (s as Record<string, unknown>).updated_at as string | null ?? null
        const mvAt = m?.last_run_at as string | null ?? null
        // Use the more recent of live vs MV timestamps
        const last_run_at = liveAt && mvAt
          ? (liveAt > mvAt ? liveAt : mvAt)
          : liveAt ?? mvAt

        // Detect directFetch mode from script for content-only metadata
        let is_direct_fetch = false
        const script = (s as Record<string, unknown>).script as string | null ?? null
        if (script && !script.startsWith('http')) {
          try {
            const parsed = JSON.parse(script) as Record<string, unknown>
            is_direct_fetch = parsed.directFetch === true
          } catch { /* ignore */ }
        }

        return {
          story_id: s.id,
          project_id: s.project_id,
          name: s.name,
          enabled: s.enabled,
          browser_provider: s.browser_provider,
          // Live status from qa_stories (updated immediately after each run)
          last_run_status: (s as Record<string, unknown>).last_run_status as string | null ?? null,
          // Content-only flag for UI evidence label
          is_direct_fetch,
          runs_24h: Number(m?.runs_24h ?? 0),
          passed_24h: Number(m?.passed_24h ?? 0),
          failed_24h: Number(m?.failed_24h ?? 0),
          error_24h: Number(m?.error_24h ?? 0),
          pass_rate_pct: m?.pass_rate_pct != null ? Number(m.pass_rate_pct) : null,
          last_run_at,
          last_failure_url: m?.last_failure_url ?? null,
        };
      });
      return c.json({ ok: true, data: { coverage } });
    }
    return c.json({ ok: true, data: { coverage: data ?? [] } });
  });

  // ── Dashboard tile summary ────────────────────────────────────────────────
  app.get('/v1/admin/projects/:pid/qa-coverage-summary', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const pid = c.req.param('pid')!;
    const db = getServiceClient();
    if (!(await resolveProject(db, userId, pid))) return c.json({ error: 'Not found' }, 404);

    const { data: mv } = await db
      .from('qa_story_coverage_24h')
      .select('story_id, name, pass_rate_pct')
      .eq('project_id', pid)
      .order('pass_rate_pct', { ascending: true });

    const rows = mv ?? [];
    const total = rows.length;
    const passing = rows.filter((r) => (r.pass_rate_pct ?? 0) >= 80).length;
    const failing = rows.filter((r) => r.pass_rate_pct != null && r.pass_rate_pct < 80).length;
    const error_count = 0; // MV doesn't separate error from fail at summary level
    const top_failing = rows
      .filter((r) => r.pass_rate_pct != null && r.pass_rate_pct < 80)
      .slice(0, 3)
      .map((r) => ({ story_id: r.story_id, name: r.name, pass_rate_pct: r.pass_rate_pct }));

    return c.json({ ok: true, data: { total, passing, failing, error: error_count, top_failing } });
  });

  // ── Get single story ──────────────────────────────────────────────────────
  app.get('/v1/admin/projects/:pid/qa-stories/:sid', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const pid = c.req.param('pid')!;
    const sid = c.req.param('sid')!;
    const db = getServiceClient();
    if (!(await resolveProject(db, userId, pid))) return c.json({ error: 'Not found' }, 404);

    const { data, error } = await db
      .from('qa_stories')
      .select('*')
      .eq('id', sid)
      .eq('project_id', pid)
      .single();
    if (error || !data) return c.json({ error: 'Not found' }, 404);
    return c.json({ ok: true, data });
  });

  // ── Create story ──────────────────────────────────────────────────────────
  app.post('/v1/admin/projects/:pid/qa-stories', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const pid = c.req.param('pid')!;
    const db = getServiceClient();
    if (!(await resolveProject(db, userId, pid))) return c.json({ error: 'Not found' }, 404);

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return jsonError(c, 'BAD_JSON', 'Invalid JSON body', 400);
    }
    const parsed = qaStoryCreateSchema.safeParse(raw);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return jsonError(
        c,
        'VALIDATION_ERROR',
        first ? `${first.path.join('.')}: ${first.message}` : 'Invalid story payload',
        400,
        {
          fieldErrors: Object.fromEntries(
            parsed.error.issues.map((i) => [i.path.join('.') || '_', i.message]),
          ),
        },
      );
    }
    const body = parsed.data;

    const { data, error } = await db
      .from('qa_stories')
      .insert({
        project_id: pid,
        name: body.name,
        prompt: body.prompt ?? null,
        script: body.script ?? null,
        script_lang: 'playwright-js',
        browser_provider: body.browser_provider ?? 'firecrawl_actions',
        schedule_cron: body.schedule_cron ?? '0 * * * *',
        byok_provider: body.byok_provider ?? null,
        enabled: true,
      })
      .select()
      .single();
    if (error) return dbError(c, error);
    return c.json({ ok: true, data }, 201);
  });

  // ── Update story ──────────────────────────────────────────────────────────
  app.patch('/v1/admin/projects/:pid/qa-stories/:sid', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const pid = c.req.param('pid')!;
    const sid = c.req.param('sid')!;
    const db = getServiceClient();
    if (!(await resolveProject(db, userId, pid))) return c.json({ error: 'Not found' }, 404);

    let body: {
      name?: string;
      prompt?: string;
      script?: string;
      schedule_cron?: string;
      enabled?: boolean;
      browser_provider?: string;
      byok_provider?: string;
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'invalid_json_body' }, 400);
    }

    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.prompt !== undefined) patch.prompt = body.prompt;
    if (body.script !== undefined) patch.script = body.script;
    if (body.schedule_cron !== undefined) patch.schedule_cron = body.schedule_cron;
    if (body.enabled !== undefined) patch.enabled = body.enabled;
    if (body.browser_provider !== undefined) patch.browser_provider = body.browser_provider;
    if (body.byok_provider !== undefined) patch.byok_provider = body.byok_provider;

    if (Object.keys(patch).length === 0) return c.json({ error: 'Nothing to update' }, 400);

    const { data, error } = await db
      .from('qa_stories')
      .update(patch)
      .eq('id', sid)
      .eq('project_id', pid)
      .select()
      .single();
    if (error) return dbError(c, error);
    return c.json({ ok: true, data });
  });

  // ── Delete story ──────────────────────────────────────────────────────────
  app.delete('/v1/admin/projects/:pid/qa-stories/:sid', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const pid = c.req.param('pid')!;
    const sid = c.req.param('sid')!;
    const db = getServiceClient();
    if (!(await resolveProject(db, userId, pid))) return c.json({ error: 'Not found' }, 404);

    const { error } = await db
      .from('qa_stories')
      .delete()
      .eq('id', sid)
      .eq('project_id', pid);
    if (error) return dbError(c, error);
    return c.body(null, 204);
  });

  // ── List runs for a story ─────────────────────────────────────────────────
  app.get('/v1/admin/projects/:pid/qa-stories/:sid/runs', jwtOrApiKey, async (c) => {
    const userId = c.get('userId') as string;
    const pid = c.req.param('pid')!;
    const sid = c.req.param('sid')!;
    const uuidErr = assertUuid(c, sid, 'story_id') ?? assertUuid(c, pid, 'project_id');
    if (uuidErr) return uuidErr;
    const limit = Math.min(Number(c.req.query('limit')) || 20, 50);
    const contextPid = c.get('projectId' as keyof Variables) as string | undefined;
    const db = getServiceClient();
    if (!(await resolveProject(db, userId, pid, contextPid))) return c.json({ error: 'Not found' }, 404);

    const { data, error } = await db
      .from('qa_story_runs')
      .select('id, story_id, status, latency_ms, started_at, finished_at, provider, provider_session_url, summary, assertion_failures, error_message, triggered_by, created_at')
      .eq('story_id', sid)
      .eq('project_id', pid)
      .order('started_at', { ascending: false })
      .limit(limit);
    if (error) return dbError(c, error);
    return c.json({ ok: true, data: { runs: data ?? [] } });
  });

  // ── Evidence for a single run (with signed Storage URLs for image/video) ──
  app.get('/v1/admin/projects/:pid/qa-stories/:sid/runs/:rid/evidence', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const pid = c.req.param('pid')!;
    const rid = c.req.param('rid')!;
    const db = getServiceClient();
    if (!(await resolveProject(db, userId, pid))) return c.json({ error: 'Not found' }, 404);

    // Verify the run belongs to this project
    const { data: run, error: runErr } = await db
      .from('qa_story_runs')
      .select('id, project_id')
      .eq('id', rid)
      .eq('project_id', pid)
      .single();
    if (runErr || !run) return c.json({ error: 'Run not found' }, 404);

    const { data: evidence, error: evErr } = await db
      .from('qa_story_evidence')
      .select('id, kind, storage_path, mime, step_label, captured_at')
      .eq('run_id', rid)
      .order('captured_at', { ascending: true });
    if (evErr) return dbError(c, evErr);

    // Generate 1-hour signed URLs for binary artefacts (screenshot, video, har, trace).
    // Console/network/dom are usually stored as text and surfaced via storage_path directly.
    const SIGNED_KINDS = new Set(['screenshot', 'video', 'trace', 'har']);
    const withUrls = await Promise.all(
      (evidence ?? []).map(async (ev) => {
        let signed_url: string | null = null;
        if (SIGNED_KINDS.has(ev.kind)) {
          // storage_path is stored as "qa-evidence/{pid}/{runId}/{filename}" (includes bucket prefix).
          // Strip the leading bucket segment so createSignedUrl gets the intra-bucket path.
          const inBucketPath = ev.storage_path.replace(/^qa-evidence\//, '');
          const { data: urlData } = await db.storage
            .from('qa-evidence')
            .createSignedUrl(inBucketPath, 3600);
          signed_url = urlData?.signedUrl ?? null;
        }
        return { ...ev, signed_url };
      }),
    );

    return c.json({ ok: true, data: { evidence: withUrls } });
  });

  // ── Manual run trigger ────────────────────────────────────────────────────
  app.post('/v1/admin/projects/:pid/qa-stories/:sid/run', jwtOrApiKey, async (c) => {
    const userId = c.get('userId') as string;
    const pid = c.req.param('pid')!;
    const sid = c.req.param('sid')!;
    const uuidErr = assertUuid(c, sid, 'story_id') ?? assertUuid(c, pid, 'project_id');
    if (uuidErr) return uuidErr;
    const contextPid = c.get('projectId' as keyof Variables) as string | undefined;
    const db = getServiceClient();
    if (!(await resolveProject(db, userId, pid, contextPid))) return c.json({ error: 'Not found' }, 404);

    // Verify story exists, belongs to project, and is enabled
    const { data: story, error: storyErr } = await db
      .from('qa_stories')
      .select('id, browser_provider, script, prompt, enabled')
      .eq('id', sid)
      .eq('project_id', pid)
      .single();
    if (storyErr || !story) return c.json({ error: 'Story not found' }, 404);
    if (!story.enabled) return c.json({ error: 'Story is disabled' }, 409);

    // Insert a pending run record — the qa-story-runner edge fn picks it up
    const { data: run, error: runErr } = await db
      .from('qa_story_runs')
      .insert({
        story_id: sid,
        project_id: pid,
        status: 'pending',
        provider: story.browser_provider,
        triggered_by: 'manual',
      })
      .select('id')
      .single();
    if (runErr) return dbError(c, runErr);

    // Fire-and-forget: invoke the runner function for immediate execution
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (supabaseUrl && serviceKey) {
      fetch(`${supabaseUrl}/functions/v1/qa-story-runner`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({ trigger: 'manual', story_id: sid, run_id: run.id }),
      }).catch(() => {/* fire and forget */});
    }

    return c.json({ ok: true, data: { run_id: run.id, queued: true } }, 202);
  });

  // ── Platform health rollup (for PlatformHealthTile) ───────────────────────
  app.get('/v1/admin/projects/:pid/platform-rollup', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const pid = c.req.param('pid')!;
    const db = getServiceClient();
    if (!(await resolveProject(db, userId, pid))) return c.json({ error: 'Not found' }, 404);

    const { data, error } = await db
      .from('qa_platform_rollup_24h')
      .select('*')
      .eq('project_id', pid)
      .order('reports_24h', { ascending: false });
    if (error) return dbError(c, error);
    return c.json({ ok: true, data: { platforms: data ?? [] } });
  });
}
