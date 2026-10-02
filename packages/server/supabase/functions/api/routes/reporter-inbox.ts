/**
 * FILE: packages/server/supabase/functions/api/routes/reporter-inbox.ts
 * PURPOSE: "Your reports" for the SDK widget (Plan 018 §2.2, §2.3, §4.2).
 *
 * Routes (apiKeyAuth + reporter token):
 *   GET  /v1/reporter/reports              list with status inputs, unread, latest event
 *   GET  /v1/reporter/reports/:id          one report + its template-rendered timeline
 *   POST /v1/reporter/reports/:id/read     mark that report's updates read
 *   POST /v1/reporter/notifications/read-all
 *   GET  /v1/reporter/updates[?since=]     unread total + up to 3 latest (badge / toast)
 *
 * Privacy rules (Plan 018 §3):
 * - Never returns severity, category, PR / branch / agent, or LLM text.
 * - A report the reporter follows (theirs was grouped under or closed as a
 *   duplicate of it) is shown THROUGH their own row: the canonical report's
 *   status and version overlay the reporter's own title and text. Another
 *   reporter's words are never returned.
 * - Only `status = 'sent'` notifications count: held Outbox rows are invisible.
 * - `GET /v1/reporter/updates` keeps a stable URL when called without `since`,
 *   so the browser's preflight cache (Access-Control-Max-Age) keeps working.
 */

import type { Context, Hono } from 'npm:hono@4';
import type { Variables } from '../types.ts';
import { apiKeyAuth } from '../../_shared/auth.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { log } from '../../_shared/logger.ts';
import { getStorageAdapter } from '../../_shared/storage.ts';
import {
  buildReporterTimeline,
  groupBucket,
  reporterEventPreview,
  reporterPagePath,
  reporterTitle,
  timelineKindForNotification,
  type ReporterNotificationRow,
} from '../../_shared/reporter-copy.ts';
import { dbError, jsonError } from '../shared.ts';
import type { ReporterAuth } from './reporter-auth.ts';

type Db = ReturnType<typeof getServiceClient>;

const inboxLog = log.child('reporter-inbox');

const REPORT_COLUMNS =
  'id, project_id, status, title, summary, description, user_category, app_version, environment, screenshot_path, ' +
  'report_group_id, closed_reason, fixed_in_version, awaiting_reporter_at, created_at, last_admin_reply_at, ' +
  'last_reporter_reply_at, parent_report_id, verified_at, reopened_at, regression_count';

const CLOSED_STATUSES = new Set(['fixed', 'resolved', 'verified', 'dismissed']);
const LIST_LIMIT = 25;
const SCREENSHOT_TTL_SECONDS = 600;

interface ReportRow {
  id: string;
  project_id: string;
  status: string;
  title: string | null;
  summary: string | null;
  description: string | null;
  user_category: string | null;
  app_version: string | null;
  environment: unknown;
  screenshot_path: string | null;
  report_group_id: string | null;
  closed_reason: string | null;
  fixed_in_version: string | null;
  awaiting_reporter_at: string | null;
  created_at: string;
  last_admin_reply_at: string | null;
  last_reporter_reply_at: string | null;
  parent_report_id: string | null;
  verified_at: string | null;
  reopened_at: string | null;
  regression_count: number | null;
}

interface InboxEntry {
  own: ReportRow;
  /** The canonical report this one follows, when it was grouped / closed as a duplicate. */
  canonical: ReportRow | null;
}

/** Short-lived signed thumbnail for the reporter's own screenshot; null on any failure. */
async function signScreenshot(projectId: string, storagePath: string | null): Promise<string | null> {
  if (!storagePath) return null;
  const match = storagePath.match(/^storage:\/\/[^/]+\/[^/]+\/(.+)$/);
  if (!match) return null;
  try {
    const adapter = await getStorageAdapter(projectId);
    return await adapter.signedUrl(match[1], SCREENSHOT_TTL_SECONDS);
  } catch (err) {
    inboxLog.warn('screenshot_sign_failed', { err: String(err) });
    return null;
  }
}

