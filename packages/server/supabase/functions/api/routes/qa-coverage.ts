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
import { jwtAuth } from '../../_shared/auth.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { dbError, ownedProjectIds } from '../shared.ts';

export function registerQaCoverageRoutes(app: Hono<{ Variables: Variables }>): void {

  // ── helper ────────────────────────────────────────────────────────────────
  async function resolveProject(db: ReturnType<typeof getServiceClient>, userId: string, projectId: string) {
    const ids = await ownedProjectIds(db, userId);
    if (!ids.includes(projectId)) return null;
    return projectId;
  }

  // ── List stories + 24h coverage stats ────────────────────────────────────
  app.get('/v1/admin/projects/:pid/qa-coverage', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const pid = c.req.param('pid');
    const db = getServiceClient();
    if (!(await resolveProject(db, userId, pid))) return c.json({ error: 'Not found' }, 404);

    // Left-join stories against MV to get live 24h stats
    const { data, error } = await db.rpc('get_qa_coverage', { p_project_id: pid });
    if (error) {
      // Fallback: direct query when the RPC doesn't exist yet
      const { data: stories, error: e2 } = await db
        .from('qa_stories')
        .select('id, project_id, name, enabled, browser_provider')
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
        return {
          story_id: s.id,
          project_id: s.project_id,
          name: s.name,
          enabled: s.enabled,
          browser_provider: s.browser_provider,
          runs_24h: Number(m?.runs_24h ?? 0),
          passed_24h: Number(m?.passed_24h ?? 0),
          failed_24h: Number(m?.failed_24h ?? 0),
          error_24h: Number(m?.error_24h ?? 0),
          pass_rate_pct: m?.pass_rate_pct != null ? Number(m.pass_rate_pct) : null,
          last_run_at: m?.last_run_at ?? null,
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
    const pid = c.req.param('pid');
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
    const pid = c.req.param('pid');
    const sid = c.req.param('sid');
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
    const pid = c.req.param('pid');
    const db = getServiceClient();
    if (!(await resolveProject(db, userId, pid))) return c.json({ error: 'Not found' }, 404);

    const body = await c.req.json<{
      name: string;
      prompt?: string;
      script?: string;
      browser_provider?: string;
      schedule_cron?: string;
      byok_provider?: string;
    }>();

    if (!body.name?.trim()) return c.json({ error: 'name is required' }, 400);

    const { data, error } = await db
      .from('qa_stories')
      .insert({
        project_id: pid,
        name: body.name.trim(),
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
    const pid = c.req.param('pid');
    const sid = c.req.param('sid');
    const db = getServiceClient();
    if (!(await resolveProject(db, userId, pid))) return c.json({ error: 'Not found' }, 404);

    const body = await c.req.json<{
      name?: string;
      prompt?: string;
      script?: string;
      schedule_cron?: string;
      enabled?: boolean;
      browser_provider?: string;
      byok_provider?: string;
    }>();

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
    const pid = c.req.param('pid');
    const sid = c.req.param('sid');
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
  app.get('/v1/admin/projects/:pid/qa-stories/:sid/runs', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const pid = c.req.param('pid');
    const sid = c.req.param('sid');
    const limit = Math.min(Number(c.req.query('limit')) || 20, 50);
    const db = getServiceClient();
    if (!(await resolveProject(db, userId, pid))) return c.json({ error: 'Not found' }, 404);

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
    const pid = c.req.param('pid');
    const rid = c.req.param('rid');
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
  app.post('/v1/admin/projects/:pid/qa-stories/:sid/run', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const pid = c.req.param('pid');
    const sid = c.req.param('sid');
    const db = getServiceClient();
    if (!(await resolveProject(db, userId, pid))) return c.json({ error: 'Not found' }, 404);

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
    const pid = c.req.param('pid');
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
