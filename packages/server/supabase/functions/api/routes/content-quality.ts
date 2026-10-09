/**
 * content-quality.ts — Routes for the Content Quality Debug Station.
 *
 * Public (SDK/source-project):
 *   POST /v1/content-quality          — Ingest a quality issue (X-Mushi-Api-Key auth)
 *   POST /v1/content-quality/callback — Receive regen status callback from source project
 *
 * Admin (JWT):
 *   GET  /v1/admin/content-quality             — List issues (project-scoped)
 *   GET  /v1/admin/content-quality/:id         — Get single issue
 *   POST /v1/admin/content-quality/:id/regen   — Trigger regeneration
 *   POST /v1/admin/content-quality/:id/resolve — Resolve / dismiss / reopen (status: open)
 *   POST /v1/admin/projects/:pid/content-quality/dismiss — Bulk dismiss by ids or filter
 */

import type { Context, Hono } from 'npm:hono@4';
import type { Variables } from '../types.ts';
import { z } from 'npm:zod@3';
import { getServiceClient } from '../../_shared/db.ts';
import { log } from '../../_shared/logger.ts';
import { apiKeyAuth, jwtAuth, timingSafeEqual } from '../../_shared/auth.ts';
import { checkIngestQuota } from '../../_shared/quota.ts';
import { dereferenceMaybeVault } from '../../_shared/settings-secrets.ts';
import { logAudit } from '../../_shared/audit.ts';
import {
  BULK_DISMISS_MAX_IDS,
  BULK_DISMISS_MAX_ROWS,
  bulkDismissBodySchema,
  contentQualityFilterOps,
  isRegenStale,
  regenCallbackOutcome,
  materiallyNewSignals,
  rowFilterFromSearchParams,
  type FilterOp,
} from '../../_shared/content-quality-filter.ts';
import { dbError, resolveOwnedProject, callerCanAccessProject } from '../shared.ts';
import { denyViewerWrite } from '../viewer-gate.ts';

const cqlog = log.child('content-quality');

/** Ids per PostgREST request: 100 UUIDs keep the URL near 4 KB. */
const ID_CHUNK = 100;

interface Filterable {
  eq(column: string, value: unknown): Filterable;
  is(column: string, value: null): Filterable;
  lt(column: string, value: unknown): Filterable;
  gte(column: string, value: unknown): Filterable;
}

/** Apply the shared filter ops to a PostgREST builder (list, count, update). */
function applyFilterOps<Q>(query: Q, ops: FilterOp[]): Q {
  let q = query as unknown as Filterable;
  for (const o of ops) {
    if (o.op === 'eq') q = q.eq(o.column, o.value);
    else if (o.op === 'is_null') q = q.is(o.column, null);
    else if (o.op === 'lt') q = q.lt(o.column, o.value);
    else q = q.gte(o.column, o.value);
  }
  return q as unknown as Q;
}

export interface ContentQualityStats {
  hasAnyProject: boolean;
  projectId: string | null;
  projectName: string | null;
  openCount: number;
  inReviewCount: number;
  regeneratingCount: number;
  userFlagOpenCount: number;
  failedRegenCount: number;
  needsAttentionCount: number;
  topPriority:
    | 'no_project'
    | 'regen_failed'
    | 'user_flags'
    | 'open_issues'
    | 'regenerating'
    | 'healthy';
}

/**
 * Load a content_quality_issue by id and verify the JWT caller can access
 * its project. Returns 404 (not 403) on both missing and unauthorized so a
 * caller can't enumerate other tenants' issue ids by status code. Without
 * this, the service client (which bypasses RLS) would let any authenticated
 * user read/regen/resolve any project's issue by guessing a UUID (IDOR).
 */