/** The reporter's own reports plus, per row, the canonical report it follows. */
async function loadInbox(
  db: Db,
  projectId: string,
  tokenHash: string,
  opts: { reportId?: string } = {},
): Promise<{ entries: InboxEntry[]; error: { message?: string } | null }> {
  let q = db
    .from('reports')
    .select(REPORT_COLUMNS)
    .eq('project_id', projectId)
    .eq('reporter_token_hash', tokenHash)
    .order('created_at', { ascending: false })
    .limit(opts.reportId ? 1 : LIST_LIMIT);
  if (opts.reportId) q = q.eq('id', opts.reportId);
  const { data: ownRows, error } = await q;
  if (error) return { entries: [], error };
  // closed_reason 'spam' hides the report from its reporter entirely.
  const own = ((ownRows ?? []) as unknown as ReportRow[]).filter((r) => r.closed_reason !== 'spam');
  if (own.length === 0) return { entries: [], error: null };

  const { data: follows, error: followErr } = await db
    .from('reporter_report_follows')
    .select('report_id, source_report_id')
    .eq('project_id', projectId)
    .eq('reporter_token_hash', tokenHash)
    .in('source_report_id', own.map((r) => r.id));
  if (followErr) return { entries: [], error: followErr };

  const canonicalBySource = new Map<string, string>();
  for (const f of (follows ?? []) as Array<{ report_id: string; source_report_id: string | null }>) {
    if (f.source_report_id) canonicalBySource.set(f.source_report_id, f.report_id);
  }
  const canonicalIds = [...new Set(canonicalBySource.values())];
  const canonicalById = new Map<string, ReportRow>();
  if (canonicalIds.length > 0) {
    const { data: canonRows, error: canonErr } = await db
      .from('reports')
      .select(REPORT_COLUMNS)
      .eq('project_id', projectId)
      .in('id', canonicalIds);
    if (canonErr) return { entries: [], error: canonErr };
    for (const r of (canonRows ?? []) as unknown as ReportRow[]) canonicalById.set(r.id, r);
  }

  return {
    entries: own.map((r) => {
      const cid = canonicalBySource.get(r.id);
      return { own: r, canonical: cid ? canonicalById.get(cid) ?? null : null };
    }),
    error: null,
  };
}

/** Every report id whose notifications belong on this own row (itself + followed canonical). */
function notificationReportIds(entry: InboxEntry): string[] {
  return entry.canonical ? [entry.own.id, entry.canonical.id] : [entry.own.id];
}

async function loadNotifications(
  db: Db,
  projectId: string,
  tokenHash: string,
  reportIds: string[],
  limit = 200,
): Promise<{ rows: ReporterNotificationRow[]; error: { message?: string } | null }> {
  if (reportIds.length === 0) return { rows: [], error: null };
  const { data, error } = await db
    .from('reporter_notifications')
    .select('id, report_id, notification_type, payload, read_at, created_at, body_override')
    .eq('project_id', projectId)
    .eq('reporter_token_hash', tokenHash)
    .eq('status', 'sent')
    .in('report_id', reportIds)
    .order('created_at', { ascending: false })
    .limit(limit);
  return { rows: (data ?? []) as ReporterNotificationRow[], error };
}

async function groupSizes(db: Db, groupIds: string[]): Promise<Map<string, number>> {
  const sizes = new Map<string, number>();
  if (groupIds.length === 0) return sizes;
  const { data, error } = await db.from('report_groups').select('id, report_count').in('id', groupIds);
  if (error) inboxLog.warn('group_sizes_failed', { error: error.message });
  for (const g of (data ?? []) as Array<{ id: string; report_count: number }>) sizes.set(g.id, g.report_count);
  return sizes;
}

/** Shape one row for the SDK. `status` is the effective status (canonical when followed). */
async function shapeRow(
  entry: InboxEntry,
  notifications: ReporterNotificationRow[],
  sizes: Map<string, number>,
  projectId: string,
): Promise<Record<string, unknown>> {
  const { own, canonical } = entry;
  const effective = canonical ?? own;
  const ids = new Set(notificationReportIds(entry));
  const mine = notifications.filter((n) => n.report_id && ids.has(n.report_id));
  const unread = mine.filter((n) => !n.read_at).length;
  // Latest event a reporter would care about (skip points-only rows).
  const latest = mine.find((n) => timelineKindForNotification(n.notification_type) || n.notification_type === 'comment_reply' || n.notification_type === 'info_requested');
  const groupId = effective.report_group_id;
  return {
    id: own.id,
    status: effective.status,
    title: reporterTitle(own),
    // Kept for SDKs up to 1.28, which title rows from these.
    summary: own.summary,
    description: own.description,
    user_category: own.user_category,
    page: reporterPagePath(own.environment),
    app_version: own.app_version,
    screenshot_thumb_url: await signScreenshot(projectId, own.screenshot_path),
    group_bucket: groupBucket(groupId ? sizes.get(groupId) : 0),
    closed_reason: canonical ? canonical.closed_reason : own.closed_reason,
    fixed_in_version: effective.fixed_in_version,
    awaiting_reporter: Boolean(own.awaiting_reporter_at),
    followed: Boolean(canonical),
    created_at: own.created_at,
    last_admin_reply_at: own.last_admin_reply_at,
    last_reporter_reply_at: own.last_reporter_reply_at,
    parent_report_id: own.parent_report_id,
    verified_at: own.verified_at,
    reopened_at: own.reopened_at,
    regression_count: own.regression_count ?? 0,
    last_event_at: latest?.created_at ?? own.created_at,
    last_event_preview: latest ? reporterEventPreview(latest) : null,
    unread_count: unread,
  };
}

