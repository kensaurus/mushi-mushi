/**
 * FILE: packages/server/supabase/functions/api/routes/reporter-admin.ts
 * PURPOSE: The developer's side of the reporter loop (Plan 018 §3, §5).
 *
 * Routes:
 *   POST  /v1/admin/reports/:id/request-info       adminOrApiKey(mcp:write)  ask the reporter a question
 *   GET   /v1/admin/reports/:id/reporter-view      jwtAuth                   what the reporter sees + pending messages
 *   GET   /v1/admin/reporter-outbox                adminOrApiKey(mcp:read)   held pipeline messages (review mode)
 *   POST  /v1/admin/reporter-outbox/:id/release    adminOrApiKey(mcp:write)  send a held message (optional edit)
 *   POST  /v1/admin/reporter-outbox/:id/discard    adminOrApiKey(mcp:write)  drop a held message
 *   PATCH /v1/admin/reporter-outbox/:id            adminOrApiKey(mcp:write)  edit a held message
 *   GET   /v1/admin/reporter-updates-mode          adminOrApiKey(mcp:read)   'auto' | 'review'
 *   PUT   /v1/admin/reporter-updates-mode          jwtAuth                   switch modes
 *
 * Direct developer replies are never held; only pipeline messages (fix
 * started, fixed, released, closed) wait in the Outbox in review mode.
 */

import type { Context, Hono } from 'npm:hono@4';
import type { Variables } from '../types.ts';
import { adminOrApiKey, jwtAuth } from '../../_shared/auth.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { logAudit } from '../../_shared/audit.ts';
import { requestReporterInfo } from '../../_shared/reporter-comms.ts';
import {
  discardHeldNotification,
  releaseHeldNotification,
  type HeldActionResult,
} from '../../_shared/notifications.ts';
import {
  buildReporterTimeline,
  groupBucket,
  reporterSafePayload,
  reporterTitle,
  type ReporterNotificationRow,
} from '../../_shared/reporter-copy.ts';
import { stampDeliveredReleaseCredits } from '../../_shared/release-reporters.ts';
import { log } from '../../_shared/logger.ts';
import { callerProjectIds, canAccessReportProject, dbError, jsonError, parseUuidParam } from '../shared.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Db = ReturnType<typeof getServiceClient>;

const BODY_OVERRIDE_MAX = 1000;
const QUESTION_MAX = 2000;

async function readJson(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const body = await c.req.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return null;
  }
}

/** The held row's project, if the caller can reach it. */
async function outboxRowProject(c: Context, db: Db, userId: string, id: string): Promise<string | null> {
  const { data } = await db.from('reporter_notifications').select('project_id').eq('id', id).maybeSingle();
  const projectId = (data as { project_id?: string } | null)?.project_id;
  if (!projectId) return null;
  const allowed = await callerProjectIds(c, db, userId);
  return allowed.includes(projectId) ? projectId : null;
}

function heldResponse(c: Context, outcome: HeldActionResult): Response {
  if (outcome.ok) {
    const r = outcome.result;
    return c.json({
      ok: true,
      data: { delivered: r.delivered, skipped: r.skipped, duplicate: r.duplicate, failed: r.failed },
    });
  }
  if (outcome.code === 'NOT_FOUND') return jsonError(c, 'NOT_FOUND', outcome.message, 404);
  if (outcome.code === 'NOT_HELD') return jsonError(c, 'CONFLICT', outcome.message, 409);
  return jsonError(c, 'DB_ERROR', outcome.message, 500);
}

