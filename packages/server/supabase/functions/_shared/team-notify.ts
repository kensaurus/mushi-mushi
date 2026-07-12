/**
 * FILE: _shared/team-notify.ts
 * PURPOSE: Team-channel (Slack / Discord / Teams) notifications for the FIX
 * lifecycle — PR opened, fix failed, fix merged.
 *
 * The report-created/classified card already goes out from classify-report
 * and fast-filter, and `reports.slack_message_ts` is stored precisely so
 * follow-ups can thread onto it — but until this module nothing ever posted
 * those follow-ups (the threading flow documented in _shared/slack.ts was
 * aspirational). Result: teams saw "new critical bug" in Slack and then
 * silence, even when Mushi opened and merged a fix.
 *
 * Channel resolution mirrors classify-report: per-project
 * `project_settings.slack_channel_id` (bot path, threaded) with
 * `slack_webhook_url` fallback, plus `discord_webhook_url` and
 * `teams_webhook_url`. Everything here is fail-soft — callers fire-and-forget.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { log } from './logger.ts'
import { sendBotMessage, sendSlackText } from './slack.ts'
import { sendDiscordNotification } from './discord.ts'
import { sendTeamsNotification } from './teams.ts'

const teamNotifyLog = log.child('team-notify')

export type TeamFixEvent = 'fix_dispatched' | 'fix_pr_opened' | 'fix_failed' | 'fix_merged'

/** notification_prefs keys (NotificationPrefsMatrix): `false` suppresses, absent = enabled. */
const EVENT_PREF_KEY: Record<TeamFixEvent, string> = {
  fix_dispatched: 'fix.dispatched',
  fix_pr_opened: 'fix.pr_opened',
  fix_failed: 'fix.failed',
  fix_merged: 'fix.merged',
}

export interface TeamFixDetails {
  prUrl?: string | null
  prNumber?: number | null
  branch?: string | null
  error?: string | null
  failureCategory?: string | null
}

const EVENT_EMOJI: Record<TeamFixEvent, string> = {
  fix_dispatched: '\u{1F680}', // 🚀
  fix_pr_opened: '\u{1F527}', // 🔧
  fix_failed: '❌', // ❌
  fix_merged: '✅', // ✅
}

/**
 * Escape Slack mrkdwn control characters in interpolated values (report
 * summaries, error strings) so user content can't inject links/formatting.
 * Our own `<url|label>` markup is added after escaping.
 */
