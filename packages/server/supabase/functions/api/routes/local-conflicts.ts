/**
 * FILE: packages/server/supabase/functions/api/routes/local-conflicts.ts
 * PURPOSE: `mushi work --conflicts` (served by api-ext; `api` forwards these
 *          paths). Lists merge-queue conflicts no cloud agent is working,
 *          locks one for this CLI, and records the push or the refusal.
 *
 *   GET  /v1/admin/projects/:id/local-conflicts
 *   POST /v1/admin/merge-queue/:id/local-conflict
 *   POST /v1/admin/merge-queue/:id/local-conflict/done
 *
 * The lock is `cursor_agent_id = local:<token>` (local-conflict-run.ts), the
 * same cap of 2 as a cloud or daemon conflict agent. A push re-queues the
 * Opus review of the new head.
 */

import type { Context, Hono } from 'npm:hono@4';
import type { Variables } from '../types.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { adminOrApiKey } from '../../_shared/auth.ts';
import { log } from '../../_shared/logger.ts';
import { requeueReviewForNewHead } from '../../_shared/fix-review-db.ts';
import { dbError } from '../shared.ts';
import { callerCanAccessProject } from '../shared.ts';
import {
  localConflictAgentId,
  localConflictClaimPatch,
  localConflictClaimRefusal,
  localConflictDonePatch,
  type LocalConflictDone,
} from '../../_shared/local-conflict-run.ts';
import type { ConflictQueueRow } from '../../_shared/work-modes.ts';

const clog = log.child('local-conflicts');
type Ctx = Context<{ Variables: Variables }>;
type Db = ReturnType<typeof getServiceClient>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OUTCOMES = new Set(['pushed', 'refused', 'skipped', 'timeout', 'stopped', 'failed']);
const QUEUE_COLUMNS = 'id, project_id, fix_attempt_id, repo, pr_number, state, detail, head_sha, conflict_agents, cursor_agent_id, local_claim_id, claimed_until, queued_at';

