/**
 * FILE: packages/server/supabase/functions/api/routes/site-audit.ts
 * PURPOSE: The site audit's settings and last run (ADR 0040), served by
 *          `api-ext` (deploy size limit; `api` forwards these paths).
 *
 *   GET  /v1/admin/projects/:id/site-audit       the audit, its open findings, and whether a key is ready
 *   PUT  /v1/admin/projects/:id/site-audit       { enabled, baseUrl?, pageLimit?, cadenceDays? }
 *   POST /v1/admin/projects/:id/site-audit/run   start a run now (3 an hour per app)
 *
 * Turning it on schedules the first run for the next tick; the worker is
 * `site-audit` (cron hourly at :29). Billed to the app's Firecrawl key.
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
import { dbError, parseUuidParam, userCanAccessProject } from '../shared.ts';
import { denyViewerWrite } from '../viewer-gate.ts';

const slog = log.child('site-audit-routes');

type Ctx = Context<{ Variables: Variables }>;
type Db = ReturnType<typeof getServiceClient>;

export const SITE_AUDIT_MAX_PAGES = 500;
const RUNS_PER_HOUR = 3;
const COLUMNS = 'id, enabled, base_url, page_limit, cadence_days, next_run_at, batch_id, batch_started_at, last_run_at, last_summary, last_error';

async function access(c: Ctx, db: Db, write: boolean): Promise<{ projectId: string } | { response: Response }> {
  const parsed = parseUuidParam(c);
  if (!parsed.ok) return { response: parsed.error };
  const projectId = parsed.value;
  const { allowed, role } = await userCanAccessProject(db, c.get('userId') as string, projectId);
  if (!allowed) return { response: c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404) };
  if (write) {
    const denied = denyViewerWrite(c, role, 'change the site audit');
    if (denied) return { response: denied };
  }
  return { projectId };
}

function runSoon(auditId: string): void {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return;
  runInBackground(
    fetch(`${supabaseUrl}/functions/v1/site-audit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ auditId }),
    })
      .then(() => undefined)
      .catch((err) => slog.warn('site-audit run trigger failed', { err: String(err).slice(0, 200) })),
    'site-audit-run',
  );
}

const bad = (c: Ctx, code: string, message: string, status = 400) => c.json({ ok: false, error: { code, message } }, status as 400);

export function registerSiteAuditRoutes(app: Hono<{ Variables: Variables }>): void {
  app.get('/v1/admin/projects/:id/site-audit', jwtAuth, async (c) => {
    const db = getServiceClient();
    const a = await access(c, db, false);
    if ('response' in a) return a.response;
    const [auditRes, watchRes, fc] = await Promise.all([
      db.from('site_audits').select(COLUMNS).eq('project_id', a.projectId).maybeSingle(),
      db.from('site_watches').select('base_url').eq('project_id', a.projectId).maybeSingle(),
      resolveFirecrawl(db, a.projectId),
    ]);
    if (auditRes.error) return dbError(c, auditRes.error);
    const audit = auditRes.data as { id: string } | null;
    let findings: unknown[] = [];
    if (audit) {
      const { data, error } = await db
        .from('site_audit_findings')
        .select('rule, pages, report_id, first_seen_at, last_seen_at')
        .eq('audit_id', audit.id)
        .is('resolved_at', null)
        .order('pages', { ascending: false });
      if (error) return dbError(c, error);
      findings = data ?? [];
    }
    return c.json({
      ok: true,
      data: {
        audit,
        findings,
        suggestedUrl: (watchRes.data?.base_url as string | undefined) ?? null,
        firecrawlReady: Boolean(fc),
      },
    });
  });

  app.put('/v1/admin/projects/:id/site-audit', jwtAuth, async (c) => {
    const db = getServiceClient();
    const a = await access(c, db, true);
    if ('response' in a) return a.response;
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body.enabled !== 'boolean') return bad(c, 'VALIDATION_ERROR', 'enabled must be true or false.');
    const { data: current, error: readErr } = await db.from('site_audits').select('id, base_url, enabled').eq('project_id', a.projectId).maybeSingle();
    if (readErr) return dbError(c, readErr);

    const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim().replace(/\/$/, '') : ((current?.base_url as string | undefined) ?? '');
    if (!/^https:\/\//i.test(baseUrl)) return bad(c, 'INVALID_URL', 'Enter the https:// address of your live site.');
    const safe = assertSafeOutboundUrl(baseUrl, {});
    if (!safe.ok) return bad(c, 'UNSAFE_URL', 'Use the public https:// address of your live site.');
    const patch: Record<string, unknown> = { enabled: body.enabled, base_url: baseUrl, updated_at: new Date().toISOString() };
    if (body.pageLimit !== undefined) {
      const n = body.pageLimit;
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > SITE_AUDIT_MAX_PAGES) {
        return bad(c, 'VALIDATION_ERROR', `Pages per audit must be between 1 and ${SITE_AUDIT_MAX_PAGES}.`);
      }
      patch.page_limit = n;
    }
    if (body.cadenceDays !== undefined) {
      const n = body.cadenceDays;
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 30) return bad(c, 'VALIDATION_ERROR', 'Run every 1 to 30 days.');
      patch.cadence_days = n;
    }
    if (body.enabled) {
      if (!(await resolveFirecrawl(db, a.projectId))) {
        return c.json({ ok: false, error: { code: 'FIRECRAWL_NOT_CONFIGURED', message: 'Add a Firecrawl key in Settings → Web tools first. A key shared with all your apps works too.' } }, 412);
      }
      // Off → on: the first run starts on the next tick.
      if (!current?.enabled) patch.next_run_at = new Date().toISOString();
    }
    const { data, error } = current
      ? await db.from('site_audits').update(patch).eq('id', current.id as string).select(COLUMNS).single()
      : await db.from('site_audits').insert({ ...patch, project_id: a.projectId, created_by: c.get('userId') }).select(COLUMNS).single();
    if (error) return dbError(c, error);
    await logAudit(db, a.projectId, c.get('userId') as string, 'settings.updated', 'site_audit', (data as { id: string }).id, {
      enabled: body.enabled,
      baseUrl,
    }).catch(() => {});
    return c.json({ ok: true, data: { audit: data } });
  });

  app.post('/v1/admin/projects/:id/site-audit/run', jwtAuth, async (c) => {
    const db = getServiceClient();
    const a = await access(c, db, true);
    if ('response' in a) return a.response;
    const { data: audit, error } = await db.from('site_audits').select('id, enabled, batch_id').eq('project_id', a.projectId).maybeSingle();
    if (error) return dbError(c, error);
    if (!audit?.enabled) return bad(c, 'NOT_FOUND', 'Turn the site audit on first.', 404);
    if (audit.batch_id) return c.json({ ok: true, data: { running: true } });
    const { error: rateErr } = await db.rpc('scoped_rate_limit_claim', {
      p_user_id: a.projectId,
      p_scope: 'site_audit_run',
      p_max_per_window: RUNS_PER_HOUR,
      p_window: '1 hour',
    });
    if (rateErr) {
      const limited = (rateErr.message ?? '').includes('rate_limit_exceeded');
      return bad(
        c,
        limited ? 'RATE_LIMITED' : 'RATE_LIMIT_UNAVAILABLE',
        limited ? `This app's audit already ran ${RUNS_PER_HOUR} times in the last hour.` : 'The audit did not start. Retry in a moment.',
        limited ? 429 : 503,
      );
    }
    const { error: upErr } = await db.from('site_audits').update({ next_run_at: new Date().toISOString() }).eq('id', audit.id as string);
    if (upErr) return dbError(c, upErr);
    runSoon(audit.id as string);
    return c.json({ ok: true, data: { running: true } });
  });
}
