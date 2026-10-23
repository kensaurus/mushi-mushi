/**
 * FILE: packages/server/supabase/functions/api/routes/search-rank.ts
 * PURPOSE: Search rank check settings and results, served by `api-ext`
 *          (deploy size limit; `api` forwards these paths).
 *
 *   GET  /v1/admin/projects/:id/search-ranks      keywords, last rank, recent history, default target
 *   PUT  /v1/admin/projects/:id/search-ranks      { keywords: "one per line, optional @JP", target? }
 *   POST /v1/admin/projects/:id/search-ranks/run  check this app's keywords now (3 an hour)
 *
 * Saving keeps the history of keywords that stay; a removed keyword and its
 * history go. The worker is `search-rank` (daily, weekly per keyword).
 */

import type { Context, Hono } from 'npm:hono@4';
import type { Variables } from '../types.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { jwtAuth } from '../../_shared/auth.ts';
import { log } from '../../_shared/logger.ts';
import { runInBackground } from '../../_shared/background.ts';
import { resolveFirecrawl } from '../../_shared/firecrawl.ts';
import { parseKeywordLines } from '../../_shared/search-rank.ts';
import { dbError, parseUuidParam, userCanAccessProject } from '../shared.ts';
import { denyViewerWrite } from '../viewer-gate.ts';

const slog = log.child('search-rank-routes');

type Ctx = Context<{ Variables: Variables }>;
type Db = ReturnType<typeof getServiceClient>;

const RUNS_PER_HOUR = 3;
const HISTORY_POINTS = 8;

async function access(c: Ctx, db: Db, write: boolean): Promise<{ projectId: string } | { response: Response }> {
  const parsed = parseUuidParam(c);
  if (!parsed.ok) return { response: parsed.error };
  const projectId = parsed.value;
  const { allowed, role } = await userCanAccessProject(db, c.get('userId') as string, projectId);
  if (!allowed) return { response: c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404) };
  if (write) {
    const denied = denyViewerWrite(c, role, 'change the search rank check');
    if (denied) return { response: denied };
  }
  return { projectId };
}

const bad = (c: Ctx, code: string, message: string, status = 400) => c.json({ ok: false, error: { code, message } }, status as 400);

