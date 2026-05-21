/**
 * FILE: apps/admin/src/lib/statTooltips/settings.ts
 * PURPOSE: Human-readable StatCard tooltips for the Settings snapshot strip.
 */

import type { MetricTooltipData } from '../../components/ui'
import type { SettingsStats } from '../../components/settings/types'
import { metricTip } from '../metricTooltipBuilder'

export function byokTooltip(stats: SettingsStats): MetricTooltipData {
  const takeaway =
    stats.byokKeysConfigured === 0
      ? 'No BYOK keys configured — agents use Mushi platform keys until you add Anthropic, OpenAI, or Firecrawl keys.'
      : `${stats.byokKeysPassing} passing, ${stats.byokKeysFailing} failing, ${stats.byokKeysUntested} untested of ${stats.byokKeysConfigured} configured key${stats.byokKeysConfigured === 1 ? '' : 's'}.`

  return metricTip(
    'Bring-your-own-key credentials stored for LLM and crawl providers.',
    'Counts configured refs on project_settings (Anthropic, OpenAI, Firecrawl) and their last test status — ok, error*, or untested.',
    takeaway,
    stats.byokKeysFailing > 0
      ? { tone: 'warn', text: `${stats.byokKeysFailing} key${stats.byokKeysFailing === 1 ? '' : 's'} failing probe — re-test in BYOK tab.` }
      : stats.byokKeysUntested > 0
        ? { tone: 'info', text: `${stats.byokKeysUntested} key${stats.byokKeysUntested === 1 ? '' : 's'} never probed — run Test connection.` }
        : undefined,
  )
}

export function byokDetail(stats: SettingsStats): string {
  return `${stats.byokKeysPassing} passing · ${stats.byokKeysFailing} failing · ${stats.byokKeysUntested} untested`
}

export function sdkTooltip(stats: SettingsStats): MetricTooltipData {
  const takeaway = stats.sdkConfigEnabled
    ? `Reporter widget config is enabled${stats.sdkConfigUpdatedAt ? ` — last updated ${new Date(stats.sdkConfigUpdatedAt).toLocaleString()}.` : '.'}`
    : 'SDK widget config is off — enable to customize reporter capture chrome and defaults.'

  return metricTip(
    'Whether the in-app reporter widget configuration is enabled for this project.',
    'Reads project_settings.sdk_config_enabled and sdk_config_updated_at for the active project.',
    takeaway,
    !stats.sdkConfigEnabled
      ? { tone: 'info', text: 'SDK widget off — reporters still ingest via API key; widget styling uses defaults.' }
      : undefined,
  )
}

export function sdkDetail(stats: SettingsStats): string {
  return stats.sdkConfigUpdatedAt
    ? `Updated ${new Date(stats.sdkConfigUpdatedAt).toLocaleString()}`
    : 'Reporter capture + widget config'
}

export function routingTooltip(stats: SettingsStats): MetricTooltipData {
  const configured = [stats.slackConfigured && 'Slack', stats.sentryConfigured && 'Sentry'].filter(Boolean)
  const takeaway =
    configured.length > 0
      ? `${configured.join(' and ')} routing configured on the General tab. Full platform integrations live under Act → Integrations.`
      : 'No Slack or Sentry routing on General tab — add webhooks for triage notifications.'

  return metricTip(
    'Lightweight notification routing configured in Settings → General (Slack webhook, Sentry DSN).',
    'Boolean flags on project_settings: slack_webhook_url and sentry_dsn for the active project.',
    takeaway,
  )
}

export function routingDetail(): string {
  return 'General tab — full integrations live under Act → Integrations'
}

export function classifierTooltip(stats: SettingsStats): MetricTooltipData {
  const model = stats.stage2Model?.replace('claude-', '') ?? 'default'
  const takeaway = stats.autofixEnabled
    ? `Stage-2 classifier uses ${model}; autofix is enabled — dispatched fixes can open PRs when repo is connected.`
    : `Stage-2 classifier uses ${model}; autofix is off — triage runs but fixes are not auto-dispatched.`

  return metricTip(
    'LLM model used for stage-2 classification and whether autofix dispatch is enabled.',
    'Reads project_settings.stage2_model and autofix_enabled. Default model applies when stage2_model is null.',
    takeaway,
    !stats.autofixEnabled
      ? { tone: 'info', text: 'Autofix off — enable in General tab once repo integration is ready.' }
      : !stats.githubRepoConfigured
        ? { tone: 'info', text: 'Autofix enabled but no GitHub repo — connect under Integrations.' }
        : undefined,
  )
}

export function classifierDetail(stats: SettingsStats): string {
  return stats.autofixEnabled ? 'Autofix enabled' : 'Autofix off · repo optional'
}
