// SPDX-License-Identifier: MIT
/**
 * FILE: packages/server/supabase/functions/_shared/voice-return.ts
 * PURPOSE: The return path to the phone (plan C5). When a fix that a voice
 *          request dispatched reaches a milestone (draft PR opened, failed,
 *          merged), reply where the request came from: the Slack thread, the
 *          Telegram chat (as a reply to the original voice note), or the
 *          admin's Web Push subscriptions.
 *
 * Hooked from `notifyTeamFixEvent` (team-notify.ts) so every producer of fix
 * events — fix-worker, agent adapters, fix-merge — reaches the phone without
 * knowing the voice inbox exists. Fail-soft: never throws.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { sendBotMessage } from './slack.ts'
import { sendTelegramMessage } from './telegram.ts'
import { sendWebPushToUser } from './web-push.ts'
import { log as rootLog } from './logger.ts'

const log = rootLog.child('voice-return')

export type VoiceReturnEvent = 'fix_dispatched' | 'fix_pr_opened' | 'fix_failed' | 'fix_merged'

export interface VoiceReturnDetails {
  prUrl?: string
  error?: string
}

interface ReturnSessionRow {
  id: string
  status: string
  summary: string | null
  transcript: string | null
  channel: Record<string, unknown> | null
  pr_url: string | null
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/** Plain-text body for chat surfaces; the Slack variant adds mrkdwn links. */
export function voiceReturnText(
  event: VoiceReturnEvent,
  summary: string,
  details: VoiceReturnDetails,
  flavour: 'plain' | 'slack',
): string {
  const link = details.prUrl
    ? flavour === 'slack'
      ? `<${details.prUrl}|draft PR>`
      : details.prUrl
    : null
  switch (event) {
    case 'fix_pr_opened':
      return link
        ? `\u{1F527} Draft PR is open for "${summary}": ${link}\n\nReview and merge it from the console — nothing lands without you.`
        : `\u{1F527} Draft PR is open for "${summary}".`
    case 'fix_failed':
      return `❌ The fix attempt for "${summary}" failed${details.error ? `: ${details.error.slice(0, 300)}` : ''}.\n\nOpen the report in the console for the full log.`
    case 'fix_merged':
      return `✅ The fix for "${summary}" was merged${link ? ` (${link})` : ''}.`
    case 'fix_dispatched':
      return `\u{1F680} Working on "${summary}"…`
  }
}

/**
 * Reply to every voice session that dispatched a fix for this report.
 * `fix_dispatched` is skipped: the confirmation step already replied in
 * channel, and doubling up reads as spam.
 */
export async function notifyVoiceSessionsForReport(
  db: SupabaseClient,
  projectId: string,
  reportId: string,
  event: VoiceReturnEvent,
  details: VoiceReturnDetails = {},
): Promise<void> {
  if (event === 'fix_dispatched') return
  try {
    const { data, error } = await db
      .from('voice_intake_sessions')
      .select('id, status, summary, transcript, channel, pr_url')
      .eq('project_id', projectId)
      .eq('report_id', reportId)
      .in('status', ['dispatched', 'notified'])
    if (error) {
      log.warn('voice return lookup failed', { projectId, reportId, err: error.message })
      return
    }
    const sessions = (data as ReturnSessionRow[] | null) ?? []
    if (sessions.length === 0) return

    for (const session of sessions) {
      const summary = (session.summary ?? session.transcript ?? `report ${reportId.slice(0, 8)}…`).slice(0, 200)
      const channel = session.channel ?? {}
      const tasks: Promise<unknown>[] = []

      const slackChannelId = str(channel.slackChannelId)
      if (slackChannelId) {
        tasks.push(
          sendBotMessage({
            channel: slackChannelId,
            text: voiceReturnText(event, summary, details, 'slack'),
            threadTs: str(channel.slackThreadTs) ?? null,
            db,
            projectId,
          }),
        )
      }

      const telegramChatId = str(channel.telegramChatId)
      if (telegramChatId) {
        tasks.push(
          sendTelegramMessage(db, projectId, telegramChatId, voiceReturnText(event, summary, details, 'plain'), {
            replyToMessageId: num(channel.telegramMessageId),
          }),
        )
      }

      const userId = str(channel.userId)
      if (userId) {
        tasks.push(
          sendWebPushToUser(db, userId, {
            title:
              event === 'fix_pr_opened' ? 'Draft PR ready' : event === 'fix_failed' ? 'Fix attempt failed' : 'Fix merged',
            body: summary,
            url: details.prUrl,
            tag: `voice-${session.id}`,
          }),
        )
      }

      const outcomes = await Promise.allSettled(tasks)
      const failures = outcomes.filter((o) => o.status === 'rejected')
      if (failures.length > 0) {
        log.warn('voice return delivery partially failed', {
          sessionId: session.id,
          event,
          failed: failures.length,
          total: outcomes.length,
        })
      }

      const patch: Record<string, unknown> = { status: 'notified' }
      if (details.prUrl) patch.pr_url = details.prUrl
      const { error: updErr } = await db.from('voice_intake_sessions').update(patch).eq('id', session.id)
      if (updErr) log.warn('voice session notified update failed', { sessionId: session.id, err: updErr.message })
    }
  } catch (err) {
    log.warn('voice return path failed', { projectId, reportId, event, err: String(err).slice(0, 300) })
  }
}
