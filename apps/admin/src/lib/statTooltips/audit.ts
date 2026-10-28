/**
 * FILE: apps/admin/src/lib/statTooltips/audit.ts
 * PURPOSE: Human-readable StatCard tooltips for the Audit breakdown tab.
 */

import type { MetricTooltipData } from '../../components/ui'
import type { AuditStats } from '../../components/audit/types'
import { metricTip } from '../metricTooltipBuilder'

export function humanActorsTooltip(stats: AuditStats): MetricTooltipData {
  const takeaway =
    stats.humanCount24h > 0
      ? `${stats.humanCount24h} human-actor event${stats.humanCount24h === 1 ? '' : 's'} in 24h — people acting in the console, CLI or Slack.`
      : 'No human-attributed audit events in the last 24h.'

  return metricTip(
    'Audit events written by people (console, CLI or Slack) in the last 24 hours.',
    'Exact count of audit_logs where actor_type is user, console, cli or slack — the same filter the Log tab applies.',
    takeaway,
  )
}

export function humanActorsDetail(): string {
  return 'Console, CLI and Slack in the last 24h'
}

export function agentActorsTooltip(stats: AuditStats): MetricTooltipData {
  const takeaway =
    stats.agentCount24h > 0
      ? `${stats.agentCount24h} agent event${stats.agentCount24h === 1 ? '' : 's'} in 24h — classify, fix-worker, judge-batch, and other LLM agents.`
      : 'No agent-attributed events in 24h — automations may be idle.'

  return metricTip(
    'Audit events attributed to AI agents or LLM pipelines in the last 24 hours.',
    'Exact count of audit_logs where actor_type is agent or api_key (MCP and API-key callers).',
    takeaway,
  )
}

export function agentActorsDetail(): string {
  return 'Agents and API keys in the last 24h'
}

export function systemActorsTooltip(stats: AuditStats): MetricTooltipData {
  const takeaway =
    stats.systemCount24h > 0
      ? `${stats.systemCount24h} system event${stats.systemCount24h === 1 ? '' : 's'} in 24h — cron jobs, webhooks, or null actor background work.`
      : 'No system-attributed events in 24h.'

  return metricTip(
    'Audit events from system actors: scheduled cron, webhooks, or unattributed background jobs.',
    'Exact count of audit_logs whose actor_type is neither a person nor an agent (system, cron, webhooks).',
    takeaway,
  )
}

export function systemActorsDetail(): string {
  return 'System, cron and webhook jobs'
}
