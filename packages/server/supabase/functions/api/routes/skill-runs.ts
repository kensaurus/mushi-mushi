/**
 * FILE: packages/server/supabase/functions/api/routes/skill-runs.ts
 * PURPOSE: Skill runs (ADR 0042), served by `api-ext` (deploy size limit;
 *          `api` forwards these paths).
 *
 *   GET  /v1/admin/skill-runs                      ?projectId= runs of the apps you can see, and the skills on offer
 *   POST /v1/admin/projects/:id/skill-runs         { skillSlug, scope, rounds?, autoMerge?, laneId? } start one
 *   POST /v1/admin/projects/:id/skill-runs/:runId/stop
 *
 * The worker is `skill-runs` (cron every 10 minutes, and right after a start).
 * Rounds are reports that spend-down sends to the app's own Cursor key, or,
 * with `laneId`, that wait in one of the caller's local worker lanes (a `fix`
 * or `skill` lane, ADR 0042 amendment) and never go to the cloud.
 */

import type { Context, Hono } from 'npm:hono@4';
import type { Variables } from '../types.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { jwtAuth } from '../../_shared/auth.ts';
import { log } from '../../_shared/logger.ts';
import { logAudit } from '../../_shared/audit.ts';
import { runInBackground } from '../../_shared/background.ts';
import { SKILL_RUN_MAX_ACTIVE_PER_APP, SKILL_RUN_MAX_ROUNDS, SKILL_RUN_SKILLS, skillRunSkill } from '../../_shared/skill-runs.ts';
import { dbError, enumerateAccessibleProjectIds, parseUuidParam, userCanAccessProject } from '../shared.ts';
import { denyViewerWrite } from '../viewer-gate.ts';
import { laneForQueue } from '../../_shared/work-claims.ts';

const slog = log.child('skill-runs-routes');

type Ctx = Context<{ Variables: Variables }>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMNS = 'id, project_id, skill_slug, scope, rounds_max, round, auto_merge, status, stop_reason, current_report_id, history, lane_id, created_at, updated_at';

