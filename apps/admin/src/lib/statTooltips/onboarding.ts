/**
 * FILE: apps/admin/src/lib/statTooltips/onboarding.ts
 * PURPOSE: Human-readable StatCard tooltips for the Onboarding setup snapshot strip.
 */

export type { PlainStatTooltipOpts } from '../usePlainStatTooltips'

import type { MetricTooltipData } from '../../components/ui'
import type { OnboardingStats } from '../../components/onboarding/types'
import { metricTip } from '../metricTooltipBuilder'

export function requiredTooltip(stats: OnboardingStats): MetricTooltipData {
  const takeaway = stats.setupDone
    ? `All ${stats.requiredTotal} required setup steps complete — optional polish remains on Steps tab.`
    : stats.nextStepLabel
      ? `Next required step: ${stats.nextStepLabel} (${stats.requiredComplete}/${stats.requiredTotal} done).`
      : `${stats.requiredComplete}/${stats.requiredTotal} required steps done — finish ingest to unlock the full loop.`

  return metricTip(
    'Progress through the four required onboarding steps (project, API key, first report, SDK heartbeat).',
    'Derived from DB-backed setup checklist state via onboarding/stats — requiredComplete vs requiredTotal.',
    takeaway,
    !stats.setupDone
      ? { tone: 'info', text: `${stats.requiredTotal - stats.requiredComplete} required step${stats.requiredTotal - stats.requiredComplete === 1 ? '' : 's'} remaining.` }
      : undefined,
  )
}

export function requiredDetail(stats: OnboardingStats): string {
  return stats.nextStepLabel ?? 'All required steps done'
}

export function sdkTooltip(stats: OnboardingStats): MetricTooltipData {
  const takeaway = stats.sdkInstalled
    ? 'SDK heartbeat or non-admin test report detected — your app is talking to Mushi.'
    : stats.sdkHostMismatch
      ? `SDK endpoint host (${stats.sdkEndpointHost ?? 'unknown'}) does not match admin host (${stats.adminEndpointHost ?? 'unknown'}) — fix env before production.`
      : stats.hasApiKey
        ? 'API key minted but no SDK heartbeat yet — paste the install snippet and send a test report.'
        : 'Mint an API key first, then install the SDK snippet on your app.'

  return metricTip(
    'Whether the reporter SDK is installed and sending heartbeats or real reports.',
    'True when project_api_keys.last_seen_at is set or a non-mushi-admin platform appears on ingested reports. Host mismatch compares sdk endpoint host to admin URL host.',
    takeaway,
    stats.sdkHostMismatch
      ? { tone: 'warn', text: 'Backend host mismatch — reports may hit the wrong environment.' }
      : !stats.sdkInstalled && stats.hasApiKey
        ? { tone: 'info', text: 'Key ready — install SDK snippet and verify heartbeat.' }
        : undefined,
  )
}

export function sdkDetail(stats: OnboardingStats): string {
  return stats.sdkHostMismatch ? 'Backend mismatch' : stats.sdkInstalled ? 'Heartbeat seen' : 'Install snippet'
}

export function reportsTooltip(stats: OnboardingStats): MetricTooltipData {
  const takeaway =
    stats.reportCount > 0
      ? `${stats.reportCount} report${stats.reportCount === 1 ? '' : 's'} ingested — the intake pipeline is proven end-to-end.`
      : 'No reports yet — send a test report from the SDK or admin test button to validate ingest.'

  return metricTip(
    'Total bug reports ingested for the active project.',
    'Counts reports rows for the active project (recent sample up to 100 for SDK platform detection).',
    takeaway,
    stats.reportCount === 0 && stats.hasApiKey
      ? { tone: 'info', text: 'Key exists but zero reports — trigger a test report from Steps tab.' }
      : undefined,
  )
}

export function reportsDetail(stats: OnboardingStats): string {
  return stats.reportCount > 0 ? 'Pipeline proven' : 'Send test report'
}

export function optionalTooltip(stats: OnboardingStats): MetricTooltipData {
  const takeaway =
    stats.optionalComplete === stats.optionalTotal
      ? `All ${stats.optionalTotal} optional setup steps complete — repo, integrations, and autofix polish done.`
      : `${stats.optionalComplete}/${stats.optionalTotal} optional steps done; ${stats.fixCount} fix${stats.fixCount === 1 ? '' : 'es'} dispatched${stats.mergedFixCount > 0 ? `, ${stats.mergedFixCount} merged.` : '.'}`

  return metricTip(
    'Optional onboarding steps beyond the required four (repo, Sentry, autofix, etc.).',
    'Derived from setup checklist optional steps plus fix_attempts count and merged fixes for the active project.',
    takeaway,
    stats.fixCount === 0 && stats.setupDone
      ? { tone: 'info', text: 'Required setup done — dispatch a fix to exercise the Do stage.' }
      : undefined,
  )
}

export function optionalDetail(stats: OnboardingStats): string {
  return `${stats.fixCount} fix${stats.fixCount === 1 ? '' : 'es'} dispatched`
}