function authFailure(c: Context, auth: Extract<ReporterAuth, { ok: false }>): Response {
  return c.json({ ok: false, error: { code: auth.code, message: auth.message } }, auth.status as 400 | 401);
}

async function unreadTotal(db: Db, projectId: string, tokenHash: string): Promise<number | null> {
  const { count, error } = await db
    .from('reporter_notifications')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .eq('reporter_token_hash', tokenHash)
    .eq('status', 'sent')
    .is('read_at', null);
  if (error) {
    inboxLog.error('unread_total_failed', { error: error.message });
    return null;
  }
  return count ?? 0;
}

export function registerReporterInboxRoutes(
  app: Hono<{ Variables: Variables }>,
  resolveReporterTokenHash: (c: Context, projectId: string) => Promise<ReporterAuth>,
): void {
  app.get('/v1/reporter/reports', apiKeyAuth, async (c) => {
    const projectId = c.get('projectId') as string;
    const auth = await resolveReporterTokenHash(c, projectId);
    if (!auth.ok) return authFailure(c, auth);
    const onlyOpen = c.req.query('status') === 'open';

    const db = getServiceClient();
    const { entries, error } = await loadInbox(db, projectId, auth.tokenHash);
    if (error) return dbError(c, error);

    const { rows: notifications, error: notifErr } = await loadNotifications(
      db,
      projectId,
      auth.tokenHash,
      entries.flatMap(notificationReportIds),
    );
    if (notifErr) return dbError(c, notifErr);

    const groupIds = [...new Set(entries.map((e) => (e.canonical ?? e.own).report_group_id).filter((g): g is string => Boolean(g)))];
    const sizes = await groupSizes(db, groupIds);

    let reports = await Promise.all(entries.map((e) => shapeRow(e, notifications, sizes, projectId)));
    if (onlyOpen) reports = reports.filter((r) => !CLOSED_STATUSES.has(r.status as string));
    // Unread first, then most recent activity.
    reports.sort((a, b) => {
      const ua = (a.unread_count as number) > 0 ? 1 : 0;
      const ub = (b.unread_count as number) > 0 ? 1 : 0;
      if (ua !== ub) return ub - ua;
      return Date.parse(b.last_event_at as string) - Date.parse(a.last_event_at as string);
    });

    c.header('Cache-Control', 'no-store');
    return c.json({ ok: true, data: { reports } });
  });

  app.get('/v1/reporter/reports/:id', apiKeyAuth, async (c) => {
    const projectId = c.get('projectId') as string;
    const reportId = c.req.param('id')!;
    const auth = await resolveReporterTokenHash(c, projectId);
    if (!auth.ok) return authFailure(c, auth);

    const db = getServiceClient();
    const { entries, error } = await loadInbox(db, projectId, auth.tokenHash, { reportId });
    if (error) return dbError(c, error);
    const entry = entries[0];
    if (!entry) return jsonError(c, 'NOT_FOUND', 'Report not found', 404);

    const { rows: notifications, error: notifErr } = await loadNotifications(
      db,
      projectId,
      auth.tokenHash,
      notificationReportIds(entry),
    );
    if (notifErr) return dbError(c, notifErr);

    // Only the reporter's own thread: developer replies visible to them and
    // their own messages. Comments on a followed canonical report belong to
    // another reporter's conversation and are never included.
    const { data: comments, error: commentErr } = await db
      .from('report_comments')
      .select('id, author_kind, body, created_at')
      .eq('report_id', entry.own.id)
      .or(`visible_to_reporter.eq.true,reporter_token_hash.eq.${auth.tokenHash}`)
      .order('created_at', { ascending: true });
    if (commentErr) return dbError(c, commentErr);

    const sizes = await groupSizes(
      db,
      [(entry.canonical ?? entry.own).report_group_id].filter((g): g is string => Boolean(g)),
    );
    const report = await shapeRow(entry, notifications, sizes, projectId);
    const timeline = buildReporterTimeline({
      reportCreatedAt: entry.own.created_at,
      notifications: [...notifications].reverse(),
      comments: (comments ?? []) as Array<{ id: number; author_kind: string; body: string; created_at: string }>,
    });
    const status = report.status as string;

    c.header('Cache-Control', 'no-store');
    return c.json({
      ok: true,
      data: { report, timeline, can_verify: status === 'fixed' || status === 'resolved' },
    });
  });

  app.post('/v1/reporter/reports/:id/read', apiKeyAuth, async (c) => {
    const projectId = c.get('projectId') as string;
    const reportId = c.req.param('id')!;
    const auth = await resolveReporterTokenHash(c, projectId);
    if (!auth.ok) return authFailure(c, auth);

    const db = getServiceClient();
    const { entries, error } = await loadInbox(db, projectId, auth.tokenHash, { reportId });
    if (error) return dbError(c, error);
    const entry = entries[0];
    if (!entry) return jsonError(c, 'NOT_FOUND', 'Report not found', 404);

    const { error: updErr, count } = await db
      .from('reporter_notifications')
      .update({ read_at: new Date().toISOString() }, { count: 'exact' })
      .eq('project_id', projectId)
      .eq('reporter_token_hash', auth.tokenHash)
      .eq('status', 'sent')
      .is('read_at', null)
      .in('report_id', notificationReportIds(entry));
    if (updErr) return dbError(c, updErr);

    return c.json({
      ok: true,
      data: { marked_read: count ?? 0, unread_total: await unreadTotal(db, projectId, auth.tokenHash) },
    });
  });

  app.post('/v1/reporter/notifications/read-all', apiKeyAuth, async (c) => {
    const projectId = c.get('projectId') as string;
    const auth = await resolveReporterTokenHash(c, projectId);
    if (!auth.ok) return authFailure(c, auth);

    const db = getServiceClient();
    const { error, count } = await db
      .from('reporter_notifications')
      .update({ read_at: new Date().toISOString() }, { count: 'exact' })
      .eq('project_id', projectId)
      .eq('reporter_token_hash', auth.tokenHash)
      .eq('status', 'sent')
      .is('read_at', null);
    if (error) return dbError(c, error);
    return c.json({ ok: true, data: { marked_read: count ?? 0, unread_total: 0 } });
  });

  app.get('/v1/reporter/updates', apiKeyAuth, async (c) => {
    const projectId = c.get('projectId') as string;
    const auth = await resolveReporterTokenHash(c, projectId);
    if (!auth.ok) return authFailure(c, auth);

    const sinceParam = c.req.query('since');
    const since = sinceParam && !Number.isNaN(Date.parse(sinceParam)) ? new Date(sinceParam).toISOString() : null;

    const db = getServiceClient();
    let q = db
      .from('reporter_notifications')
      .select('id, report_id, notification_type, payload, read_at, created_at, body_override')
      .eq('project_id', projectId)
      .eq('reporter_token_hash', auth.tokenHash)
      .eq('status', 'sent')
      .is('read_at', null)
      .order('created_at', { ascending: false })
      .limit(20);
    if (since) q = q.gt('created_at', since);
    const { data, error } = await q;
    if (error) return dbError(c, error);

    const total = await unreadTotal(db, projectId, auth.tokenHash);
    if (total === null) return jsonError(c, 'DB_ERROR', 'Could not count unread updates', 500);

    // Followed canonical reports surface under the reporter's own report id.
    const rows = (data ?? []) as ReporterNotificationRow[];
    const { data: follows } = await db
      .from('reporter_report_follows')
      .select('report_id, source_report_id')
      .eq('project_id', projectId)
      .eq('reporter_token_hash', auth.tokenHash);
    const ownByCanonical = new Map<string, string>();
    for (const f of (follows ?? []) as Array<{ report_id: string; source_report_id: string | null }>) {
      if (f.source_report_id) ownByCanonical.set(f.report_id, f.source_report_id);
    }

    const latest = rows
      .filter((n) => timelineKindForNotification(n.notification_type) || n.notification_type === 'comment_reply' || n.notification_type === 'info_requested')
      .slice(0, 3)
      .map((n) => ({
        report_id: ownByCanonical.get(n.report_id ?? '') ?? n.report_id,
        kind:
          n.notification_type === 'comment_reply'
            ? 'comment'
            : n.notification_type === 'info_requested'
              ? 'info_requested'
              : timelineKindForNotification(n.notification_type),
        preview: reporterEventPreview(n),
        at: n.created_at,
      }));

    c.header('Cache-Control', 'no-store');
    return c.json({
      ok: true,
      data: { unread_total: total, latest, server_time: new Date().toISOString() },
    });
  });
}
