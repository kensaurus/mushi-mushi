/**
 * FILE: site-watch.ts (api routes)
 * PURPOSE: Live-site watch (ADR 0024). The console turns a Firecrawl
 *          monitor on or off for an app's live site, runs a check now, and
 *          reads the pages the watch found broken. The monitor runs and bills
 *          on the project's own Firecrawl key; site-watch-poll reads its
 *          results and files reports (_shared/site-watch.ts).
 *
 *   GET    /v1/admin/projects/:id/site-watch        watch, open problems, suggested URL
 *   PUT    /v1/admin/projects/:id/site-watch        { baseUrl, pageLimit } create or change
 *   POST   /v1/admin/projects/:id/site-watch/run    check now
 *   DELETE /v1/admin/projects/:id/site-watch        turn off (deletes the monitor)
 */

import type { Context, Hono } from 'npm:hono@4';
import type { Variables } from '../types.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { jwtAuth } from '../../_shared/auth.ts';
import { log } from '../../_shared/logger.ts';
import { logAudit } from '../../_shared/audit.ts';
import { runInBackground } from '../../_shared/background.ts';
import { resolveFirecrawl } from '../../_shared/firecrawl.ts';
import { assertSafeOutboundUrl } from '../../_shared/inventory-guards.ts';
import {
  createMonitor,
  DEFAULT_SCHEDULE_CRON,
  deleteMonitor,
  FirecrawlMonitorError,
  runMonitor,
  updateMonitor,
} from '../../_shared/site-watch.ts';
import { dbError, parseUuidParam, userCanAccessProject } from '../shared.ts';
import { denyViewerWrite } from '../viewer-gate.ts';

const slog = log.child('site-watch-routes');

type Ctx = Context<{ Variables: Variables }>;
type Db = ReturnType<typeof getServiceClient>;

/** Project access; for a change, viewers are refused. */
async function access(c: Ctx, db: Db, write: boolean): Promise<{ projectId: string } | { response: Response }> {
  const parsed = parseUuidParam(c);
  if (!parsed.ok) return { response: parsed.error };
  const projectId = parsed.value;
  const { allowed, role } = await userCanAccessProject(db, c.get('userId') as string, projectId);
  if (!allowed) return { response: c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404) };
  if (write) {
    const denied = denyViewerWrite(c, role, 'change the live-site watch');
    if (denied) return { response: denied };
  }
  return { projectId };
}

/** A Firecrawl failure as a response the console can explain. */
function firecrawlFailure(c: Ctx, err: unknown): Response {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg === 'FIRECRAWL_AUTH_FAILED') {
    return c.json({ ok: false, error: { code: 'FIRECRAWL_AUTH_FAILED', message: 'Firecrawl rejected the key. Check it in Settings → AI keys.' } }, 401);
  }
  if (msg === 'FIRECRAWL_NO_CREDITS') {
    return c.json({ ok: false, error: { code: 'FIRECRAWL_NO_CREDITS', message: 'The Firecrawl account is out of credits.' } }, 402);
  }
  if (msg === 'FIRECRAWL_RATE_LIMITED') {
    return c.json({ ok: false, error: { code: 'RATE_LIMITED', message: 'Firecrawl is rate-limiting this key. Retry in a minute.' } }, 429);
  }
  slog.warn('firecrawl monitor call failed', { err: msg.slice(0, 300) });
  return c.json({ ok: false, error: { code: 'FIRECRAWL_FAILED', message: 'Firecrawl did not accept the request. Retry in a moment.' } }, 502);
}

const NO_KEY = { ok: false, error: { code: 'FIRECRAWL_NOT_CONFIGURED', message: 'Add a Firecrawl key in Settings → AI keys first. A key shared with all your apps works too.' } };

