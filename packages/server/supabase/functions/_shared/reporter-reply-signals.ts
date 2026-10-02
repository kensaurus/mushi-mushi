/**
 * FILE: _shared/reporter-reply-signals.ts
 * PURPOSE: A reporter's reply is an admin signal (Plan 018 decision 10).
 *
 * OVERVIEW:
 * - `claimReporterReplySlot` — 10 replies per hour per reporter token per
 *   project, through `scoped_rate_limit_claim(p_user_id uuid, p_scope text,
 *   p_max_per_window int, p_window interval)`. The actor is a UUID derived
 *   from (project, token) because the RPC's actor column is a uuid. Fails
 *   CLOSED on an unexpected RPC error and logs it at `error`: this is a public
 *   write route, and the repo has shipped a fail-open limiter four times.
 * - `announceReporterReply` — plugin event `report.reporter_replied`, a
 *   threaded reply on the report's Slack card (and Discord / Teams), Web Push
 *   to the project's console users, and a `not_reproducible` close reopens.
 *   Every branch is best-effort: the reporter's reply is already stored.
 * - The comment trigger clears `awaiting_reporter_at` and stamps
 *   `last_reporter_reply_at` (the console unread dot compares it with
 *   `reports.admin_seen_at`).
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { log } from './logger.ts'
import { dispatchPluginEventDetached } from './plugins.ts'
import { notifyTeamReporterReply } from './team-notify.ts'
import { sendWebPushToUser } from './web-push.ts'
import { runStatusTransitionSideEffects } from './report-transition.ts'

const replyLog = log.child('reporter-reply')

export const REPORTER_REPLY_LIMIT = 10
export const REPORTER_REPLY_WINDOW = '1 hour'
export const REPORTER_REPLY_SCOPE = 'reporter_reply'
/** Longest reporter reply accepted (the DB allows 10k; the widget caps at this). */
export const REPORTER_REPLY_MAX_CHARS = 2000

/** Stable UUID-shaped actor id for (project, reporter key). */
export async function reporterReplyActorId(projectId: string, tokenHash: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${REPORTER_REPLY_SCOPE}:${projectId}:${tokenHash}`),
  )
  const hex = Array.from(new Uint8Array(digest).slice(0, 16))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

export type ReplySlot = { ok: true } | { ok: false; reason: 'limit' | 'error'; retryAfterSeconds: number }

export async function claimReporterReplySlot(
  db: Pick<SupabaseClient, 'rpc'>,
  projectId: string,
  tokenHash: string,
): Promise<ReplySlot> {
  const { error } = await db.rpc('scoped_rate_limit_claim', {
    p_user_id: await reporterReplyActorId(projectId, tokenHash),
    p_scope: REPORTER_REPLY_SCOPE,
    p_max_per_window: REPORTER_REPLY_LIMIT,
    p_window: REPORTER_REPLY_WINDOW,
  })
  if (!error) return { ok: true }
  if ((error.message ?? '').includes('rate_limit_exceeded')) {
    return { ok: false, reason: 'limit', retryAfterSeconds: 600 }
  }
  replyLog.error('reporter reply rate limit check failed — failing closed', {
    projectId,
    err: error.message,
  })
  return { ok: false, reason: 'error', retryAfterSeconds: 30 }
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/** Console users who can see this project: its members plus the owner. */
async function projectConsoleUsers(db: SupabaseClient, projectId: string): Promise<string[]> {
  const [{ data: members, error: memberErr }, { data: project }] = await Promise.all([
    db.from('project_members').select('user_id').eq('project_id', projectId),
    db.from('projects').select('owner_id').eq('id', projectId).maybeSingle(),
  ])
  if (memberErr) replyLog.warn('project_members_load_failed', { projectId, err: memberErr.message })
  const ids = new Set<string>()
  for (const m of (members ?? []) as Array<{ user_id: string }>) ids.add(m.user_id)
  const owner = (project as { owner_id?: string | null } | null)?.owner_id
  if (owner) ids.add(owner)
  return [...ids]
}

export interface ReporterReplySignal {
  projectId: string
  reportId: string
  commentId: number | string
  body: string
}

/** Fan a reporter's reply out to the people who can answer it. Never throws. */
export async function announceReporterReply(db: SupabaseClient, input: ReporterReplySignal): Promise<void> {
  const { projectId, reportId, commentId, body } = input
  const excerpt = clip(body, 500)

  dispatchPluginEventDetached(db, projectId, 'report.reporter_replied', {
    report: { id: reportId },
    comment: { id: commentId, body: excerpt, author_kind: 'reporter' },
  }).catch((e) => replyLog.warn('plugin dispatch failed', { event: 'report.reporter_replied', err: String(e) }))

  const tasks: Promise<unknown>[] = [
    notifyTeamReporterReply(db, projectId, reportId, excerpt).catch((e) =>
      replyLog.warn('team reply notification failed', { reportId, err: String(e) }),
    ),
    (async () => {
      const users = await projectConsoleUsers(db, projectId)
      for (const userId of users) {
        const res = await sendWebPushToUser(db, userId, {
          title: 'A reporter replied',
          body: clip(body, 120),
          url: `/reports/${encodeURIComponent(reportId)}?project=${encodeURIComponent(projectId)}`,
          tag: `report-reply-${reportId}`,
        })
        if (res.error && res.error !== 'no_subscriptions' && res.error !== 'push_not_configured') {
          replyLog.warn('admin push failed', { userId, err: res.error })
        }
      }
    })().catch((e) => replyLog.warn('admin push failed', { reportId, err: String(e) })),
    reopenIfNotReproducible(db, projectId, reportId).catch((e) =>
      replyLog.error('not_reproducible reopen failed', { reportId, err: String(e) }),
    ),
  ]
  await Promise.all(tasks)
}

/** "We couldn't reproduce it. Reply if it happens again." — the reply reopens it. */
async function reopenIfNotReproducible(db: SupabaseClient, projectId: string, reportId: string): Promise<void> {
  const { data, error } = await db
    .from('reports')
    .update({ status: 'reopened', closed_reason: null, reopened_at: new Date().toISOString() })
    .eq('id', reportId)
    .eq('project_id', projectId)
    .eq('status', 'dismissed')
    .eq('closed_reason', 'not_reproducible')
    .select('reporter_token_hash')
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return
  runStatusTransitionSideEffects(db, {
    reportId,
    projectId,
    reporterTokenHash: (data as { reporter_token_hash: string | null }).reporter_token_hash ?? null,
    previousStatus: 'dismissed',
    newStatus: 'reopened',
    actor: { kind: 'system', id: 'reporter-reply' },
  })
}
