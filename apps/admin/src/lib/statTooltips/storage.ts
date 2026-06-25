/**
 * FILE: apps/admin/src/lib/statTooltips/storage.ts
 * PURPOSE: Human-readable StatCard tooltips for the Storage snapshot strip.
 */

export type { PlainStatTooltipOpts } from '../usePlainStatTooltips'

import type { MetricTooltipData } from '../../components/ui'
import type { StorageStats } from '../../components/storage/types'
import { metricTip } from '../metricTooltipBuilder'

export function healthyCountTooltip(stats: StorageStats): MetricTooltipData {
  const takeaway =
    stats.failingCount > 0
      ? `${stats.failingCount} project${stats.failingCount === 1 ? '' : 's'} failing storage probes · ${stats.degradedCount} degraded. Open Usage tab for errors.`
      : stats.healthyCount > 0
        ? `${stats.healthyCount}/${stats.configuredCount} configured projects pass health probes.`
        : stats.configuredCount === 0
          ? 'No storage backends configured — use Configure tab for BYOK S3 or Supabase buckets.'
          : 'Configured projects awaiting first successful health probe.'

  return metricTip(
    'Ratio of projects with healthy storage vs configured, plus failing and degraded counts.',
    'healthyCount / configuredCount from storage_health_checks. failing = last probe error; degraded = slow or partial writes.',
    takeaway,
    stats.failingCount > 0
      ? { tone: 'warn', text: `${stats.failingCount} failing · check latestFailureError on Configure tab.` }
      : undefined,
  )
}

export function healthyCountDetail(stats: StorageStats): string {
  return `${stats.failingCount} failing · ${stats.degradedCount} degraded`
}

export function screenshotsTooltip(stats: StorageStats): MetricTooltipData {
  const takeaway =
    stats.activeProjectObjects > 0
      ? `${stats.activeProjectObjects.toLocaleString()} screenshot objects on the active project (${stats.totalObjects.toLocaleString()} cluster-wide).`
      : stats.totalObjects > 0
        ? 'Other projects have storage objects — active project bucket may be empty.'
        : 'No screenshot objects stored yet — appear after QA runs capture evidence.'

  return metricTip(
    'Screenshot/evidence objects in the active project storage bucket.',
    'activeProjectObjects counts objects in the project bucket; totalObjects sums across all projects on the cluster.',
    takeaway,
  )
}

export function screenshotsDetail(stats: StorageStats): string {
  return `${stats.totalObjects.toLocaleString()} total across projects`
}

export function providerTooltip(stats: StorageStats): MetricTooltipData {
  const takeaway =
    stats.activeProjectConfigured
      ? `Custom ${stats.activeProjectProvider} override saved for this project — probes use your bucket credentials.`
      : `Using cluster default Supabase storage (${stats.activeProjectProvider}) — no per-project override.`

  return metricTip(
    'Storage provider for the active project: supabase (default) or custom S3-compatible override.',
    'activeProjectProvider from project storage config. activeProjectConfigured = true when a custom bucket override exists.',
    takeaway,
  )
}

export function providerDetail(stats: StorageStats): string {
  return stats.activeProjectConfigured ? 'Custom override saved' : 'Cluster Supabase default'
}

export function unconfiguredCountTooltip(stats: StorageStats): MetricTooltipData {
  const takeaway =
    stats.unconfiguredCount > 0
      ? `${stats.unconfiguredCount} project${stats.unconfiguredCount === 1 ? '' : 's'} without storage config${stats.neverProbedCount > 0 ? ` · ${stats.neverProbedCount} never probed.` : '.'}`
      : 'Every project has storage configured and probed.'

  return metricTip(
    'Projects missing storage configuration, and how many have never run a health probe.',
    'unconfiguredCount = projects without bucket settings. neverProbedCount = configured but no storage_health_checks row.',
    takeaway,
    stats.neverProbedCount > 0
      ? { tone: 'info', text: `${stats.neverProbedCount} never probed — run health check from Configure tab.` }
      : undefined,
  )
}

export function unconfiguredCountDetail(stats: StorageStats): string {
  return `${stats.neverProbedCount} never probed`
}