function escapeMrkdwn(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function eventText(
  event: TeamFixEvent,
  reportSummary: string,
  details: TeamFixDetails,
  reportUrl: string | null,
): string {
  const emoji = EVENT_EMOJI[event]
  const summary = escapeMrkdwn(reportSummary)
  const pr = details.prUrl
    ? details.prNumber
      ? `<${details.prUrl}|PR #${details.prNumber}>`
      : `<${details.prUrl}|draft PR>`
    : null
  switch (event) {
    case 'fix_dispatched':
      return `${emoji} Auto-fix dispatched for *${summary}*${reportUrl ? ` — <${reportUrl}|follow along>` : ''}`
    case 'fix_pr_opened':
      return `${emoji} Fix ${pr ?? 'PR'} opened for *${summary}*${reportUrl ? ` — <${reportUrl}|review in console>` : ''}`
    case 'fix_failed':
      return `${emoji} Fix attempt failed for *${summary}*${details.failureCategory ? ` (${escapeMrkdwn(details.failureCategory)})` : ''}${details.error ? `\n\`\`\`${escapeMrkdwn(details.error.slice(0, 300))}\`\`\`` : ''}${reportUrl ? `\n<${reportUrl}|Open report>` : ''}`
    case 'fix_merged':
      return `${emoji} Fix merged for *${summary}*${pr ? ` — ${pr}` : ''}`
  }
}

/** Strip Slack mrkdwn link/bold syntax for Discord/Teams plain-ish text. */
function toPlainText(slackText: string): string {
  return slackText
    .replace(/<([^|>]+)\|([^>]+)>/g, '$2 ($1)')
    .replace(/\*([^*]+)\*/g, '$1')
}

/**
 * Post a fix-lifecycle update to every team channel the project has
 * configured. Threads onto the report's original Slack card when the bot
 * path stored a `slack_message_ts`.
 */
export async function notifyTeamFixEvent(
  db: SupabaseClient,
  projectId: string,
  reportId: string,
  event: TeamFixEvent,
  details: TeamFixDetails = {},
): Promise<void> {
  try {
    const [{ data: settings }, { data: report }, { data: project }] = await Promise.all([
      db
        .from('project_settings')
        .select('slack_channel_id, slack_webhook_url, discord_webhook_url, teams_webhook_url, notification_prefs')
        .eq('project_id', projectId)
        .maybeSingle(),
      db
        .from('reports')
        .select('summary, category, severity, slack_message_ts')
        .eq('id', reportId)
        .eq('project_id', projectId)
        .maybeSingle(),
      db.from('projects').select('name').eq('id', projectId).maybeSingle(),
    ])

    const s = settings as {
      slack_channel_id?: string | null
      slack_webhook_url?: string | null
      discord_webhook_url?: string | null
      teams_webhook_url?: string | null
      notification_prefs?: Record<string, unknown> | null
    } | null
    if (!s?.slack_channel_id && !s?.slack_webhook_url && !s?.discord_webhook_url && !s?.teams_webhook_url) {
      return
    }

    // Honor the console's per-event toggles (same convention as qa-story-runner:
    // explicit false suppresses, absent means enabled).
    if ((s.notification_prefs ?? {})[EVENT_PREF_KEY[event]] === false) {
      teamNotifyLog.info('team fix notification suppressed by notification_prefs', {
        projectId,
        event,
      })
      return
    }

    const r = report as {
      summary?: string | null
      category?: string | null
      severity?: string | null
      slack_message_ts?: string | null
    } | null
    const projectName = (project as { name?: string | null } | null)?.name ?? 'project'
    const summary = r?.summary?.trim() || `report ${reportId.slice(0, 8)}…`
    const adminBase = Deno.env.get('ADMIN_BASE_URL')?.replace(/\/$/, '') ?? null
    const reportUrl = adminBase ? `${adminBase}/reports/${encodeURIComponent(reportId)}` : null
    const text = eventText(event, summary, details, reportUrl)

    const tasks: Promise<unknown>[] = []

    if (s.slack_channel_id) {
      tasks.push(
        sendBotMessage({
          channel: s.slack_channel_id,
          text,
          threadTs: r?.slack_message_ts ?? null,
          db,
          projectId,
        }).then((res) => {
          // Bot path unavailable (no token) — fall back to the webhook.
          if (!res.ok && s.slack_webhook_url) return sendSlackText(s.slack_webhook_url, text)
        }),
      )
    } else if (s.slack_webhook_url) {
      tasks.push(sendSlackText(s.slack_webhook_url, text))
    }

    if (s.discord_webhook_url) {
      tasks.push(
        sendDiscordNotification(s.discord_webhook_url, {
          projectName,
          category: r?.category ?? 'bug',
          severity: r?.severity ?? undefined,
          summary: toPlainText(text),
          reportId,
          reportUrl: reportUrl ?? undefined,
        }),
      )
    }

    if (s.teams_webhook_url) {
      tasks.push(
        sendTeamsNotification(s.teams_webhook_url, {
          projectName,
          category: r?.category ?? 'bug',
          severity: r?.severity ?? undefined,
          summary: toPlainText(text),
          reportId,
          reportUrl: reportUrl ?? undefined,
        }),
      )
    }

    await Promise.all(tasks)
  } catch (err) {
    teamNotifyLog.warn('team fix notification failed', {
      projectId,
      reportId,
      event,
      err: String(err),
    })
  }
}