async function loadAccessibleIssue(
  c: Context<{ Variables: Variables }>,
  db: ReturnType<typeof getServiceClient>,
  issueId: string,
): Promise<{ ok: true; issue: Record<string, unknown>; role: string | null } | { ok: false; response: Response }> {
  const notFound = () => c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  const { data: issue, error } = await db
    .from('content_quality_issues')
    .select('*')
    .eq('id', issueId)
    .maybeSingle();
  if (error || !issue) return { ok: false, response: notFound() };

  const userId = c.get('userId') as string;
  const access = await callerCanAccessProject(c, db, userId, issue.project_id as string);
  if (!access.allowed) return { ok: false, response: notFound() };

  return { ok: true, issue: issue as Record<string, unknown>, role: access.role };
}

// ── Zod schema ────────────────────────────────────────────────────────────────

export const contentQualityIssueSchema = z.object({
  project_id: z.string().uuid(),
  content_ref: z.string().min(1).max(500),
  content_type: z.string().min(1).max(100),
  content_key: z.string().max(500).default(''),
  reason: z.enum(['low_judge_score', 'user_flag', 'low_star_rating', 'high_downvote_ratio']),
  judge_score: z.number().min(0).max(1).nullable().optional(),
  avg_star: z.number().min(0).max(5).nullable().optional(),
  downvote_ratio: z.number().min(0).max(1).nullable().optional(),
  flag_count: z.number().int().min(0).optional().default(0),
  langfuse_trace_id: z.string().nullable().optional(),
  source_deeplink: z.string().url().nullable().optional(),
  feedback_summary: z.record(z.unknown()).nullable().optional(),
  source: z.string().max(100).optional(),
  source_description: z.string().max(5000).optional(),
});

export type ContentQualityIssuePayload = z.infer<typeof contentQualityIssueSchema>;

// ── HMAC helpers ──────────────────────────────────────────────────────────────

async function computeHmac(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `sha256=${hex}`;
}

async function signWebhook(secret: string, body: string): Promise<string> {
  return computeHmac(secret, body);
}

async function dispatchRegenWebhook(
  projectId: string,
  issueId: string,
  contentRef: string,
): Promise<{ ok: boolean; error?: string }> {
  const db = getServiceClient();

  const { data: settings } = await db
    .from('project_settings')
    .select('regen_webhook_url, regen_webhook_secret')
    .eq('project_id', projectId)
    .maybeSingle();

  // regen_webhook_url is a plain endpoint URL (not a credential); the secret
  // column holds a `vault://` ref.
  const webhookUrl = settings?.regen_webhook_url;
  const webhookSecret = await dereferenceMaybeVault(db, settings?.regen_webhook_secret ?? null);

  if (!webhookUrl || !webhookSecret) {
    return { ok: false, error: 'regen_webhook_url or regen_webhook_secret not configured for project' };
  }

  const payload = JSON.stringify({
    content_version_id: contentRef,
    issue_id: issueId,
  });

  const sig = await signWebhook(webhookSecret, payload);

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Mushi-Signature': sig,
      },
      body: payload,
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      cqlog.warn('regen_webhook_failed', { issueId, status: res.status, body: text.slice(0, 200) });
      return { ok: false, error: `Webhook returned ${res.status}` };
    }

    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    cqlog.warn('regen_webhook_error', { issueId, error: msg });
    return { ok: false, error: msg };
  }
}

// ── Route registration ────────────────────────────────────────────────────────