/** The host (and path) of the app's live site, from its watch or audit. */
async function defaultTarget(db: Db, projectId: string): Promise<string | null> {
  const [w, a] = await Promise.all([
    db.from('site_watches').select('base_url').eq('project_id', projectId).maybeSingle(),
    db.from('site_audits').select('base_url').eq('project_id', projectId).maybeSingle(),
  ]);
  const url = (w.data?.base_url as string | undefined) ?? (a.data?.base_url as string | undefined) ?? null;
  return url ? url.replace(/^https?:\/\//, '').replace(/\/$/, '') : null;
}

export function registerSearchRankRoutes(app: Hono<{ Variables: Variables }>): void {
  app.get('/v1/admin/projects/:id/search-ranks', jwtAuth, async (c) => {
    const db = getServiceClient();
    const a = await access(c, db, false);
    if ('response' in a) return a.response;
    const [kwRes, target, fc] = await Promise.all([
      db.from('search_rank_keywords').select('id, query, country, target, last_rank, last_top, last_checked_at, last_error').eq('project_id', a.projectId).order('created_at', { ascending: true }),
      defaultTarget(db, a.projectId),
      resolveFirecrawl(db, a.projectId),
    ]);
    if (kwRes.error) return dbError(c, kwRes.error);
    const keywords = (kwRes.data ?? []) as Array<{ id: string }>;
    let history: Array<{ keyword_id: string; checked_at: string; rank: number | null }> = [];
    if (keywords.length) {
      const { data, error } = await db
        .from('search_rank_history')
        .select('keyword_id, checked_at, rank')
        .in('keyword_id', keywords.map((k) => k.id))
        .order('checked_at', { ascending: false })
        .limit(keywords.length * HISTORY_POINTS);
      if (error) return dbError(c, error);
      history = (data ?? []) as typeof history;
    }
    return c.json({
      ok: true,
      data: {
        keywords: keywords.map((k) => ({
          ...k,
          history: history.filter((h) => h.keyword_id === k.id).slice(0, HISTORY_POINTS).map((h) => ({ at: h.checked_at, rank: h.rank })),
        })),
        target,
        firecrawlReady: Boolean(fc),
      },
    });
  });

  app.put('/v1/admin/projects/:id/search-ranks', jwtAuth, async (c) => {
    const db = getServiceClient();
    const a = await access(c, db, true);
    if ('response' in a) return a.response;
    const body = (await c.req.json().catch(() => ({}))) as { keywords?: unknown; target?: unknown };
    if (typeof body.keywords !== 'string') return bad(c, 'VALIDATION_ERROR', 'keywords must be text, one per line.');
    const parsed = parseKeywordLines(body.keywords);
    if (!parsed.ok) return bad(c, 'VALIDATION_ERROR', parsed.message);
    const target =
      typeof body.target === 'string' && body.target.trim()
        ? body.target.trim().replace(/^https?:\/\//, '').replace(/\/$/, '')
        : await defaultTarget(db, a.projectId);
    if (parsed.keywords.length && !target) return bad(c, 'NO_TARGET', 'Watch or audit the live site first, or give the address to look for.');
    if (target && !/^[a-z0-9.-]+\.[a-z]{2,}(\/[\w./-]*)?$/i.test(target)) return bad(c, 'VALIDATION_ERROR', 'The address must look like example.com or example.com/app.');

    const { data: existing, error: readErr } = await db.from('search_rank_keywords').select('id, query, country').eq('project_id', a.projectId);
    if (readErr) return dbError(c, readErr);
    const key = (q: string, country: string) => `${q.toLowerCase()}@${country}`;
    const wanted = new Map(parsed.keywords.map((k) => [key(k.query, k.country), k]));
    const rows = (existing ?? []) as Array<{ id: string; query: string; country: string }>;
    const remove = rows.filter((r) => !wanted.has(key(r.query, r.country))).map((r) => r.id);
    const keep = new Set(rows.filter((r) => wanted.has(key(r.query, r.country))).map((r) => key(r.query, r.country)));
    if (remove.length) {
      const { error } = await db.from('search_rank_keywords').delete().in('id', remove);
      if (error) return dbError(c, error);
    }
    const add = parsed.keywords.filter((k) => !keep.has(key(k.query, k.country)));
    if (add.length) {
      const { error } = await db.from('search_rank_keywords').insert(add.map((k) => ({ project_id: a.projectId, query: k.query, country: k.country, target })));
      if (error) return dbError(c, error);
    }
    if (target && keep.size) {
      const { error } = await db.from('search_rank_keywords').update({ target }).eq('project_id', a.projectId);
      if (error) return dbError(c, error);
    }
    return c.json({ ok: true, data: { keywords: parsed.keywords.length, added: add.length, removed: remove.length } });
  });

  app.post('/v1/admin/projects/:id/search-ranks/run', jwtAuth, async (c) => {
    const db = getServiceClient();
    const a = await access(c, db, true);
    if ('response' in a) return a.response;
    if (!(await resolveFirecrawl(db, a.projectId))) {
      return c.json({ ok: false, error: { code: 'FIRECRAWL_NOT_CONFIGURED', message: 'Add a Firecrawl key in Settings → Web tools first.' } }, 412);
    }
    const { error: rateErr } = await db.rpc('scoped_rate_limit_claim', {
      p_user_id: a.projectId,
      p_scope: 'search_rank_run',
      p_max_per_window: RUNS_PER_HOUR,
      p_window: '1 hour',
    });
    if (rateErr) {
      const limited = (rateErr.message ?? '').includes('rate_limit_exceeded');
      return bad(c, limited ? 'RATE_LIMITED' : 'RATE_LIMIT_UNAVAILABLE', limited ? `Checked ${RUNS_PER_HOUR} times in the last hour already.` : 'Not started. Retry in a moment.', limited ? 429 : 503);
    }
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (supabaseUrl && serviceKey) {
      runInBackground(
        fetch(`${supabaseUrl}/functions/v1/search-rank`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({ projectId: a.projectId }),
        })
          .then(() => undefined)
          .catch((err) => slog.warn('search-rank trigger failed', { err: String(err).slice(0, 200) })),
        'search-rank-run',
      );
    }
    return c.json({ ok: true, data: { running: true } });
  });
}
