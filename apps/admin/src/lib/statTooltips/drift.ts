/**
 * FILE: apps/admin/src/lib/statTooltips/drift.ts
 * PURPOSE: Human-readable StatCard tooltips for the Drift DRIFT SNAPSHOT strip.
 */

import type { MetricTooltipData } from '../../components/ui'
import type { DriftStats } from '../../components/drift/DriftStatsTypes'
import { metricTip } from '../metricTooltipBuilder'
import type { PlainStatTooltipOpts } from '../usePlainStatTooltips'

type Opts = PlainStatTooltipOpts

export function openFindingsTooltip(stats: DriftStats, opts: Opts = {}): MetricTooltipData {
  const plain = opts.plainLanguage ?? false
  const takeaway =
    stats.openFindings > 0
      ? `${stats.openFindings} open drift finding${stats.openFindings === 1 ? '' : 's'} (${stats.dismissedFindings} dismissed). Scan Findings tab for contract/API gaps.`
      : stats.hasAnyProject
        ? 'No open drift findings — scanned surfaces match the last contract snapshot.'
        : 'Select a project to run drift scans.'

  return metricTip(
    'Contract or API drift findings that are still open (not dismissed).',
    'Counts drift_findings rows with status open for the active project. dismissedFindings is the all-time dismissed subset.',
    takeaway,
    stats.openFindings > 0
      ? {
          tone: 'warn',
          text: plain
            ? `${stats.openFindings} open finding${stats.openFindings === 1 ? '' : 's'} — review before the next deploy.`
            : `${stats.openFindings} open finding${stats.openFindings === 1 ? '' : 's'} — triage before the next deploy.`,
        }
      : undefined,
  )
}

export function openFindingsDetail(stats: DriftStats): string {
  return `${stats.dismissedFindings} dismissed`
}

export function criticalOpenTooltip(stats: DriftStats, opts: Opts = {}): MetricTooltipData {
  const plain = opts.plainLanguage ?? false
  const takeaway =
    stats.criticalOpen > 0
      ? plain
        ? `${stats.criticalOpen} critical open finding${stats.criticalOpen === 1 ? '' : 's'} — breaking contract changes need immediate review.`
        : `${stats.criticalOpen} critical open finding${stats.criticalOpen === 1 ? '' : 's'} — breaking contract changes need immediate triage.`
      : 'No critical open drift findings.'

  return metricTip(
    'Open drift findings classified as critical severity (breaking contract or auth surface).',
    'Counts open drift_findings where severity = critical for the active project.',
    takeaway,
    stats.criticalOpen > 0
      ? {
          tone: 'warn',
          text: plain
            ? `${stats.criticalOpen} critical finding${stats.criticalOpen === 1 ? '' : 's'} — needs review.`
            : `${stats.criticalOpen} critical finding${stats.criticalOpen === 1 ? '' : 's'} — needs triage.`,
        }
      : undefined,
  )
}

export function criticalOpenDetail(opts: Opts = {}): string {
  const plain = opts.plainLanguage ?? false
  return plain ? 'Needs review' : 'Needs triage'
}

export function warnOpenTooltip(stats: DriftStats): MetricTooltipData {
  const takeaway =
    stats.warnOpen > 0
      ? `${stats.warnOpen} warning-level finding${stats.warnOpen === 1 ? '' : 's'} (${stats.infoOpen} info). Address warnings before they become release blockers.`
      : stats.infoOpen > 0
        ? `${stats.infoOpen} informational finding${stats.infoOpen === 1 ? '' : 's'} only — no warnings open.`
        : 'No warning- or info-level open findings.'

  return metricTip(
    'Open drift findings at warning severity, with info-level count in detail.',
    'Counts open drift_findings where severity = warn (warnOpen) or info (infoOpen).',
    takeaway,
    stats.warnOpen > 0
      ? { tone: 'info', text: `${stats.warnOpen} warning${stats.warnOpen === 1 ? '' : 's'} open — review scanner output.` }
      : undefined,
  )
}

export function warnOpenDetail(stats: DriftStats): string {
  return `${stats.infoOpen} info`
}

export function snapshotsTooltip(stats: DriftStats): MetricTooltipData {
  const takeaway =
    stats.snapshotCount > 0
      ? `${stats.snapshotCount} contract snapshot${stats.snapshotCount === 1 ? '' : 's'} captured${stats.lastSnapshotAt ? ' — latest drives edge comparison.' : '.'}`
      : stats.hasAnyProject
        ? 'No snapshots yet — run the scanner once to capture the baseline contract graph.'
        : 'Select a project to capture drift snapshots.'

  return metricTip(
    'How many contract graph snapshots have been stored for comparison over time.',
    'Counts drift_snapshots rows for the active project. lastSnapshotAt is created_at of the newest snapshot.',
    takeaway,
    stats.snapshotCount === 0 && stats.hasAnyProject
      ? { tone: 'info', text: 'No snapshots — run Scanner tab to establish a baseline.' }
      : undefined,
  )
}

export function snapshotsDetail(stats: DriftStats): string {
  return stats.lastSnapshotAt ? 'Latest captured' : 'None yet'
}

export function contractEdgesTooltip(stats: DriftStats): MetricTooltipData {
  const takeaway =
    stats.lastSnapshotEdges > 0
      ? `${stats.lastSnapshotEdges.toLocaleString()} contract edges in the latest snapshot${stats.edgeCountDelta != null ? ` (${stats.edgeCountDelta >= 0 ? '+' : ''}${stats.edgeCountDelta} vs prior).` : '.'}`
      : 'Latest snapshot has no edges — scanner may not have finished indexing routes.'

  return metricTip(
    'Number of API/contract edges in the most recent drift snapshot, and delta vs the prior snapshot.',
    'lastSnapshotEdges reads edge count from the newest drift_snapshots row. edgeCountDelta = current edges − previous snapshot edges.',
    takeaway,
    stats.edgeCountDelta != null && stats.edgeCountDelta > 50
      ? { tone: 'info', text: `+${stats.edgeCountDelta} new edges — verify intentional API expansion.` }
      : undefined,
  )
}

export function contractEdgesDetail(stats: DriftStats): string {
  return stats.edgeCountDelta != null
    ? `${stats.edgeCountDelta >= 0 ? '+' : ''}${stats.edgeCountDelta} vs prior`
    : '—'
}

export function surfacesWithFindingsTooltip(stats: DriftStats): MetricTooltipData {
  const takeaway =
    stats.surfacesWithFindings > 0
      ? `${stats.surfacesWithFindings} surface${stats.surfacesWithFindings === 1 ? '' : 's'} still ha${stats.surfacesWithFindings === 1 ? 's' : 've'} open drift gaps — filter Findings by surface to batch-fix.`
      : 'No surfaces with open findings — drift is contained.'

  return metricTip(
    'Distinct API or UI surfaces that still have at least one open drift finding.',
    'Counts unique surface identifiers on open drift_findings rows (route prefix, service name, or OpenAPI tag).',
    takeaway,
    stats.surfacesWithFindings > 0
      ? { tone: 'warn', text: `${stats.surfacesWithFindings} surface${stats.surfacesWithFindings === 1 ? '' : 's'} with open gaps.` }
      : undefined,
  )
}

export function surfacesWithFindingsDetail(): string {
  return 'With open gaps'
}
