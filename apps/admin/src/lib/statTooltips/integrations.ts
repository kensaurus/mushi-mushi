/**
 * FILE: apps/admin/src/lib/statTooltips/integrations.ts
 * PURPOSE: Human-readable StatCard tooltips for the Integrations snapshot strip.
 */

export type { PlainStatTooltipOpts } from '../usePlainStatTooltips'

import type { MetricTooltipData } from '../../components/ui'
import type { IntegrationStats } from '../../components/integrations/types'
import { metricTip } from '../metricTooltipBuilder'

export function platformTooltip(stats: IntegrationStats): MetricTooltipData {
  const takeaway =
    stats.platformConnected === stats.platformTotal
      ? `All ${stats.platformTotal} platform integrations have required credentials configured.`
      : stats.platformConnected === 0
        ? 'No platform credentials set — connect Sentry, Langfuse, GitHub, Cursor Cloud, or Claude Code to unlock agents.'
        : `${stats.platformConnected} of ${stats.platformTotal} platform integrations configured — finish the rest to unlock full agent coverage.`

  return metricTip(
    'How many required platform integrations have all mandatory credential fields set.',
    'Checks project_settings for Sentry, Langfuse, GitHub, Cursor Cloud, and Claude Code required field groups. platformTotal is the count of platform kinds.',
    takeaway,
    stats.platformConnected < stats.platformTotal
      ? {
          tone: 'info',
          text: `${stats.platformTotal - stats.platformConnected} platform${stats.platformTotal - stats.platformConnected === 1 ? '' : 's'} still missing credentials.`,
        }
      : undefined,
  )
}

export function platformDetail(): string {
  return 'Required credentials set'
}

export function healthyTooltip(stats: IntegrationStats): MetricTooltipData {
  const takeaway =
    stats.platformHealthy > 0
      ? `${stats.platformHealthy} integration${stats.platformHealthy === 1 ? '' : 's'} passed the latest health probe with status ok.`
      : 'No healthy probes yet — run Test connection after saving credentials.'

  return metricTip(
    'Platform integrations whose most recent health probe returned ok.',
    'Latest row per kind in integration_health_history for the active project; status ok counts as healthy.',
    takeaway,
    stats.lastProbeAt
      ? {
          tone: 'info',
          text: `Last probe ${new Date(stats.lastProbeAt).toLocaleString()}.`,
        }
      : undefined,
  )
}

export function healthyDetail(): string {
  return 'Latest probe status ok'
}

export function routingTooltip(stats: IntegrationStats): MetricTooltipData {
  const takeaway =
    stats.routingActive > 0
      ? `${stats.routingActive} routing destination${stats.routingActive === 1 ? '' : 's'} active${stats.routingPaused > 0 ? `; ${stats.routingPaused} paused.` : '.'}`
      : stats.routingTotal > 0
        ? `${stats.routingTotal} routing destination${stats.routingTotal === 1 ? '' : 's'} configured but none active — enable under Routing tab.`
        : 'No routing destinations — add Slack, Linear, or other Act-stage integrations to notify your team.'

  return metricTip(
    'Outbound routing integrations (Slack app, Linear, Jira, etc.) that are currently active.',
    'Counts project_integrations rows where is_active is true (routingActive) or false (routingPaused) for the active project.',
    takeaway,
    stats.routingPaused > 0
      ? { tone: 'info', text: `${stats.routingPaused} destination${stats.routingPaused === 1 ? '' : 's'} paused — resume to restore notifications.` }
      : undefined,
  )
}

export function routingDetail(stats: IntegrationStats): string {
  return stats.routingPaused > 0 ? `${stats.routingPaused} paused` : 'Active destinations'
}

export function failingTooltip(stats: IntegrationStats): MetricTooltipData {
  const takeaway =
    stats.platformDown > 0
      ? `${stats.platformDown} integration${stats.platformDown === 1 ? '' : 's'} failed the latest probe — fix credentials or network and re-test.`
      : 'No integrations reporting down — latest probes are ok, degraded, or not yet run.'

  return metricTip(
    'Platform integrations whose latest health probe status is down.',
    'Latest integration_health_history row per kind where status equals down for the active project.',
    takeaway,
    stats.platformDown > 0
      ? { tone: 'warn', text: 'Fix credentials or re-test — down probes block reliable agent runs.' }
      : undefined,
  )
}

export function failingDetail(stats: IntegrationStats): string {
  return stats.platformDown > 0 ? 'Fix credentials or re-test' : 'No down probes'
}