export function registerContentQualityRoutes(app: Hono<{ Variables: Variables }>): void {

  // ── POST /v1/content-quality — ingest from source project (API key auth) ──
  app.post('/v1/content-quality', apiKeyAuth, async (c) => {
    const db = getServiceClient();
    const projectId = c.get('projectId') as string;

    const quota = await checkIngestQuota(db, projectId);
    if (!quota.allowed) {
      return c.json({ error: 'Quota exceeded' }, 429);
    }

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400);
    }

    // Override project_id from auth context (don't trust payload)
    const parsed = contentQualityIssueSchema.safeParse({ ...(rawBody as object), project_id: projectId });
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 400);
    }

    const issue = parsed.data;
    const signals = () => ({
      judge_score: issue.judge_score ?? null,
      avg_star: issue.avg_star ?? null,
      downvote_ratio: issue.downvote_ratio ?? null,
      flag_count: issue.flag_count ?? 0,
      langfuse_trace_id: issue.langfuse_trace_id ?? null,
      source_deeplink: issue.source_deeplink ?? null,
      feedback_summary: issue.feedback_summary ?? null,
      source_description: issue.source_description ?? null,
      updated_at: new Date().toISOString(),
    });

    // Idempotent upsert on (project_id, content_ref, reason) WHERE status='open'
    const { data: existing } = await db
      .from('content_quality_issues')
      .select('id, status')
      .eq('project_id', projectId)
      .eq('content_ref', issue.content_ref)
      .eq('reason', issue.reason)
      .eq('status', 'open')
      .maybeSingle();

    if (existing) {
      // Update signals in case they changed
      await db.from('content_quality_issues').update(signals()).eq('id', existing.id);

      cqlog.info('issue_updated', { issueId: existing.id, projectId, reason: issue.reason });
      return c.json({ id: existing.id, created: false });
    }

    // No open row. A host re-sends the same items on every sync, so a row a
    // person dismissed or resolved must not come back as a new open row. Only
    // something materially worse than what they saw (new flags, new
    // downvotes, a clear score drop) reopens it.
    const { data: prior } = await db
      .from('content_quality_issues')
      .select('id, status, flag_count, judge_score, avg_star, feedback_summary')
      .eq('project_id', projectId)
      .eq('content_ref', issue.content_ref)
      .eq('reason', issue.reason)
      .neq('status', 'open')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (prior) {
      if (prior.status === 'in_review' || prior.status === 'regenerating') {
        // Someone is already working on it: refresh the signals, keep the status.
        await db.from('content_quality_issues').update(signals()).eq('id', prior.id);
        cqlog.info('issue_updated_in_progress', { issueId: prior.id, projectId, status: prior.status });
        return c.json({ id: prior.id, created: false, status: prior.status });
      }
      const changes = materiallyNewSignals(prior, {
        flag_count: issue.flag_count ?? 0,
        judge_score: issue.judge_score ?? null,
        avg_star: issue.avg_star ?? null,
        feedback_summary: issue.feedback_summary ?? null,
      });
      if (changes.length === 0) {
        // Leave the closed row untouched: its signals are the baseline the
        // next re-send is compared with.
        return c.json({ id: prior.id, created: false, status: prior.status });
      }
      const { error: reopenError } = await db
        .from('content_quality_issues')
        .update({ ...signals(), status: 'open' })
        .eq('id', prior.id);
      if (!reopenError) {
        cqlog.info('issue_reopened', { issueId: prior.id, projectId, reason: issue.reason, changes });
        return c.json({ id: prior.id, created: false, reopened: true });
      }
      // 23505: a concurrent ingest opened a row for this key first; the raced
      // path below updates that row instead.
      if (reopenError.code !== '23505') {
        cqlog.warn('reopen_failed', { issueId: prior.id, projectId, error: reopenError.message });
        return c.json({ error: 'Failed to reopen issue', detail: reopenError.message }, 500);
      }
    }

    const { data: newIssue, error } = await db
      .from('content_quality_issues')
      .insert({
        project_id: projectId,
        content_ref: issue.content_ref,
        content_type: issue.content_type,
        content_key: issue.content_key,
        reason: issue.reason,
        judge_score: issue.judge_score ?? null,
        avg_star: issue.avg_star ?? null,
        downvote_ratio: issue.downvote_ratio ?? null,
        flag_count: issue.flag_count ?? 0,
        langfuse_trace_id: issue.langfuse_trace_id ?? null,
        source_deeplink: issue.source_deeplink ?? null,
        feedback_summary: issue.feedback_summary ?? null,
        source: issue.source ?? null,
        source_description: issue.source_description ?? null,
        status: 'open',
      })
      .select('id')
      .single();

    if (error || !newIssue) {
      // Race: a concurrent ingest for the same (project_id, content_ref,
      // reason) WHERE status='open' won the partial unique index between our
      // SELECT and INSERT. Treat the 23505 as "already exists" and update the
      // winner's signals instead of surfacing a 500 to the SDK.
      if (error?.code === '23505') {
        const { data: raced } = await db
          .from('content_quality_issues')
          .select('id')
          .eq('project_id', projectId)
          .eq('content_ref', issue.content_ref)
          .eq('reason', issue.reason)
          .eq('status', 'open')
          .maybeSingle();
        if (raced) {
          await db.from('content_quality_issues').update(signals()).eq('id', raced.id);
          cqlog.info('issue_updated_after_race', { issueId: raced.id, projectId, reason: issue.reason });
          return c.json({ id: raced.id, created: false });
        }
      }
      cqlog.warn('insert_failed', { projectId, error: error?.message });
      return c.json({ error: 'Failed to create issue', detail: error?.message }, 500);
    }

    cqlog.info('issue_created', { issueId: newIssue.id, projectId, reason: issue.reason });
    return c.json({ id: newIssue.id, created: true }, 201);
  });

  // ── POST /v1/content-quality/callback — regen status callback ─────────────
  // Called by glot-content-quality-webhook after regeneration completes.
  app.post('/v1/content-quality/callback', async (c) => {
    const rawBody = await c.req.text();
    const sigHeader = c.req.header('X-Glotit-Signature') ?? '';

    let body: { issue_id: string; status: 'completed' | 'failed'; result: unknown };
    try {
      body = JSON.parse(rawBody);
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400);
    }

    const { issue_id, status, result } = body;
    if (!issue_id || !status) return c.json({ error: 'issue_id and status are required' }, 400);

    const db = getServiceClient();

    // Look up the issue to get the project's webhook secret for HMAC verify
    const { data: issue } = await db
      .from('content_quality_issues')
      .select('id, project_id')
      .eq('id', issue_id)
      .maybeSingle();

    if (!issue) return c.json({ error: 'Issue not found' }, 404);

    const { data: settings } = await db
      .from('project_settings')
      .select('regen_webhook_secret')
      .eq('project_id', issue.project_id)
      .maybeSingle();

    // Fail closed: a project with no configured secret cannot have dispatched
    // a regen (dispatchRegenWebhook also requires the secret), so an inbound
    // callback for it is necessarily forged. Reject rather than accepting an
    // unsigned status update that could mark issues resolved/failed and inject
    // arbitrary regen_result JSON.
    const secret = await dereferenceMaybeVault(db, settings?.regen_webhook_secret ?? null);
    if (!secret) {
      cqlog.warn('callback_no_secret', { issueId: issue_id });
      return c.json({ error: 'Webhook signing not configured for this project' }, 401);
    }
    const expected = await computeHmac(secret, rawBody);
    if (!timingSafeEqual(expected, sigHeader)) {
      cqlog.warn('callback_sig_rejected', { issueId: issue_id });
      return c.json({ error: 'Invalid signature' }, 401);
    }

    await db
      .from('content_quality_issues')
      .update({
        ...regenCallbackOutcome(status, result),
        regen_completed_at: new Date().toISOString(),
        regen_result: result as Record<string, unknown>,
        updated_at: new Date().toISOString(),
      })
      .eq('id', issue_id);

    cqlog.info('callback_processed', { issueId: issue_id, status });
    return c.json({ ok: true });
  });

  // ── GET /v1/admin/content-quality/stats — sidebar badge slice ─────────────
  app.get('/v1/admin/content-quality/stats', jwtAuth, async (c) => {
    const db = getServiceClient();
    const userId = c.get('userId') as string;

    const empty: ContentQualityStats = {
      hasAnyProject: false,
      projectId: null,
      projectName: null,
      openCount: 0,
      inReviewCount: 0,
      regeneratingCount: 0,
      userFlagOpenCount: 0,
      failedRegenCount: 0,
      needsAttentionCount: 0,
      topPriority: 'no_project',
    };

    const resolved = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () => c.json({ ok: true, data: empty }),
    });
    if ('response' in resolved) return resolved.response;
    const { project } = resolved;
    const projectId = project.id as string;
    const projectName = (project.name as string | null) ?? null;

    const [
      openRes,
      inReviewRes,
      regenStatusRes,
      userFlagRes,
      failedRegenRes,
    ] = await Promise.all([
      db
        .from('content_quality_issues')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .eq('status', 'open'),
      db
        .from('content_quality_issues')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .eq('status', 'in_review'),
      db
        .from('content_quality_issues')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .eq('status', 'regenerating'),
      db
        .from('content_quality_issues')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .eq('status', 'open')
        .eq('reason', 'user_flag'),
      db
        .from('content_quality_issues')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .eq('regen_status', 'failed')
        .in('status', ['open', 'in_review', 'regenerating']),
    ]);

    const openCount = openRes.count ?? 0;
    const inReviewCount = inReviewRes.count ?? 0;
    const regeneratingCount = regenStatusRes.count ?? 0;
    const userFlagOpenCount = userFlagRes.count ?? 0;
    const failedRegenCount = failedRegenRes.count ?? 0;

    const needsAttentionCount = openCount + inReviewCount;
    let topPriority: ContentQualityStats['topPriority'] = 'healthy';
    if (failedRegenCount > 0) topPriority = 'regen_failed';
    else if (userFlagOpenCount > 0) topPriority = 'user_flags';
    else if (needsAttentionCount > 0) topPriority = 'open_issues';
    else if (regeneratingCount > 0) topPriority = 'regenerating';

    const stats: ContentQualityStats = {
      hasAnyProject: true,
      projectId,
      projectName,
      openCount,
      inReviewCount,
      regeneratingCount,
      userFlagOpenCount,
      failedRegenCount,
      needsAttentionCount,
      topPriority,
    };

    return c.json({ ok: true, data: stats });
  });

  // ── GET /v1/admin/content-quality — list issues ────────────────────────────
  app.get('/v1/admin/content-quality', jwtAuth, async (c) => {
    const db = getServiceClient();
    const userId = c.get('userId') as string;

    const { searchParams } = new URL(c.req.url);
    const projectId = searchParams.get('project_id');
    const status = searchParams.get('status') ?? 'open';
    // Same filter as the bulk dismiss, so "dismiss all matching" is this list.
    const filterOps = contentQualityFilterOps(rowFilterFromSearchParams(searchParams));
    const page = Math.max(0, Number(searchParams.get('page') ?? '0'));
    const limit = Math.min(100, Number(searchParams.get('limit') ?? '50'));

    if (!projectId) return c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'project_id is required' } }, 400);

    // Same rule as every other content-quality route (owner, org member or
    // project member). The old owner-or-project_members check refused org
    // teammates while the sidebar badge still counted their open issues.
    const access = await callerCanAccessProject(c, db, userId, projectId);
    if (!access.allowed) {
      return c.json(
        { ok: false, error: { code: 'FORBIDDEN', message: 'You do not have access to this project. Pick another project in the header switcher.' } },
        403,
      );
    }

    let query = db
      .from('content_quality_issues')
      .select('*', { count: 'exact' })
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .range(page * limit, page * limit + limit - 1);

    if (status !== 'all') query = query.eq('status', status);
    query = applyFilterOps(query, filterOps);

    const { data: items, error, count } = await query;
    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500);

    return c.json({ ok: true, data: { items: items ?? [], total: count ?? 0, page, limit } });
  });

  // ── GET /v1/admin/content-quality/:id — single issue ──────────────────────
  app.get('/v1/admin/content-quality/:id', jwtAuth, async (c) => {
    const db = getServiceClient();
    const issueId = c.req.param('id');
    if (!issueId) return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Missing id' } }, 400);

    const loaded = await loadAccessibleIssue(c, db, issueId);
    if (!loaded.ok) return loaded.response;
    return c.json({ ok: true, data: loaded.issue });
  });

  // ── POST /v1/admin/content-quality/:id/regen — trigger regeneration ────────
  app.post('/v1/admin/content-quality/:id/regen', jwtAuth, async (c) => {
    const db = getServiceClient();
    const issueId = c.req.param('id');
    if (!issueId) return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Missing id' } }, 400);

    const loaded = await loadAccessibleIssue(c, db, issueId);
    if (!loaded.ok) return loaded.response;
    const viewerDenied = denyViewerWrite(c, loaded.role, 'regenerate content');
    if (viewerDenied) return viewerDenied;
    const issue = loaded.issue;
    // A regeneration whose callback never arrived stays "running" forever, so
    // one that started REGEN_STALE_MS ago can be requested again.
    if (
      (issue.regen_status === 'running' || issue.regen_status === 'queued') &&
      !isRegenStale(issue.regen_requested_at as string | null, Date.now())
    ) {
      return c.json({ ok: false, error: { code: 'CONFLICT', message: 'Regeneration already in progress' } }, 409);
    }

    // Mark as queued
    await db
      .from('content_quality_issues')
      .update({
        regen_status: 'queued',
        status: 'regenerating',
        regen_requested_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', issueId);

    // Dispatch HMAC-signed webhook to source project
    const result = await dispatchRegenWebhook(
      issue.project_id as string,
      issueId,
      issue.content_ref as string,
    );

    if (!result.ok) {
      // Roll back status on webhook failure
      await db
        .from('content_quality_issues')
        .update({ regen_status: 'failed', status: 'open', updated_at: new Date().toISOString() })
        .eq('id', issueId);

      return c.json({ ok: false, error: { code: 'WEBHOOK_ERROR', message: 'Failed to dispatch regeneration webhook', detail: result.error } }, 502);
    }

    // Update to running now that the webhook was accepted
    await db
      .from('content_quality_issues')
      .update({ regen_status: 'running', updated_at: new Date().toISOString() })
      .eq('id', issueId);

    cqlog.info('regen_dispatched', { issueId, projectId: issue.project_id });
    return c.json({ ok: true, regen_status: 'running' });
  });

  // ── POST /v1/admin/content-quality/:id/resolve — resolve or dismiss ────────
  app.post('/v1/admin/content-quality/:id/resolve', jwtAuth, async (c) => {
    const db = getServiceClient();
    const issueId = c.req.param('id');
    if (!issueId) return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Missing id' } }, 400);

    const loaded = await loadAccessibleIssue(c, db, issueId);
    if (!loaded.ok) return loaded.response;
    const viewerDenied = denyViewerWrite(c, loaded.role, 'resolve or dismiss content issues');
    if (viewerDenied) return viewerDenied;

    let body: { status: string } = { status: 'resolved' };
    try { body = await c.req.json(); } catch { /* use default */ }

    // `open` reopens a resolved or dismissed issue, so a mis-clicked Dismiss
    // can be taken back from the console.
    const newStatus = body.status === 'dismissed' ? 'dismissed' : body.status === 'open' ? 'open' : 'resolved';
    if (newStatus === 'open' && loaded.issue.status !== 'resolved' && loaded.issue.status !== 'dismissed') {
      return c.json({ ok: false, error: { code: 'CONFLICT', message: 'Only resolved or dismissed issues can be reopened.' } }, 409);
    }

    const { error } = await db
      .from('content_quality_issues')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', issueId);

    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500);
    return c.json({ ok: true, status: newStatus });
  });

  // ── POST /v1/admin/projects/:pid/content-quality/dismiss — bulk dismiss ────
  // A person's decision, so JWT only. Takes `ids` (≤ 500) or a `filter` (the
  // list page's filter), dismisses at most 10,000 rows per call, and refuses
  // with 409 when the live count differs from the count the person confirmed.
  // `dry_run: true` returns the count without writing.
  app.post('/v1/admin/projects/:pid/content-quality/dismiss', jwtAuth, async (c) => {
    const db = getServiceClient();
    const userId = c.get('userId') as string;
    const projectId = c.req.param('pid');
    if (!projectId) return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Missing project id' } }, 400);

    const access = await callerCanAccessProject(c, db, userId, projectId);
    if (!access.allowed) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    const viewerDenied = denyViewerWrite(c, access.role, 'dismiss content issues');
    if (viewerDenied) return viewerDenied;

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Body must be JSON.' } }, 400);
    }
    const parsed = bulkDismissBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid body', issues: parsed.error.issues } },
        400,
      );
    }
    const body = parsed.data;
    const table = () => db.from('content_quality_issues');
    const limits = { max_ids: BULK_DISMISS_MAX_IDS, max_rows: BULK_DISMISS_MAX_ROWS };

    // 1. Count what the request matches, scoped to this project and to rows
    //    that can still be dismissed.
    let matched = 0;
    const idChunks: string[][] = [];
    let filterOps: FilterOp[] = [];
    if (body.ids) {
      const ids = [...new Set(body.ids)];
      for (let i = 0; i < ids.length; i += ID_CHUNK) idChunks.push(ids.slice(i, i + ID_CHUNK));
      for (const chunk of idChunks) {
        const { count, error } = await table()
          .select('id', { count: 'exact', head: true })
          .eq('project_id', projectId)
          .in('status', ['open', 'in_review'])
          .in('id', chunk);
        if (error) return dbError(c, error);
        matched += count ?? 0;
      }
    } else if (body.filter) {
      filterOps = contentQualityFilterOps(body.filter);
      const { count, error } = await applyFilterOps(
        table().select('id', { count: 'exact', head: true }).eq('project_id', projectId).eq('status', body.filter.status),
        filterOps,
      );
      if (error) return dbError(c, error);
      matched = count ?? 0;
    }
    const willDismiss = Math.min(matched, BULK_DISMISS_MAX_ROWS);

    if (body.dry_run) {
      return c.json({ ok: true, data: { matched, will_dismiss: willDismiss, ...limits } });
    }
    if (body.expected_count != null && body.expected_count !== willDismiss) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'COUNT_CHANGED',
            message: `The selection now matches ${willDismiss} rows, not ${body.expected_count}. Check the number and confirm again.`,
          },
        },
        409,
      );
    }

    // 2. Dismiss.
    const now = new Date().toISOString();
    let dismissed = 0;
    if (willDismiss > 0 && body.ids) {
      for (const chunk of idChunks) {
        const { count, error } = await table()
          .update({ status: 'dismissed', updated_at: now }, { count: 'exact' })
          .eq('project_id', projectId)
          .in('status', ['open', 'in_review'])
          .in('id', chunk);
        if (error) return dbError(c, error);
        dismissed += count ?? 0;
      }
    } else if (willDismiss > 0 && body.filter) {
      // PostgREST updates have no LIMIT, so cap by id: the willDismiss-th row
      // in id order is the last one this call may touch. Ids are unique, so
      // the cut holds exactly willDismiss rows when it is read; the rest wait
      // for the next run.
      const { data: boundary, error: boundaryError } = await applyFilterOps(
        table().select('id').eq('project_id', projectId).eq('status', body.filter.status),
        filterOps,
      )
        .order('id', { ascending: true })
        .range(willDismiss - 1, willDismiss - 1)
        .maybeSingle();
      if (boundaryError) return dbError(c, boundaryError);
      if (boundary) {
        const { count, error } = await applyFilterOps(
          table()
            .update({ status: 'dismissed', updated_at: now }, { count: 'exact' })
            .eq('project_id', projectId)
            .eq('status', body.filter.status),
          filterOps,
        ).lte('id', boundary.id as string);
        if (error) return dbError(c, error);
        dismissed = count ?? 0;
      }
    }

    await logAudit(db, projectId, userId, 'content_quality.bulk_dismissed', 'content_quality_issue', undefined, {
      reason: body.reason,
      mode: body.ids ? 'ids' : 'filter',
      ...(body.ids ? { id_count: body.ids.length } : { filter: body.filter }),
      matched,
      dismissed,
    });
    cqlog.info('bulk_dismissed', { projectId, dismissed, matched });

    return c.json({ ok: true, data: { dismissed, matched, remaining: Math.max(0, matched - dismissed), ...limits } });
  });
}
