// ============================================================
// reporter-comms.ts — shared two-way reporter communication logic
//
// Single implementation of "reply to the reporter widget" and
// "two-way comms health" so the SDK/CLI sync routes (apiKeyAuth,
// project-scoped) and the admin/MCP routes (adminOrApiKey, accepts
// org-scoped keys) never drift. See `api/routes/sync.ts` and
// `api/routes/reports.ts`.
// ============================================================

import { getServiceClient } from './db.ts'
import { createNotification, buildNotificationMessage } from './notifications.ts'

type Db = ReturnType<typeof getServiceClient>

/** HTTP statuses the reply helper can resolve to (subset of Hono's StatusCode). */
type ReplyStatus = 201 | 404 | 500

export interface PostReplyResult {
  status: ReplyStatus
  body: Record<string, unknown>
}

/**
 * Post an admin reply that is visible in the reporter widget and fires the
 * "New reply" reporter notification. Attributes the comment to the project
 * owner (admin replies via API key have no acting-user JWT), satisfying the
 * `report_comments_author_well_formed` constraint.
 */
export async function postReporterReply(
  db: Db,
  params: { projectId: string; reportId: string; message: string; authorName: string },
): Promise<PostReplyResult> {
  const { projectId, reportId, message, authorName } = params

  const { data: report, error: fetchErr } = await db
    .from('reports')
    .select('id, status, reporter_token_hash')
    .eq('id', reportId)
    .eq('project_id', projectId)
    .maybeSingle()

  if (fetchErr) {
    return { status: 500, body: { ok: false, error: { code: 'DB_ERROR', message: fetchErr.message } } }
  }
  if (!report) {
    return { status: 404, body: { ok: false, error: { code: 'NOT_FOUND', message: `Report ${reportId} not found` } } }
  }

  const { data: project, error: projectErr } = await db
    .from('projects')
    .select('owner_id')
    .eq('id', projectId)
    .maybeSingle()

  if (projectErr) {
    return { status: 500, body: { ok: false, error: { code: 'DB_ERROR', message: projectErr.message } } }
  }
  if (!project?.owner_id) {
    return {
      status: 500,
      body: { ok: false, error: { code: 'MISCONFIGURED', message: 'Project has no owner_id — cannot post admin reply via API key' } },
    }
  }

  const { data: comment, error: insertErr } = await db
    .from('report_comments')
    .insert({
      report_id: reportId,
      project_id: projectId,
      author_kind: 'admin',
      author_user_id: project.owner_id,
      author_name: authorName,
      body: message,
      visible_to_reporter: true,
      created_at: new Date().toISOString(),
    })
    .select('id, author_kind, author_name, body, visible_to_reporter, created_at')
    .single()

  if (insertErr) {
    return { status: 500, body: { ok: false, error: { code: 'DB_ERROR', message: insertErr.message } } }
  }

  // Best-effort: stamp last_admin_reply_at so two-way health reflects the reply.
  db.from('reports')
    .update({ last_admin_reply_at: new Date().toISOString() })
    .eq('id', reportId)
    .eq('project_id', projectId)
    .then(() => null, () => null)

  // Notify the reporter widget so they see the unread badge.
  if (report.reporter_token_hash) {
    createNotification(db, projectId, reportId, report.reporter_token_hash, 'comment_reply', {
      message: buildNotificationMessage('comment_reply', {}),
      reportId,
    }).catch(() => null)
  }

  return { status: 201, body: { ok: true, data: { comment } } }
}

export interface TwoWayHealth {
  last_sdk_heartbeat_at: string | null
  last_sdk_user_agent: string | null
  unread_admin_replies: number
  admin_replies_7d: number
  healthy: boolean
}

/**
 * Compute the two-way comms health snapshot for a single project: latest SDK
 * heartbeat, unread reporter notifications, and admin replies in the last 7d.
 */
export async function computeTwoWayHealth(db: Db, projectId: string): Promise<TwoWayHealth> {
  const [keysRes, unreadRes, repliesRes] = await Promise.all([
    db
      .from('project_api_keys')
      .select('last_seen_at, last_seen_user_agent')
      .eq('project_id', projectId)
      .eq('is_active', true)
      .order('last_seen_at', { ascending: false, nullsFirst: false })
      .limit(1),
    // Reporter read-state lives on `reporter_notifications` (read_at) — there
    // is no per-comment read flag. Unread notifications proxy "updates the
    // reporter hasn't seen".
    db
      .from('reporter_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .is('read_at', null),
    db
      .from('report_comments')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('author_kind', 'admin')
      .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
  ])

  const heartbeat = keysRes.data?.[0]
  return {
    last_sdk_heartbeat_at: heartbeat?.last_seen_at ?? null,
    last_sdk_user_agent: heartbeat?.last_seen_user_agent ?? null,
    unread_admin_replies: unreadRes.count ?? 0,
    admin_replies_7d: repliesRes.count ?? 0,
    healthy: Boolean(heartbeat?.last_seen_at),
  }
}
