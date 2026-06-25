/**
 * FILE: apps/admin/src/lib/statTooltips/releases.ts
 * PURPOSE: Human-readable StatCard tooltips for the Releases snapshot strip.
 */

export type { PlainStatTooltipOpts } from '../usePlainStatTooltips'

import type { MetricTooltipData } from '../../components/ui'
import type { ReleasesStats } from '../../components/releases/ReleasesStatsTypes'
import { metricTip } from '../metricTooltipBuilder'

export function draftsTooltip(stats: ReleasesStats): MetricTooltipData {
  const takeaway =
    stats.draftCount > 0
      ? `${stats.draftCount} release changelog${stats.draftCount === 1 ? '' : 's'} drafted but not published — review and ship when ready.`
      : 'No draft releases — publish a changelog when fixes are ready to communicate.'

  return metricTip(
    'Release changelogs saved as draft (not yet published to users).',
    'Counts releases rows where status equals draft for the active project.',
    takeaway,
    stats.draftCount > 0
      ? { tone: 'info', text: 'Drafts pending — open Drafts tab to review before publish.' }
      : undefined,
  )
}

export function draftsDetail(): string {
  return 'Awaiting publish'
}

export function publishedTooltip(stats: ReleasesStats): MetricTooltipData {
  const takeaway =
    stats.publishedCount > 0
      ? `${stats.publishedCount} changelog${stats.publishedCount === 1 ? '' : 's'} shipped${stats.lastPublishedAt ? ` — last published ${new Date(stats.lastPublishedAt).toLocaleDateString()}.` : '.'}`
      : 'No published releases yet — draft a changelog once fixes land.'

  return metricTip(
    'Release changelogs published and visible to reporters.',
    'Counts releases rows where status equals published for the active project.',
    takeaway,
  )
}

export function publishedDetail(): string {
  return 'Shipped changelogs'
}

export function fixesLinkedTooltip(stats: ReleasesStats): MetricTooltipData {
  const takeaway =
    stats.totalFixesLinked > 0
      ? `${stats.totalFixesLinked} fixed report${stats.totalFixesLinked === 1 ? '' : 's'} linked across all releases — each release aggregates fixed_report_ids.`
      : 'No fixes linked to releases yet — attach fixed reports when drafting a changelog.'

  return metricTip(
    'Total fixed bug reports attached to release changelogs (all time).',
    'Sums the length of fixed_report_ids arrays on every releases row for the active project.',
    takeaway,
  )
}

export function fixesLinkedDetail(): string {
  return 'Across all releases'
}

export function contributorsTooltip(stats: ReleasesStats): MetricTooltipData {
  const takeaway =
    stats.totalContributors > 0
      ? `${stats.totalContributors} unique reporter${stats.totalContributors === 1 ? '' : 's'} credited across releases (${stats.totalCredits} credit row${stats.totalCredits === 1 ? '' : 's'}).`
      : 'No reporter credits yet — credits are created when you ship a release that fixes user-reported bugs.'

  return metricTip(
    'Distinct reporters credited in published or draft releases.',
    'Sums credited_reporter_ids array lengths across releases rows. Credit rows in release_credits track notification status separately.',
    takeaway,
    stats.creditsPending > 0
      ? { tone: 'info', text: `${stats.creditsPending} credit${stats.creditsPending === 1 ? '' : 's'} pending notification.` }
      : undefined,
  )
}

export function contributorsDetail(stats: ReleasesStats): string {
  return `${stats.totalCredits} credit rows`
}

export function fixedReportsTooltip(stats: ReleasesStats): MetricTooltipData {
  const takeaway =
    stats.fixedReportsCount > 0
      ? `${stats.fixedReportsCount} report${stats.fixedReportsCount === 1 ? '' : 's'} marked fixed and ready to include in the next release draft.`
      : 'No fixed reports waiting — resolve bugs on Fixes before drafting a release.'

  return metricTip(
    'Bug reports in fixed status that can be linked into a release changelog.',
    'Counts reports rows where status equals fixed for the active project.',
    takeaway,
    stats.fixedReportsCount > 0
      ? { tone: 'info', text: 'Fixed reports ready — open Draft tab to build the next changelog.' }
      : undefined,
  )
}

export function fixedReportsDetail(): string {
  return 'Ready to draft'
}

export function feedbackTooltip(stats: ReleasesStats): MetricTooltipData {
  const takeaway =
    stats.fulfilledTicketsShipped > 0
      ? `${stats.fulfilledTicketsShipped} feedback ticket${stats.fulfilledTicketsShipped === 1 ? '' : 's'} shipped in a release${stats.openFeedbackTickets > 0 ? `; ${stats.openFeedbackTickets} still open.` : '.'}`
      : stats.openFeedbackTickets > 0
        ? `${stats.openFeedbackTickets} open feedback ticket${stats.openFeedbackTickets === 1 ? '' : 's'} — none shipped in a release yet.`
        : 'No feedback tickets tracked for this project.'

  return metricTip(
    'User feedback tickets fulfilled by shipping them in a published release.',
    'Counts support_tickets rows where shipped_in_release_id is set. Open tickets are status open or in_progress.',
    takeaway,
    stats.openFeedbackTickets > 0
      ? { tone: 'info', text: `${stats.openFeedbackTickets} open ticket${stats.openFeedbackTickets === 1 ? '' : 's'} awaiting resolution.` }
      : undefined,
  )
}

export function feedbackDetail(stats: ReleasesStats): string {
  return `${stats.openFeedbackTickets} open tickets`
}