/** Read the new check's results shortly after "Check now" instead of waiting for the hourly poll. */
function pollSoon(projectId: string): void {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return;
  runInBackground(
    (async () => {
      await new Promise((r) => setTimeout(r, 45_000));
      await fetch(`${supabaseUrl}/functions/v1/site-watch-poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ projectId }),
      });
    })(),
    'site-watch-poll-soon',
  );
}

export function registerSiteWatchRoutes(app: Hono<{ Variables: Variables }>): void {
  app.get('/v1/admin/projects/:id/site-watch', jwtAuth, async (c) => {
    const db = getServiceClient();
    const a = await access(c, db, false);
    if ('response' in a) return a.response;

    const [watchRes, pagesRes, settingsRes, mapRes, fc] = await Promise.all([
      db
        .from('site_watches')
        .select('id, base_url, page_limit, schedule_cron, status, last_checked_at, last_summary, last_error, estimated_credits_per_month, created_at')
        .eq('project_id', a.projectId)
        .maybeSingle(),
      db
        .from('site_watch_pages')
        .select('id, url, problem, status_code, detail, first_seen_at, last_seen_at, report_id')
        .eq('project_id', a.projectId)
        .is('resolved_at', null)
        .order('last_seen_at', { ascending: false })
        .limit(50),
      db.from('project_settings').select('crawler_base_url').eq('project_id', a.projectId).maybeSingle(),
      db
        .from('story_map_runs')
        .select('base_url')
        .eq('project_id', a.projectId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      resolveFirecrawl(db, a.projectId).catch(() => null),
    ]);
    if (watchRes.error) return dbError(c, watchRes.error);
    if (pagesRes.error) return dbError(c, pagesRes.error);

    return c.json({
      ok: true,
      data: {
        watch: watchRes.data ?? null,
        openPages: pagesRes.data ?? [],
        suggestedUrl:
          (settingsRes.data?.crawler_base_url as string | null | undefined) ??
          (mapRes.data?.base_url as string | null | undefined) ??
          null,
        firecrawlReady: Boolean(fc),
      },
    });
  });

  app.put('/v1/admin/projects/:id/site-watch', jwtAuth, async (c) => {
    const db = getServiceClient();
    const a = await access(c, db, true);
    if ('response' in a) return a.response;

    const body = (await c.req.json().catch(() => ({}))) as { baseUrl?: unknown; pageLimit?: unknown };
    const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';
    const pageLimit = typeof body.pageLimit === 'number' ? Math.floor(body.pageLimit) : 25;
    if (!/^https?:\/\//i.test(baseUrl)) {
      return c.json({ ok: false, error: { code: 'INVALID_URL', message: 'Enter the https:// address of your live site.' } }, 400);
    }
    const safe = assertSafeOutboundUrl(baseUrl, {});
    if (!safe.ok) {
      return c.json({ ok: false, error: { code: 'UNSAFE_URL', message: safe.reason ?? 'This address cannot be crawled.' } }, 400);
    }
    if (pageLimit < 1 || pageLimit > 100) {
      return c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Pages per check must be between 1 and 100.' } }, 400);
    }

    const fc = await resolveFirecrawl(db, a.projectId);
    if (!fc) return c.json(NO_KEY, 412);

    const { data: project } = await db.from('projects').select('name').eq('id', a.projectId).maybeSingle();
    const { data: existing, error: readErr } = await db
      .from('site_watches')
      .select('id, firecrawl_monitor_id, schedule_cron')
      .eq('project_id', a.projectId)
      .maybeSingle();
    if (readErr) return dbError(c, readErr);

    const spec = {
      name: `Mushi live-site watch: ${(project?.name as string | undefined) ?? a.projectId}`,
      baseUrl,
      pageLimit,
      scheduleCron: (existing?.schedule_cron as string | undefined) ?? DEFAULT_SCHEDULE_CRON,
    };
    let monitorId = (existing?.firecrawl_monitor_id as string | null | undefined) ?? null;
    let estimate: number | null = null;
    try {
      if (monitorId) {
        try {
          estimate = (await updateMonitor(fc.key, monitorId, { ...spec, status: 'active' })).estimatedCreditsPerMonth;
        } catch (err) {
          // The monitor was deleted on Firecrawl's side: make a new one.
          if (!(err instanceof FirecrawlMonitorError && err.status === 404)) throw err;
          monitorId = null;
        }
      }
      if (!monitorId) {
        const created = await createMonitor(fc.key, spec);
        monitorId = created.id;
        estimate = created.estimatedCreditsPerMonth;
      }
    } catch (err) {
      return firecrawlFailure(c, err);
    }

    const row = {
      project_id: a.projectId,
      base_url: baseUrl,
      page_limit: pageLimit,
      schedule_cron: spec.scheduleCron,
      firecrawl_monitor_id: monitorId,
      status: 'active',
      last_error: null,
      estimated_credits_per_month: estimate,
      updated_at: new Date().toISOString(),
    };
    const { error: writeErr } = existing
      ? await db.from('site_watches').update(row).eq('id', existing.id)
      : await db.from('site_watches').insert({ ...row, created_by: c.get('userId') as string });
    if (writeErr) return dbError(c, writeErr);

    await logAudit(db, a.projectId, c.get('userId') as string, 'settings.updated', 'site_watch', a.projectId, {
      baseUrl,
      pageLimit,
    }).catch(() => {});
    return c.json({ ok: true, data: { monitorId, estimatedCreditsPerMonth: estimate } });
  });

  app.post('/v1/admin/projects/:id/site-watch/run', jwtAuth, async (c) => {
    const db = getServiceClient();
    const a = await access(c, db, true);
    if ('response' in a) return a.response;

    const { data: watch, error } = await db
      .from('site_watches')
      .select('firecrawl_monitor_id, status')
      .eq('project_id', a.projectId)
      .maybeSingle();
    if (error) return dbError(c, error);
    if (!watch?.firecrawl_monitor_id) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Turn the watch on first.' } }, 404);
    }
    const fc = await resolveFirecrawl(db, a.projectId);
    if (!fc) return c.json(NO_KEY, 412);
    try {
      const { checkId } = await runMonitor(fc.key, watch.firecrawl_monitor_id as string);
      pollSoon(a.projectId);
      return c.json({ ok: true, data: { checkId } });
    } catch (err) {
      return firecrawlFailure(c, err);
    }
  });

  app.delete('/v1/admin/projects/:id/site-watch', jwtAuth, async (c) => {
    const db = getServiceClient();
    const a = await access(c, db, true);
    if ('response' in a) return a.response;

    const { data: watch, error } = await db
      .from('site_watches')
      .select('id, firecrawl_monitor_id')
      .eq('project_id', a.projectId)
      .maybeSingle();
    if (error) return dbError(c, error);
    if (!watch) return c.json({ ok: true, data: { deleted: false } });

    if (watch.firecrawl_monitor_id) {
      const fc = await resolveFirecrawl(db, a.projectId);
      // Without a key the monitor cannot be reached; it stops on its own when
      // the key's credits run out, and the row goes regardless.
      if (fc) {
        try {
          await deleteMonitor(fc.key, watch.firecrawl_monitor_id as string);
        } catch (err) {
          return firecrawlFailure(c, err);
        }
      }
    }
    const { error: delErr } = await db.from('site_watches').delete().eq('id', watch.id);
    if (delErr) return dbError(c, delErr);
    await logAudit(db, a.projectId, c.get('userId') as string, 'settings.updated', 'site_watch', a.projectId, {
      turnedOff: true,
    }).catch(() => {});
    return c.json({ ok: true, data: { deleted: true } });
  });
}
