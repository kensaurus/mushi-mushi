/**
 * FILE: apps/admin/src/lib/notificationsView.ts
 * PURPOSE: Pure view rules for Reporter updates (/notifications), round-2
 *          review 2026-11-18:
 *          - a channel switched OFF reads "Off" in grey, never a green
 *            "Ready to send";
 *          - one status row for the page (the banner and the summary card said
 *            the same count twice), with the one action that fits;
 *          - Setup prerequisites carry a met / not met / not seen mark;
 *          - a Sent row always has a title, and its meta stays short.
 */

import type { RunStatus } from '../components/signal/StatusMark'
import type { NotificationStats, ReporterNotification } from '../components/notifications/types'

export type ChannelBadge =
  | { kind: 'server_missing'; label: 'Not set up on the server' }
  | { kind: 'off'; label: 'Off' }
  | { kind: 'ready'; label: 'Ready to send' }

/** The badge beside an email / push switch: server first, then the switch. */
export function reporterChannelBadge(enabled: boolean, provider: 'configured' | 'not_configured'): ChannelBadge {
  if (provider === 'not_configured') return { kind: 'server_missing', label: 'Not set up on the server' }
  if (!enabled) return { kind: 'off', label: 'Off' }
  return { kind: 'ready', label: 'Ready to send' }
}

export type StatusAction = { label: string; tab: 'inbox' | 'setup'; primary: boolean } | null

/** The status row's one action: turn updates on, set up, or open the unopened ones. */
export function notificationsStatusAction(stats: Pick<NotificationStats, 'topPriority' | 'unread'>): StatusAction {
  if (stats.topPriority === 'disabled') return { label: 'Turn on reporter updates', tab: 'setup', primary: true }
  if (stats.topPriority === 'no_messages') return { label: 'Open Setup', tab: 'setup', primary: true }
  if (stats.unread > 0) return { label: 'Review inbox', tab: 'inbox', primary: false }
  return null
}

/**
 * The status row's sentence. The counts are the row's numbers (Sent, Not
 * opened), so the sentence never says them again.
 */
export function notificationsStatusSentence(
  stats: Pick<NotificationStats, 'notificationsEnabled' | 'total' | 'unread'>,
  lastRelative: string | null,
): string {
  if (!stats.notificationsEnabled) return 'Reporter updates are off: the people who report bugs do not hear back.'
  if (stats.total === 0) return 'No updates sent to reporters yet.'
  const last = lastRelative ? `Last sent ${lastRelative}.` : 'Sent to reporters.'
  return stats.unread === 0 ? `${last} All opened.` : `${last} Reporters see unopened ones the next time they open the widget.`
}

export interface SetupCheck {
  id: string
  status: RunStatus
  /** Short state word beside the mark. */
  word: string
  text: string
}

/**
 * The reporter loop's prerequisites beyond the on/off switch (the switch says
 * its own state), with a mark each. "SDK polls" is only
 * proven when a reporter opened an update (read_at set): sent but none opened
 * is "not seen yet" (hollow), never a pass and never a failure.
 */
export function reporterSetupChecks(stats: Pick<NotificationStats, 'total' | 'unread'>): SetupCheck[] {
  const opened = stats.total - stats.unread
  return [
    {
      id: 'sdk-polls',
      status: opened > 0 ? 'passed' : 'idle',
      word: opened > 0 ? 'Seen' : 'Not seen yet',
      text: 'The SDK polls GET /v1/notifications with the reporter token (seen when a reporter opens an update)',
    },
  ]
}

const TYPE_TITLE: Record<string, string> = {
  classified: 'Bug diagnosed',
  fixed: 'Bug fixed',
  fix_failed: 'Fix attempt failed',
  reward: 'Reward',
  comment_reply: 'Reply',
}

/** A Sent row's title: the message, else the type in words (a bare "—" said nothing). */
export function sentRowTitle(n: Pick<ReporterNotification, 'message' | 'notification_type'>): string {
  const msg = n.message?.trim()
  if (msg) return msg
  return TYPE_TITLE[n.notification_type] ?? n.notification_type.replace(/_/g, ' ')
}