export function registerReporterAdminRoutes(app: Hono<{ Variables: Variables }>): void {
  app.post('/v1/admin/reports/:id/request-info', adminOrApiKey({ scope: 'mcp:write' }), async (c) => {
    const idParsed = parseUuidParam(c);
    if (!idParsed.ok) return idParsed.error;
    const reportId = idParsed.value;
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const body = await readJson(c);
    if (!body) return jsonError(c, 'BAD_REQUEST', 'Invalid JSON body', 400);
    const question = typeof body.question === 'string' ? body.question.trim() : '';
    if (!question || question.length > QUESTION_MAX) {
      return jsonError(c, 'VALIDATION_ERROR', `question is required (1–${QUESTION_MAX} chars)`, 422);
    }
    const authorName =
      typeof body.author_name === 'string' && body.author_name.trim() ? body.author_name.trim().slice(0, 100) : 'Developer';

    const projectIds = await callerProjectIds(c, db, userId);
    if (projectIds.length === 0) return jsonError(c, 'NOT_FOUND', 'Report not found', 404);
    const { data: report, error } = await db
      .from('reports')
      .select('project_id')
      .eq('id', reportId)
      .in('project_id', projectIds)
      .maybeSingle();
    if (error) return dbError(c, error);
    if (!report) return jsonError(c, 'NOT_FOUND', 'Report not found', 404);

    const result = await requestReporterInfo(db, {
      projectId: report.project_id as string,
      reportId,
      question,
      authorName,
      // A console user posts as themselves; an API key posts as the project owner.
      authorUserId: c.get('authMethod') === 'jwt' ? userId : null,
    });
    return c.json(result.body, result.status);
  });

  app.get('/v1/admin/reports/:id/reporter-view', jwtAuth, async (c) => {
    const idParsed = parseUuidParam(c);
    if (!idParsed.ok) return idParsed.error;
    const reportId = idParsed.value;
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const { data: report, error } = await db
      .from('reports')
      .select(
        'id, project_id, status, title, summary, description, user_category, report_group_id, closed_reason, ' +
          'fixed_in_version, awaiting_reporter_at, admin_seen_at, last_reporter_reply_at, last_admin_reply_at, ' +
          'reporter_token_hash, created_at',
      )
      .eq('id', reportId)
      .maybeSingle();
    if (error) return dbError(c, error);
    if (!report) return jsonError(c, 'NOT_FOUND', 'Report not found', 404);
    const r = report as unknown as Record<string, unknown> & { project_id: string; reporter_token_hash: string | null };
    if (!(await canAccessReportProject(c, db, userId, r.project_id))) {
      return jsonError(c, 'NOT_FOUND', 'Report not found', 404);
    }

    const token = r.reporter_token_hash;
    const [notifRes, commentRes, groupRes, followRes] = await Promise.all([
      token
        ? db
            .from('reporter_notifications')
            .select('id, report_id, notification_type, payload, read_at, created_at, body_override, status')
            .eq('report_id', reportId)
            .eq('reporter_token_hash', token)
            .in('status', ['sent', 'held'])
            .order('created_at', { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      db
        .from('report_comments')
        .select('id, author_kind, body, created_at, visible_to_reporter')
        .eq('report_id', reportId)
        .order('created_at', { ascending: true }),
      r.report_group_id
        ? db.from('report_groups').select('report_count').eq('id', r.report_group_id as string).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      db.from('reporter_report_follows').select('reporter_token_hash', { count: 'exact', head: true }).eq('report_id', reportId),
    ]);
    if (notifRes.error) return dbError(c, notifRes.error);
    if (commentRes.error) return dbError(c, commentRes.error);

    const rows = (notifRes.data ?? []) as Array<ReporterNotificationRow & { status: string }>;
    const sent = rows.filter((n) => n.status === 'sent');
    const held = rows.filter((n) => n.status === 'held');
    const comments = ((commentRes.data ?? []) as Array<{
      id: number;
      author_kind: string;
      body: string;
      created_at: string;
      visible_to_reporter: boolean;
    }>).filter((cm) => cm.visible_to_reporter || cm.author_kind === 'reporter');

    return c.json({
      ok: true,
      data: {
        has_reporter: Boolean(token),
        // Inputs for @mushi-mushi/core/reporter-ui reporterStatus(), so the
        // console renders the exact pill the widget shows.
        status_input: {
          status: r.status,
          awaiting_reporter: Boolean(r.awaiting_reporter_at),
          fixed_in_version: r.fixed_in_version ?? null,
          closed_reason: r.closed_reason ?? null,
          group_bucket: groupBucket((groupRes.data as { report_count?: number } | null)?.report_count ?? 0),
          user_category: r.user_category ?? null,
        },
        title: reporterTitle(r as { title?: string | null; summary?: string | null; description?: string | null }),
        timeline: buildReporterTimeline({
          reportCreatedAt: r.created_at as string,
          notifications: sent,
          comments,
        }),
        pending: held.map((n) => ({
          id: n.id,
          notification_type: n.notification_type,
          text: reporterSafePayload(n).message,
          created_at: n.created_at,
        })),
        unread_by_reporter: sent.filter((n) => !n.read_at).length,
        followers: followRes.count ?? 0,
        awaiting_reporter_at: r.awaiting_reporter_at ?? null,
        admin_seen_at: r.admin_seen_at ?? null,
        last_reporter_reply_at: r.last_reporter_reply_at ?? null,
        reporter_replied_unseen: Boolean(
          r.last_reporter_reply_at &&
            (!r.admin_seen_at || Date.parse(r.last_reporter_reply_at as string) > Date.parse(r.admin_seen_at as string)),
        ),
      },
    });
  });

  app.get('/v1/admin/reporter-outbox', adminOrApiKey(), async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await callerProjectIds(c, db, userId);
    if (projectIds.length === 0) return c.json({ ok: true, data: { messages: [] } });

    const { data, error } = await db
      .from('reporter_notifications')
      .select('id, project_id, report_id, notification_type, payload, body_override, created_at')
      .in('project_id', projectIds)
      .eq('status', 'held')
      .order('created_at', { ascending: true })
      .limit(200);
    if (error) return dbError(c, error);

    const rows = (data ?? []) as Array<ReporterNotificationRow & { project_id: string }>;
    const reportIds = [...new Set(rows.map((r) => r.report_id).filter((id): id is string => Boolean(id)))];
    const titles = new Map<string, string>();
    if (reportIds.length > 0) {
      const { data: reports } = await db.from('reports').select('id, title, summary, description').in('id', reportIds);
      for (const rep of (reports ?? []) as Array<{ id: string; title: string | null; summary: string | null; description: string | null }>) {
        titles.set(rep.id, reporterTitle(rep));
      }
    }
    return c.json({
      ok: true,
      data: {
        messages: rows.map((n) => ({
          id: n.id,
          project_id: n.project_id,
          report_id: n.report_id,
          report_title: n.report_id ? titles.get(n.report_id) ?? null : null,
          notification_type: n.notification_type,
          // What the reporter will see if released unchanged.
          text: reporterSafePayload({ ...n, body_override: null }).message,
          body_override: n.body_override ?? null,
          created_at: n.created_at,
        })),
      },
    });
  });

  app.post('/v1/admin/reporter-outbox/:id/release', adminOrApiKey({ scope: 'mcp:write' }), async (c) => {
    const idParsed = parseUuidParam(c);
    if (!idParsed.ok) return idParsed.error;
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const body = (await readJson(c)) ?? {};
    const override = typeof body.body_override === 'string' ? body.body_override.trim() : null;
    if (override !== null && (override.length === 0 || override.length > BODY_OVERRIDE_MAX)) {
      return jsonError(c, 'VALIDATION_ERROR', `body_override must be 1–${BODY_OVERRIDE_MAX} chars`, 422);
    }
    const projectId = await outboxRowProject(c, db, userId, idParsed.value);
    if (!projectId) return jsonError(c, 'NOT_FOUND', 'Message not found', 404);

    const outcome = await releaseHeldNotification(db, {
      notificationId: idParsed.value,
      projectId,
      releasedBy: c.get('authMethod') === 'jwt' ? userId : null,
      bodyOverride: override,
    });
    if (outcome.ok) {
      await logAudit(db, projectId, userId, 'settings.updated', 'reporter_outbox', idParsed.value, { action: 'release' });
      // A held "shipped in vX" message now went out: its release credit can be
      // stamped (publish skipped it because nothing had been delivered yet).
      if (outcome.type === 'released' && outcome.dedupeKey && UUID_RE.test(outcome.dedupeKey)) {
        const stamped = await stampDeliveredReleaseCredits(db, outcome.dedupeKey);
        if (!stamped.ok) log.error('release_credit_stamp_failed', { messageId: idParsed.value, error: stamped.error });
      }
    }
    return heldResponse(c, outcome);
  });

  app.post('/v1/admin/reporter-outbox/:id/discard', adminOrApiKey({ scope: 'mcp:write' }), async (c) => {
    const idParsed = parseUuidParam(c);
    if (!idParsed.ok) return idParsed.error;
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectId = await outboxRowProject(c, db, userId, idParsed.value);
    if (!projectId) return jsonError(c, 'NOT_FOUND', 'Message not found', 404);

    const outcome = await discardHeldNotification(db, {
      notificationId: idParsed.value,
      projectId,
      discardedBy: c.get('authMethod') === 'jwt' ? userId : null,
    });
    if (outcome.ok) {
      await logAudit(db, projectId, userId, 'settings.updated', 'reporter_outbox', idParsed.value, { action: 'discard' });
    }
    return heldResponse(c, outcome);
  });

  app.patch('/v1/admin/reporter-outbox/:id', adminOrApiKey({ scope: 'mcp:write' }), async (c) => {
    const idParsed = parseUuidParam(c);
    if (!idParsed.ok) return idParsed.error;
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const body = await readJson(c);
    if (!body) return jsonError(c, 'BAD_REQUEST', 'Invalid JSON body', 400);
    const override = typeof body.body_override === 'string' ? body.body_override.trim() : '';
    if (!override || override.length > BODY_OVERRIDE_MAX) {
      return jsonError(c, 'VALIDATION_ERROR', `body_override must be 1–${BODY_OVERRIDE_MAX} chars`, 422);
    }
    const projectId = await outboxRowProject(c, db, userId, idParsed.value);
    if (!projectId) return jsonError(c, 'NOT_FOUND', 'Message not found', 404);

    const { data, error } = await db
      .from('reporter_notifications')
      .update({ body_override: override })
      .eq('id', idParsed.value)
      .eq('project_id', projectId)
      .eq('status', 'held')
      .select('id')
      .maybeSingle();
    if (error) return dbError(c, error);
    if (!data) return jsonError(c, 'CONFLICT', 'Message is no longer held', 409);
    return c.json({ ok: true, data: { id: idParsed.value, body_override: override } });
  });

  app.get('/v1/admin/reporter-updates-mode', adminOrApiKey(), async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const projectIds = await callerProjectIds(c, db, userId);
    if (projectIds.length !== 1) {
      return jsonError(c, 'PROJECT_REQUIRED', 'Pass project_id for a single project', 400);
    }
    const { data, error } = await db
      .from('project_settings')
      .select('reporter_updates_mode')
      .eq('project_id', projectIds[0])
      .maybeSingle();
    if (error) return dbError(c, error);
    return c.json({
      ok: true,
      data: {
        project_id: projectIds[0],
        mode: (data as { reporter_updates_mode?: string } | null)?.reporter_updates_mode === 'review' ? 'review' : 'auto',
      },
    });
  });

  app.put('/v1/admin/reporter-updates-mode', jwtAuth, async (c) => {
    const userId = c.get('userId') as string;
    const db = getServiceClient();
    const body = await readJson(c);
    if (!body) return jsonError(c, 'BAD_REQUEST', 'Invalid JSON body', 400);
    const mode = body.mode;
    const projectId = typeof body.project_id === 'string' ? body.project_id : '';
    if (mode !== 'auto' && mode !== 'review') return jsonError(c, 'VALIDATION_ERROR', "mode must be 'auto' or 'review'", 422);
    const allowed = await callerProjectIds(c, db, userId);
    if (!allowed.includes(projectId)) return jsonError(c, 'NOT_FOUND', 'Project not found', 404);

    const { error } = await db
      .from('project_settings')
      .upsert({ project_id: projectId, reporter_updates_mode: mode }, { onConflict: 'project_id' });
    if (error) return dbError(c, error);
    await logAudit(db, projectId, userId, 'settings.updated', 'project_settings', projectId, { reporter_updates_mode: mode });
    return c.json({ ok: true, data: { project_id: projectId, mode } });
  });
}
