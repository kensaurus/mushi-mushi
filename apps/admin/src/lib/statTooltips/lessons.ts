/**
 * FILE: apps/admin/src/lib/statTooltips/lessons.ts
 * PURPOSE: Human-readable StatCard tooltips for the Lessons SNAPSHOT strip.
 */

import type { MetricTooltipData } from '../../components/ui'
import type { LessonsStats } from '../../components/lessons/LessonsStatsTypes'
import { metricTip } from '../metricTooltipBuilder'

export function activeLessonsTooltip(stats: LessonsStats): MetricTooltipData {
  const takeaway =
    stats.activeLessons > 0
      ? `${stats.activeLessons} active lesson rule${stats.activeLessons === 1 ? '' : 's'} inject into PR review${stats.retiredLessons > 0 ? ` · ${stats.retiredLessons} retired.` : '.'}${stats.lastLessonReinforcedAt ? ' Last reinforced recently.' : ''}`
      : stats.candidateClusters > 0
        ? `No promoted lessons yet — ${stats.candidateClusters} candidate cluster${stats.candidateClusters === 1 ? '' : 's'} forming. Promote from Clusters tab.`
        : 'No lessons or clusters yet — submit bug reports so mistake memory can cluster.'

  return metricTip(
    'Promoted learning rules currently active (not retired) for PR context injection.',
    'Counts lessons rows where project_id matches and retired_at is null.',
    takeaway,
    stats.activeLessons === 0 && stats.candidateClusters > 0
      ? { tone: 'info', text: 'Promote a high-coherence cluster to create your first lesson rule.' }
      : undefined,
  )
}

export function activeLessonsDetail(stats: LessonsStats): string {
  return `${stats.retiredLessons} retired`
}

export function criticalLessonsTooltip(stats: LessonsStats): MetricTooltipData {
  const takeaway =
    stats.criticalLessons > 0
      ? `${stats.criticalLessons} critical-severity lesson${stats.criticalLessons === 1 ? '' : 's'} active — review wording on Lessons tab before they block merges.`
      : 'No critical lessons — warn/info rules still apply during PR review.'

  return metricTip(
    'Active lessons tagged critical severity — highest priority in PR review injection.',
    'Counts lessons rows with severity critical, retired_at null, for the active project.',
    takeaway,
    stats.criticalLessons > 0
      ? { tone: 'warn', text: `${stats.criticalLessons} critical rule${stats.criticalLessons === 1 ? '' : 's'} — verify anti-patterns before every merge.` }
      : undefined,
  )
}

export function criticalLessonsDetail(): string {
  return 'PR review rules'
}

export function candidatesTooltip(stats: LessonsStats): MetricTooltipData {
  const takeaway =
    stats.candidateClusters > 0
      ? `${stats.candidateClusters} candidate cluster${stats.candidateClusters === 1 ? '' : 's'}${stats.readyToPromote > 0 ? ` · ${stats.readyToPromote} ready (≥3 reports)` : ''} — promote when judge coherence is high.`
      : 'No candidate clusters — vector clustering runs when similar bug reports accumulate.'

  return metricTip(
    'Mistake clusters awaiting promotion into the lesson library.',
    'Counts mistake_clusters rows with status candidate. readyToPromote is candidates with cluster_size ≥ 3.',
    takeaway,
    stats.readyToPromote > 0
      ? { tone: 'info', text: `${stats.readyToPromote} cluster${stats.readyToPromote === 1 ? '' : 's'} ready to promote — open Clusters tab.` }
      : undefined,
  )
}

export function candidatesDetail(stats: LessonsStats): string {
  return `${stats.readyToPromote} ready`
}

export function promotedClustersTooltip(stats: LessonsStats): MetricTooltipData {
  const takeaway =
    stats.promotedClusters > 0
      ? `${stats.promotedClusters} cluster${stats.promotedClusters === 1 ? '' : 's'} already promoted into lesson rules.`
      : 'No clusters promoted yet — promote candidates once coherence and size thresholds are met.'

  return metricTip(
    'Mistake clusters that have been promoted into the lesson library.',
    'Counts mistake_clusters rows with status promoted for the active project.',
    takeaway,
  )
}

export function promotedClustersDetail(): string {
  return 'Already in library'
}

export function reportsClusteredTooltip(stats: LessonsStats): MetricTooltipData {
  const takeaway =
    stats.totalClusterReports > 0
      ? `${stats.totalClusterReports} bug report${stats.totalClusterReports === 1 ? '' : 's'} grouped across all clusters (sum of cluster_size).`
      : 'No reports clustered yet — intake from Reports feeds mistake_clusters over time.'

  return metricTip(
    'Total bug reports grouped into mistake clusters (all cluster sizes summed).',
    'Sums mistake_clusters.cluster_size for every cluster on the project, regardless of status.',
    takeaway,
  )
}

export function reportsClusteredDetail(): string {
  return 'Across all clusters'
}

export function highCoherenceTooltip(stats: LessonsStats): MetricTooltipData {
  const takeaway =
    stats.highCoherenceCandidates > 0
      ? `${stats.highCoherenceCandidates} candidate${stats.highCoherenceCandidates === 1 ? '' : 's'} with ≥75% judge coherence and ≥3 reports — strong promotion candidates.`
      : 'No high-coherence candidates yet — need ≥3 reports and judge_coherence_score ≥ 0.75.'

  return metricTip(
    'Candidate clusters that meet size and coherence thresholds for promotion.',
    'Counts mistake_clusters where status is candidate, cluster_size ≥ 3, and judge_coherence_score ≥ 0.75.',
    takeaway,
    stats.highCoherenceCandidates > 0
      ? { tone: 'info', text: `${stats.highCoherenceCandidates} high-coherence cluster${stats.highCoherenceCandidates === 1 ? '' : 's'} — review on Clusters tab.` }
      : undefined,
  )
}

export function highCoherenceDetail(): string {
  return '≥75% · ≥3 reports'
}