async function access(c: Ctx, db: Db, projectId: string, write: boolean) {
  const userId = c.get('userId') as string;
  const row = await callerCanAccessProject(c, db, userId, projectId);
  if (!row.allowed) return { response: c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found.' } }, 404) };
  if (write && row.role === 'viewer') return { response: c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Viewers cannot resolve merge conflicts.' } }, 403) };
  return { role: row.role };
}

async function queueEvent(db: Db, row: { fix_attempt_id: string; project_id: string; repo: string; pr_number: number }, status: 'ok' | 'fail' | 'pending', label: string, detail: string, dedupe: string): Promise<void> {
  const { error } = await db.from('fix_events').insert({
    fix_attempt_id: row.fix_attempt_id,
    project_id: row.project_id,
    kind: 'merge_queue',
    status,
    label,
    detail: detail.slice(0, 500),
    at: new Date().toISOString(),
    dedupe_key: dedupe,
    payload: { repo: row.repo, pr: row.pr_number, local: true },
  });
  if (error && (error as { code?: string }).code !== '23505') clog.warn('merge-queue event not written', { err: error.message });
}

export function registerLocalConflictRoutes(app: Hono<{ Variables: Variables }>): void {
  app.get('/v1/admin/projects/:id/local-conflicts', adminOrApiKey({ scope: ['mcp:read', 'worker:run'] }), async (c: Ctx) => {
    const projectId = c.req.param('id') ?? '';
    if (!UUID_RE.test(projectId)) return c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'project id is not a uuid.' } }, 400);
    const db = getServiceClient();
    const allowed = await access(c, db, projectId, false);
    if ('response' in allowed) return allowed.response;
    const { data, error } = await db.from('fix_merge_queue').select(QUEUE_COLUMNS).eq('project_id', projectId).in('state', ['resolving', 'blocked']).order('queued_at', { ascending: true }).limit(50);
    if (error) return dbError(c, error);
    const rows = (data ?? []) as Array<ConflictQueueRow & { fix_attempt_id: string }>;
    if (rows.length === 0) return c.json({ ok: true, data: { conflicts: [] } });
    const { data: attempts, error: attErr } = await db.from('fix_attempts').select('id, branch, pr_url').in('id', rows.map((r) => r.fix_attempt_id));
    if (attErr) return dbError(c, attErr);
    const byId = new Map(((attempts ?? []) as Array<{ id: string; branch: string | null; pr_url: string | null }>).map((a) => [a.id, a]));
    const conflicts = [];
    for (const row of rows) {
      const attempt = byId.get(row.fix_attempt_id);
      if (localConflictClaimRefusal(row, attempt?.branch ?? null)) continue;
      conflicts.push({
        queueId: row.id,
        repo: row.repo,
        prNumber: row.pr_number,
        headRef: attempt!.branch,
        headSha: row.head_sha,
        prUrl: attempt?.pr_url ?? null,
        fixAttemptId: row.fix_attempt_id,
      });
    }
    return c.json({ ok: true, data: { conflicts } });
  });

  app.post('/v1/admin/merge-queue/:id/local-conflict', adminOrApiKey({ scope: ['mcp:write', 'worker:run'] }), async (c: Ctx) => {
    const id = c.req.param('id') ?? '';
    if (!UUID_RE.test(id)) return c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'queue id is not a uuid.' } }, 400);
    const db = getServiceClient();
    const { data, error } = await db.from('fix_merge_queue').select(QUEUE_COLUMNS).eq('id', id).maybeSingle();
    if (error) return dbError(c, error);
    const row = data as (ConflictQueueRow & { fix_attempt_id: string }) | null;
    if (!row) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Not in the merge queue.' } }, 404);
    const allowed = await access(c, db, row.project_id, true);
    if ('response' in allowed) return allowed.response;
    const { data: attempt, error: attErr } = await db.from('fix_attempts').select('id, branch, pr_url, report_id').eq('id', row.fix_attempt_id).maybeSingle();
    if (attErr) return dbError(c, attErr);
    const att = attempt as { id: string; branch: string | null; pr_url: string | null; report_id: string | null } | null;
    const refusal = localConflictClaimRefusal(row, att?.branch ?? null);
    if (refusal) return c.json({ ok: false, error: { code: 'CONFLICT_NOT_WAITING', message: refusal } }, 409);
    const token = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const patch = localConflictClaimPatch(row, token, nowIso);
    const { data: taken, error: upErr } = await db
      .from('fix_merge_queue')
      .update(patch)
      .eq('id', row.id)
      .eq('conflict_agents', row.conflict_agents ?? 0)
      .eq('head_sha', row.head_sha!)
      .is('cursor_agent_id', null)
      .is('local_claim_id', null)
      .in('state', ['resolving', 'blocked'])
      .select('id');
    if (upErr) return dbError(c, upErr);
    if (!taken || (taken as unknown[]).length === 0) {
      return c.json({ ok: false, error: { code: 'CONFLICT_TAKEN', message: 'Another agent took this conflict first.' } }, 409);
    }
    await queueEvent(db, row, 'pending', 'Merge queue: conflict sent to mushi work --conflicts', 'A local `mushi work --conflicts` run is merging the base branch into this pull request.', `mq-local-cli:${row.id}:${token}`);
    return c.json({
      ok: true,
      data: {
        token,
        queueId: row.id,
        repo: row.repo,
        prNumber: row.pr_number,
        headRef: att!.branch,
        headSha: row.head_sha,
        prUrl: att?.pr_url ?? null,
        fixAttemptId: row.fix_attempt_id,
      },
    });
  });

  app.post('/v1/admin/merge-queue/:id/local-conflict/done', adminOrApiKey({ scope: ['mcp:write', 'worker:run'] }), async (c: Ctx) => {
    const id = c.req.param('id') ?? '';
    if (!UUID_RE.test(id)) return c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'queue id is not a uuid.' } }, 400);
    const body = (await c.req.json().catch(() => ({}))) as { token?: unknown; result?: unknown; headAfter?: unknown; detail?: unknown; failureKind?: unknown };
    const token = typeof body.token === 'string' ? body.token : '';
    if (!UUID_RE.test(token)) return c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'token is not a uuid.' } }, 400);
    const outcome = typeof body.result === 'string' ? body.result : '';
    if (!OUTCOMES.has(outcome)) return c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'result is not a conflict outcome.' } }, 400);
    const failureKind = body.failureKind === 'infra' || body.failureKind === 'code' ? body.failureKind : null;
    const headAfter = typeof body.headAfter === 'string' && /^[0-9a-f]{40}$/i.test(body.headAfter) ? body.headAfter.toLowerCase() : null;
    const detail = typeof body.detail === 'string' ? body.detail.replace(/\s+/g, ' ').trim().slice(0, 240) : null;
    const db = getServiceClient();
    const { data, error } = await db.from('fix_merge_queue').select(QUEUE_COLUMNS).eq('id', id).maybeSingle();
    if (error) return dbError(c, error);
    const row = data as (ConflictQueueRow & { fix_attempt_id: string }) | null;
    if (!row) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Not in the merge queue.' } }, 404);
    const allowed = await access(c, db, row.project_id, true);
    if ('response' in allowed) return allowed.response;
    const run: LocalConflictDone = { outcome, failureKind, detail, headAfter };
    if (row.cursor_agent_id !== localConflictAgentId(token) || row.state !== 'resolving') {
      if (outcome === 'pushed' && headAfter && row.head_sha === headAfter && (row.state === 'waiting' || row.state === 'queued')) {
        return c.json({ ok: true, data: { state: row.state, already: true } });
      }
      return c.json({ ok: false, error: { code: 'CONFLICT_NOT_HELD', message: 'This run no longer holds the conflict.' } }, 409);
    }
    const { patch, requeue } = localConflictDonePatch(row, run);
    const nowIso = new Date().toISOString();
    const { data: moved, error: upErr } = await db
      .from('fix_merge_queue')
      .update({ ...patch, updated_at: nowIso, claimed_until: null })
      .eq('id', row.id)
      .eq('cursor_agent_id', localConflictAgentId(token))
      .eq('state', 'resolving')
      .select('id');
    if (upErr) return dbError(c, upErr);
    if (!moved || (moved as unknown[]).length === 0) {
      return c.json({ ok: false, error: { code: 'CONFLICT_NOT_HELD', message: 'This run no longer holds the conflict.' } }, 409);
    }
    if (requeue && headAfter) {
      await queueEvent(db, row, 'ok', 'Conflict resolved by mushi work --conflicts', `New head ${headAfter.slice(0, 7)}; the queue continues.`, `mq-resolved:${row.id}:${headAfter}`);
      const { data: att } = await db.from('fix_attempts').select('id, project_id, report_id, pr_url').eq('id', row.fix_attempt_id).maybeSingle();
      const a = att as { id: string; project_id: string; report_id: string | null; pr_url: string | null } | null;
      if (a) {
        const r = await requeueReviewForNewHead(db, { fixAttemptId: a.id, projectId: a.project_id, reportId: a.report_id, prUrl: a.pr_url }, headAfter, new Date());
        if (r === 'error') clog.warn('review not re-queued after mushi work --conflicts', { rowId: row.id });
      }
    } else {
      await queueEvent(db, row, 'fail', 'Merge queue: mushi work --conflicts did not resolve it', String(patch.detail ?? ''), `mq-local-cli-end:${token}`);
    }
    return c.json({ ok: true, data: { state: patch.state } });
  });
}
