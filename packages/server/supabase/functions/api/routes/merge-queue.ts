/**
 * FILE: packages/server/supabase/functions/api/routes/merge-queue.ts
 * PURPOSE: "Merge when ready" (ADR 0041), served by `api-ext` (deploy size
 *          limit; `api` forwards these paths).
 *
 *   POST   /v1/admin/merge-queue        { fixIds: string[] } queue fixes' PRs to merge when they can
 *   GET    /v1/admin/merge-queue        ?projectId= the queue (active rows, and merges of the last 24 h)
 *   DELETE /v1/admin/merge-queue/:id    take a PR out of the queue
 *
 * The worker is `merge-queue` (cron every 5 minutes, and right after a
 * queue). It merges only what the review gate lets a service caller merge:
 * an Opus "merge" verdict on the exact head, CI green (ADR 0030, 0035).
 */

import type { Context, Hono } from 'npm:hono@4';
import type { Variables } from '../types.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { jwtAuth } from '../../_shared/auth.ts';
import { log } from '../../_shared/logger.ts';
import { logAudit } from '../../_shared/audit.ts';
import { runInBackground } from '../../_shared/background.ts';
import { parsePrRepoRef } from '../../_shared/fix-merge.ts';
import { dbError, enumerateAccessibleProjectIds, userCanAccessProject } from '../shared.ts';
import { denyViewerWrite } from '../viewer-gate.ts';

const qlog = log.child('merge-queue-routes');

type Ctx = Context<{ Variables: Variables }>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PER_REQUEST = 200;
const ROW_COLUMNS =
  'id, fix_attempt_id, project_id, repo, pr_number, state, detail, head_sha, queued_at, updated_at, merged_at, conflict_agents';

function runSoon(projectId: string): void {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return;
  runInBackground(
    fetch(`${supabaseUrl}/functions/v1/merge-queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ projectId }),
    })
      .then(() => undefined)
      .catch((err) => qlog.warn('merge-queue trigger failed', { err: String(err).slice(0, 200) })),
    'merge-queue-run',
  );
}

export function registerMergeQueueRoutes(app: Hono<{ Variables: Variables }>): void {
  app.post('/v1/admin/merge-queue', jwtAuth, async (c: Ctx) => {
    const userId = c.get('userId') as string;
    const body = (await c.req.json().catch(() => ({}))) as { fixIds?: unknown };
    const fixIds = Array.isArray(body.fixIds) ? [...new Set(body.fixIds.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)))] : [];
    if (fixIds.length === 0 || fixIds.length > MAX_PER_REQUEST) {
      return c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: `Send 1 to ${MAX_PER_REQUEST} fix ids.` } }, 400);
    }
    const db = getServiceClient();
    const { data: attempts, error } = await db
      .from('fix_attempts')
      .select('id, project_id, pr_url, pr_number, merged_at, pr_state')
      .in('id', fixIds);
    if (error) return dbError(c, error);

    const roles = new Map<string, string | null>();
    const skipped: Array<{ fixId: string; reason: string }> = [];
    const rows: Array<Record<string, unknown>> = [];
    for (const id of fixIds) {
      const a = (attempts ?? []).find((x) => x.id === id) as
        | { id: string; project_id: string; pr_url: string | null; pr_number: number | null; merged_at: string | null; pr_state: string | null }
        | undefined;
      if (!a) {
        skipped.push({ fixId: id, reason: 'Fix not found.' });
        continue;
      }
      if (!roles.has(a.project_id)) {
        const access = await userCanAccessProject(db, userId, a.project_id);
        roles.set(a.project_id, access.allowed ? access.role ?? 'member' : null);
      }
      const role = roles.get(a.project_id);
      if (!role) {
        skipped.push({ fixId: id, reason: 'Not a member of this app.' });
        continue;
      }
      if (role === 'viewer') {
        skipped.push({ fixId: id, reason: 'Viewers cannot merge.' });
        continue;
      }
      if (a.merged_at || a.pr_state === 'merged') {
        skipped.push({ fixId: id, reason: 'Already merged.' });
        continue;
      }
      const ref = parsePrRepoRef(a.pr_url);
      if (!ref || !a.pr_number) {
        skipped.push({ fixId: id, reason: 'No pull request.' });
        continue;
      }
      rows.push({
        fix_attempt_id: a.id,
        project_id: a.project_id,
        repo: `${ref.owner}/${ref.repo}`.toLowerCase(),
        pr_number: a.pr_number,
        state: 'queued',
        detail: null,
        queued_by: userId,
        queued_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        cursor_agent_id: null,
        claimed_until: null,
      });
    }
    if (rows.length > 0) {
      // Re-queueing a row that was blocked or taken out starts it again; its
      // conflict-agent count stays (the cap is per PR).
      const { error: upErr } = await db.from('fix_merge_queue').upsert(rows, { onConflict: 'fix_attempt_id' });
      if (upErr) return dbError(c, upErr);
      const projects = [...new Set(rows.map((r) => r.project_id as string))];
      for (const p of projects) {
        await logAudit(db, p, userId, 'settings.updated', 'fix_merge_queue', undefined, { queued: rows.filter((r) => r.project_id === p).length }).catch(() => {});
        runSoon(p);
      }
    }
    return c.json({ ok: true, data: { queued: rows.length, skipped } });
  });

  app.get('/v1/admin/merge-queue', jwtAuth, async (c: Ctx) => {
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
    if (projectIds.length === 0) return c.json({ ok: true, data: { rows: [] } });
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { data, error } = await db
      .from('fix_merge_queue')
      .select(ROW_COLUMNS)
      .in('project_id', projectIds)
      .or(`state.in.(queued,waiting,resolving,blocked),updated_at.gte.${since}`)
      .order('queued_at', { ascending: true })
      .limit(500);
    if (error) return dbError(c, error);
    return c.json({ ok: true, data: { rows: data ?? [] } });
  });

  app.delete('/v1/admin/merge-queue/:id', jwtAuth, async (c: Ctx) => {
    const userId = c.get('userId') as string;
    const id = c.req.param('id') ?? '';
    if (!UUID_RE.test(id)) return c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Not a queue id.' } }, 400);
    const db = getServiceClient();
    const { data: row, error } = await db.from('fix_merge_queue').select('id, project_id, state').eq('id', id).maybeSingle();
    if (error) return dbError(c, error);
    if (!row) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Not in the queue.' } }, 404);
    const access = await userCanAccessProject(db, userId, row.project_id);
    if (!access.allowed) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Not in the queue.' } }, 404);
    const denied = denyViewerWrite(c, access.role, 'change the merge queue');
    if (denied) return denied;
    if (row.state === 'merged') return c.json({ ok: false, error: { code: 'ALREADY_MERGED', message: 'This pull request is already merged.' } }, 409);
    const { error: upErr } = await db
      .from('fix_merge_queue')
      .update({ state: 'removed', detail: 'Taken out of the queue.', updated_at: new Date().toISOString(), claimed_until: null })
      .eq('id', id);
    if (upErr) return dbError(c, upErr);
    return c.json({ ok: true, data: { id, state: 'removed' } });
  });
}
