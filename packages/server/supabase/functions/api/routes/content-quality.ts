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
 *   POST /v1/admin/content-quality/:id/resolve — Resolve / dismiss
 */

import type { Context, Hono } from 'npm:hono@4';
import type { Variables } from '../types.ts';
import { z } from 'npm:zod@3';
import { getServiceClient } from '../../_shared/db.ts';
import { log } from '../../_shared/logger.ts';
import { apiKeyAuth, jwtAuth, timingSafeEqual } from '../../_shared/auth.ts';
import { checkIngestQuota } from '../../_shared/quota.ts';
import { dbError, userCanAccessProject, resolveOwnedProject } from '../shared.ts';

const cqlog = log.child('content-quality');

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
): Promise<{ ok: true; issue: Record<string, unknown> } | { ok: false; response: Response }> {
  const notFound = () => c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  const { data: issue, error } = await db
    .from('content_quality_issues')
    .select('*')
    .eq('id', issueId)
    .maybeSingle();
  if (error || !issue) return { ok: false, response: notFound() };

  const userId = c.get('userId') as string;
  const access = await userCanAccessProject(db, userId, issue.project_id as string);
  if (!access.allowed) return { ok: false, response: notFound() };

  return { ok: true, issue: issue as Record<string, unknown> };
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

  const webhookUrl = settings?.regen_webhook_url;
  const webhookSecret = settings?.regen_webhook_secret;

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
      await db
        .from('content_quality_issues')
        .update({
          judge_score: issue.judge_score ?? null,
          avg_star: issue.avg_star ?? null,
          downvote_ratio: issue.downvote_ratio ?? null,
          flag_count: issue.flag_count ?? 0,
          langfuse_trace_id: issue.langfuse_trace_id ?? null,
          source_deeplink: issue.source_deeplink ?? null,
          feedback_summary: issue.feedback_summary ?? null,
          source_description: issue.source_description ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);

      cqlog.info('issue_updated', { issueId: existing.id, projectId, reason: issue.reason });
      return c.json({ id: existing.id, created: false });
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
          await db
            .from('content_quality_issues')
            .update({
              judge_score: issue.judge_score ?? null,
              avg_star: issue.avg_star ?? null,
              downvote_ratio: issue.downvote_ratio ?? null,
              flag_count: issue.flag_count ?? 0,
              langfuse_trace_id: issue.langfuse_trace_id ?? null,
              source_deeplink: issue.source_deeplink ?? null,
              feedback_summary: issue.feedback_summary ?? null,
              source_description: issue.source_description ?? null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', raced.id);
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
    const secret = settings?.regen_webhook_secret;
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
        regen_status: status === 'completed' ? 'completed' : 'failed',
        status: status === 'completed' ? 'resolved' : 'open',
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
    const projectName = (project.project_name as string | null) ?? null;

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
    const reason = searchParams.get('reason');
    const contentType = searchParams.get('content_type');
    const page = Math.max(0, Number(searchParams.get('page') ?? '0'));
    const limit = Math.min(100, Number(searchParams.get('limit') ?? '50'));

    if (!projectId) return c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'project_id is required' } }, 400);

    // Verify user has access to this project
    const { data: access } = await db
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('owner_id', userId)
      .maybeSingle();

    if (!access) {
      // Check project_members
      const { data: member } = await db
        .from('project_members')
        .select('project_id')
        .eq('project_id', projectId)
        .eq('user_id', userId)
        .maybeSingle();
      if (!member) return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Forbidden' } }, 403);
    }

    let query = db
      .from('content_quality_issues')
      .select('*', { count: 'exact' })
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .range(page * limit, page * limit + limit - 1);

    if (status !== 'all') query = query.eq('status', status);
    if (reason) query = query.eq('reason', reason);
    if (contentType) query = query.eq('content_type', contentType);

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
    const issue = loaded.issue;
    if (issue.regen_status === 'running' || issue.regen_status === 'queued') {
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

    let body: { status: string } = { status: 'resolved' };
    try { body = await c.req.json(); } catch { /* use default */ }

    const newStatus = body.status === 'dismissed' ? 'dismissed' : 'resolved';

    const { error } = await db
      .from('content_quality_issues')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', issueId);

    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500);
    return c.json({ ok: true, status: newStatus });
  });
}