function runSoon(runId: string): void {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return;
  runInBackground(
    fetch(`${supabaseUrl}/functions/v1/skill-runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ runId }),
    })
      .then(() => undefined)
      .catch((err) => slog.warn('skill-runs trigger failed', { err: String(err).slice(0, 200) })),
    'skill-runs-run',
  );
}

async function writable(c: Ctx, db: ReturnType<typeof getServiceClient>): Promise<{ projectId: string } | { response: Response }> {
  const parsed = parseUuidParam(c);
  if (!parsed.ok) return { response: parsed.error };
  const { allowed, role } = await userCanAccessProject(db, c.get('userId') as string, parsed.value);
  if (!allowed) return { response: c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404) };
  const denied = denyViewerWrite(c, role, 'start or stop skill runs');
  if (denied) return { response: denied };
  return { projectId: parsed.value };
}

export function registerSkillRunRoutes(app: Hono<{ Variables: Variables }>): void {
  app.get('/v1/admin/skill-runs', jwtAuth, async (c: Ctx) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const requested = c.req.query('projectId');
    let projectIds: string[];
    if (requested) {
      if (!UUID_RE.test(requested)) return c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'projectId is not a uuid.' } }, 400);
      const access = await userCanAccessProject(db, userId, requested);
      if (!access.allowed) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404);
      projectIds = [requested];
    } else {
      projectIds = await enumerateAccessibleProjectIds(c, db, userId);
    }
    const { data: catalog } = await db.from('agent_skills').select('slug').eq('is_active', true).in('slug', SKILL_RUN_SKILLS.map((s) => s.slug));
    const inCatalog = new Set(((catalog ?? []) as Array<{ slug: string }>).map((s) => s.slug));
    const skills = SKILL_RUN_SKILLS.map((s) => ({ ...s, inCatalog: inCatalog.has(s.slug) }));
    if (projectIds.length === 0) return c.json({ ok: true, data: { runs: [], skills } });
    const { data, error } = await db
      .from('skill_runs')
      .select(COLUMNS)
      .in('project_id', projectIds)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) return dbError(c, error);
    return c.json({ ok: true, data: { runs: data ?? [], skills } });
  });

  app.post('/v1/admin/projects/:id/skill-runs', jwtAuth, async (c: Ctx) => {
    const db = getServiceClient();
    const a = await writable(c, db);
    if ('response' in a) return a.response;
    const body = (await c.req.json().catch(() => ({}))) as { skillSlug?: unknown; scope?: unknown; rounds?: unknown; autoMerge?: unknown; laneId?: unknown };
    const skill = typeof body.skillSlug === 'string' ? skillRunSkill(body.skillSlug) : null;
    if (!skill) return c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Pick one of the skills on offer.' } }, 400);
    const scope = typeof body.scope === 'string' ? body.scope.trim().replace(/\s+/g, ' ') : '';
    if (scope.length < 3 || scope.length > 500) {
      return c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Say what to work on in 3 to 500 characters, e.g. "the /settings pages".' } }, 400);
    }
    const rounds = Number.isInteger(body.rounds) ? Math.min(SKILL_RUN_MAX_ROUNDS, Math.max(1, body.rounds as number)) : 3;
    // A local run (ADR 0042 amendment): one of the caller's own lanes for this app, in fix or skill mode.
    let laneId: string | null = null;
    if (body.laneId != null) {
      if (typeof body.laneId !== 'string' || !UUID_RE.test(body.laneId)) {
        return c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'laneId must be a lane id, or left out to run in the cloud.' } }, 400);
      }
      const found = await laneForQueue(db, body.laneId, { projectId: a.projectId, userId: c.get('userId') as string });
      if ('error' in found) return c.json({ ok: false, error: { code: 'LANE_NOT_FOUND', message: found.error } }, found.status);
      const { data: laneRow, error: laneErr } = await db.from('work_lanes').select('mode').eq('id', found.lane.id).maybeSingle();
      if (laneErr) return dbError(c, laneErr);
      const mode = (laneRow as { mode?: string } | null)?.mode;
      if (mode !== 'fix' && mode !== 'skill') {
        return c.json({ ok: false, error: { code: 'LANE_MODE', message: `That lane is in ${mode ?? 'another'} mode. Pick a lane that fixes reports or runs skills.` } }, 409);
      }
      laneId = found.lane.id;
    }
    const { count } = await db.from('skill_runs').select('id', { count: 'exact', head: true }).eq('project_id', a.projectId).eq('status', 'active');
    if ((count ?? 0) >= SKILL_RUN_MAX_ACTIVE_PER_APP) {
      return c.json({ ok: false, error: { code: 'TOO_MANY_RUNS', message: `This app already has ${SKILL_RUN_MAX_ACTIVE_PER_APP} skill runs going. Stop one or wait for one to finish.` } }, 409);
    }
    const { data, error } = await db
      .from('skill_runs')
      .insert({ project_id: a.projectId, skill_slug: skill.slug, scope, rounds_max: rounds, auto_merge: body.autoMerge !== false, created_by: c.get('userId') as string, lane_id: laneId })
      .select(COLUMNS)
      .maybeSingle();
    if (error || !data) return dbError(c, error ?? { message: 'not saved' });
    await logAudit(db, a.projectId, c.get('userId') as string, 'settings.updated', 'skill_run', (data as { id: string }).id, { skill: skill.slug, rounds, local: laneId !== null }).catch(() => {});
    runSoon((data as { id: string }).id);
    return c.json({ ok: true, data: { run: data } }, 201);
  });

  app.post('/v1/admin/projects/:id/skill-runs/:runId/stop', jwtAuth, async (c: Ctx) => {
    const db = getServiceClient();
    const a = await writable(c, db);
    if ('response' in a) return a.response;
    const runId = c.req.param('runId') ?? '';
    if (!UUID_RE.test(runId)) return c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Not a run id.' } }, 400);
    const { data, error } = await db
      .from('skill_runs')
      .update({ status: 'stopped', stop_reason: 'Stopped from the console.', updated_at: new Date().toISOString(), claimed_until: null })
      .eq('id', runId)
      .eq('project_id', a.projectId)
      .eq('status', 'active')
      .select('id');
    if (error) return dbError(c, error);
    if (!data || (data as unknown[]).length === 0) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'No running skill run with that id in this app.' } }, 404);
    return c.json({ ok: true, data: { id: runId, status: 'stopped' } });
  });
}
