/**
 * FILE: apps/admin/src/lib/statTooltips/feedback.ts
 * PURPOSE: Human-readable StatCard tooltips for the Feedback KPI strip.
 */

import type { MetricTooltipData } from '../../components/ui'
import type { FeedbackStats } from '../../components/feedback/types'
import { metricTip } from '../metricTooltipBuilder'

export function totalTicketsTooltip(stats: FeedbackStats): MetricTooltipData {
  const takeaway =
    stats.totalTickets > 0
      ? `${stats.totalTickets} feedback ticket${stats.totalTickets === 1 ? '' : 's'} submitted all-time for this project.`
      : stats.hasAnyProject
        ? 'No feedback submitted yet — share the in-app feedback link with beta users.'
        : 'Select a project to track product feedback.'

  return metricTip(
    'All feedback tickets ever submitted for the active project.',
    'Counts feedback_tickets rows for the project regardless of status.',
    takeaway,
    stats.totalTickets === 0 && stats.hasAnyProject
      ? { tone: 'info', text: 'Nothing filed yet — encourage beta users to submit feedback.' }
      : undefined,
  )
}

export function totalTicketsDetail(stats: FeedbackStats): string {
  return stats.totalTickets === 0 ? 'Nothing filed yet' : 'All-time submissions'
}

export function activeTicketsTooltip(stats: FeedbackStats): MetricTooltipData {
  const takeaway =
    stats.activeTickets > 0
      ? `${stats.activeTickets} active ticket${stats.activeTickets === 1 ? '' : 's'}${stats.awaitingReply > 0 ? ` (${stats.awaitingReply} awaiting your reply).` : ' — open or in progress.'}`
      : 'No active tickets — inbox is clear.'

  return metricTip(
    'Feedback tickets still open or in progress (not resolved or shipped).',
    'Counts feedback_tickets where status is open or in_progress. awaitingReply is the subset with an operator reply pending.',
    takeaway,
    stats.awaitingReply > 0
      ? { tone: 'warn', text: `${stats.awaitingReply} ticket${stats.awaitingReply === 1 ? '' : 's'} awaiting reply.` }
      : undefined,
  )
}

export function activeTicketsDetail(stats: FeedbackStats): string {
  return stats.awaitingReply > 0 ? `${stats.awaitingReply} with reply` : 'Open + in progress'
}

export function shippedTicketsTooltip(stats: FeedbackStats): MetricTooltipData {
  const takeaway =
    stats.shippedTickets > 0
      ? `${stats.shippedTickets} ticket${stats.shippedTickets === 1 ? '' : 's'} credited to a release — users see shipped status in-app.`
      : 'No tickets linked to releases yet — mark shipped when a fix lands in a release.'

  return metricTip(
    'Feedback tickets marked shipped and linked to a release version.',
    'Counts feedback_tickets with status shipped and a non-null release_id or shipped_at.',
    takeaway,
  )
}

export function shippedTicketsDetail(stats: FeedbackStats): string {
  return stats.shippedTickets > 0 ? 'Linked to releases' : 'None credited yet'
}

export function ticketMixTooltip(stats: FeedbackStats): MetricTooltipData {
  const takeaway =
    stats.bugTickets + stats.featureTickets > 0
      ? `${stats.bugTickets} bug vs ${stats.featureTickets} feature request${stats.featureTickets === 1 ? '' : 's'} — balance roadmap against defect load.`
      : 'No categorized bug/feature tickets yet.'

  return metricTip(
    'Ratio of bug reports to feature requests in the feedback mix (bugs / features).',
    'Counts feedback_tickets by category = bug vs category = feature for the active project.',
    takeaway,
  )
}

export function ticketMixDetail(): string {
  return 'Bugs / features'
}
