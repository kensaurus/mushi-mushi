/**
 * FILE: apps/admin/src/lib/statTooltips/anomalies.ts
 * PURPOSE: Human-readable StatCard tooltips for the Anomalies ANOMALIES SNAPSHOT strip.
 */

export type { PlainStatTooltipOpts } from '../usePlainStatTooltips'

import type { MetricTooltipData } from '../../components/ui'
import type { AnomaliesStats } from '../../components/anomalies/AnomaliesStatsTypes'
import { metricTip } from '../metricTooltipBuilder'

export function openAnomaliesTooltip(stats: AnomaliesStats): MetricTooltipData {
  const takeaway =
    stats.openAnomalies > 0
      ? `${stats.openAnomalies} open finding${stats.openAnomalies === 1 ? '' : 's'} (${stats.confirmedAnomalies} confirmed). Review Detect tab for score trends and dismiss noise.`
      : stats.hasAnyProject
        ? 'No open anomalies — metric baselines look stable for the active project.'
        : 'Select a project to track anomaly detection.'

  return metricTip(
    'Anomaly findings that are still open (not dismissed or auto-resolved).',
    'Counts anomaly_findings rows with status open for the active project. confirmedAnomalies is the subset marked confirmed by an operator or detector.',
    takeaway,
    stats.openAnomalies > 0
      ? { tone: 'warn', text: `${stats.openAnomalies} open anomal${stats.openAnomalies === 1 ? 'y' : 'ies'} — triage before they auto-report.` }
      : undefined,
  )
}

export function openAnomaliesDetail(stats: AnomaliesStats): string {
  return `${stats.confirmedAnomalies} confirmed`
}

export function releaseRegressionTooltip(stats: AnomaliesStats): MetricTooltipData {
  const takeaway =
    stats.releaseRegressionOpen > 0
      ? `${stats.releaseRegressionOpen} open release-regression anomal${stats.releaseRegressionOpen === 1 ? 'y' : 'ies'} — metrics spiked after a deploy. Check Releases for the suspect build.`
      : 'No open release-regression anomalies — recent deploys have not triggered critical metric spikes.'

  return metricTip(
    'Open anomalies tagged as release regressions (post-deploy metric spikes).',
    'Counts open anomaly_findings where kind or severity indicates a release regression (critical severity, linked release_id).',
    takeaway,
    stats.releaseRegressionOpen > 0
      ? { tone: 'warn', text: 'Release regression detected — correlate with the latest deploy on Releases.' }
      : undefined,
  )
}

export function releaseRegressionDetail(): string {
  return 'Open · critical'
}

export function highScoreTooltip(stats: AnomaliesStats): MetricTooltipData {
  const takeaway =
    stats.highScoreOpen > 0
      ? `${stats.highScoreOpen} open finding${stats.highScoreOpen === 1 ? '' : 's'} exceed the detector score threshold — prioritize before auto-report fires.`
      : 'No open findings above the high-score threshold.'

  return metricTip(
    'Open anomalies whose detector score exceeds the configured high threshold.',
    'Counts open anomaly_findings where score ≥ project threshold (typically z-score or percentile-based).',
    takeaway,
    stats.highScoreOpen > 0
      ? { tone: 'warn', text: `${stats.highScoreOpen} high-score finding${stats.highScoreOpen === 1 ? '' : 's'} — review in Anomalies tab.` }
      : undefined,
  )
}

export function highScoreDetail(): string {
  return 'Above threshold'
}

export function autoReportedTooltip(stats: AnomaliesStats): MetricTooltipData {
  const takeaway =
    stats.autoReported > 0
      ? `${stats.autoReported} anomal${stats.autoReported === 1 ? 'y was' : 'ies were'} auto-linked to bug reports — check Reports for downstream triage.`
      : 'No anomalies have auto-created reports yet — detector may be in observe-only mode or findings are below auto-report threshold.'

  return metricTip(
    'Anomaly findings that automatically opened a linked bug report.',
    'Counts anomaly_findings with a non-null linked report_id (auto-report pipeline).',
    takeaway,
    stats.autoReported > 0
      ? { tone: 'info', text: `${stats.autoReported} auto-reported — verify severity on Reports before dispatching fixes.` }
      : undefined,
  )
}

export function autoReportedDetail(): string {
  return 'Linked reports'
}

export function metricPointsTooltip(stats: AnomaliesStats): MetricTooltipData {
  const takeaway =
    stats.metricPointCount > 0
      ? `${stats.metricPointCount.toLocaleString()} metric points across ${stats.distinctMetrics} series — enough signal for baseline detection.`
      : stats.hasAnyProject
        ? 'No metric points ingested yet — connect telemetry or run detection once to populate baselines.'
        : 'Select a project to ingest metric time series.'

  return metricTip(
    'Total metric data points stored for anomaly baselines, and how many distinct metric series they span.',
    'metricPointCount sums metric_points rows; distinctMetrics counts unique (metric_name, labels) series for the active project.',
    takeaway,
    stats.metricPointCount === 0 && stats.hasAnyProject
      ? { tone: 'info', text: 'No metric points — open Metrics tab to confirm ingest.' }
      : undefined,
  )
}

export function metricPointsDetail(stats: AnomaliesStats): string {
  return `${stats.distinctMetrics} series`
}

export function dismissedAnomaliesTooltip(stats: AnomaliesStats): MetricTooltipData {
  const takeaway =
    stats.dismissedAnomalies > 0
      ? `${stats.dismissedAnomalies} finding${stats.dismissedAnomalies === 1 ? '' : 's'} dismissed as noise or expected — reopen from history if the pattern returns.`
      : 'No dismissed findings yet — every detected anomaly is still open or confirmed.'

  return metricTip(
    'Anomaly findings closed by an operator as false positive or expected variance.',
    'Counts anomaly_findings rows with status dismissed for the active project (all time).',
    takeaway,
  )
}

export function dismissedAnomaliesDetail(): string {
  return 'Closed findings'
}
