/**
 * FILE: apps/admin/src/lib/statTooltips/audit.ts
 * PURPOSE: Human-readable StatCard tooltips for the Audit snapshot and breakdown strips.
 */

export type { PlainStatTooltipOpts } from '../usePlainStatTooltips'

import type { MetricTooltipData } from '../../components/ui'
import type { AuditStats } from '../../components/audit/types'
import { metricTip } from '../metricTooltipBuilder'

export function events24hTooltip(stats: AuditStats): MetricTooltipData {
  const takeaway =
    stats.events24h > 0
      ? `${stats.events24h} audit event${stats.events24h === 1 ? '' : 's'} in 24h (${stats.activeProjectEvents24h} on ${stats.projectName ?? 'active project'}).`
      : stats.auditLogEntitlement
        ? 'No audit events in 24h — normal on a quiet project until operators or agents act.'
        : 'Audit log requires plan entitlement — upgrade for append-only evidence.'

  return metricTip(
    'Append-only audit log entries in the rolling last 24 hours (cluster-wide).',
    'Counts audit_events rows with created_at in 24h. activeProjectEvents24h filters to the selected project.',
    takeaway,
    !stats.auditLogEntitlement
      ? { tone: 'info', text: 'Audit log locked on current plan.' }
      : undefined,
  )
}

export function events24hDetail(stats: AuditStats): string {
  return `${stats.activeProjectEvents24h} on ${stats.projectName ?? 'project'}`
}

export function failCount24hTooltip(stats: AuditStats): MetricTooltipData {
  const takeaway =
    stats.failCount24h > 0
      ? `${stats.failCount24h} failure event${stats.failCount24h === 1 ? '' : 's'} in 24h — common actions: fix.failed, integration.disconnected.`
      : 'No failure-class audit events in 24h.'

  return metricTip(
    'Audit events indicating failure outcomes in the last 24 hours.',
    'Exact count of audit_logs in the last 24h whose action is fix.failed or integration.disconnected. Clicking opens the log with the same filter.',
    takeaway,
    stats.failCount24h > 0
      ? { tone: 'warn', text: `${stats.failCount24h} failure event${stats.failCount24h === 1 ? '' : 's'} — the card opens the log filtered to exactly these events.` }
      : undefined,
  )
}

export function failCount24hDetail(): string {
  return 'fix.failed · integration.disconnected'
}

export function actorMixTooltip(stats: AuditStats): MetricTooltipData {
  const takeaway =
    stats.events24h > 0
      ? `24h actor mix: ${stats.humanCount24h} human · ${stats.agentCount24h} agent · ${stats.systemCount24h} system.`
      : 'Actor mix appears after the first audit event in 24h.'

  return metricTip(
    'Breakdown of audit events by actor type in the last 24 hours (human / agent / system).',
    'humanCount24h = actor with user email/uuid; agentCount24h = LLM or agent_* ids; systemCount24h = cron, webhook, null actor.',
    takeaway,
    stats.agentCount24h > stats.humanCount24h && stats.agentCount24h > 0
      ? { tone: 'info', text: 'Agent activity exceeds human — verify automations are expected.' }
      : undefined,
  )
}

export function actorMixDetail(): string {
  return 'Human / agent / system (24h)'
}

export function totalEventsTooltip(stats: AuditStats): MetricTooltipData {
  const takeaway =
    stats.totalEvents > 0
      ? `${stats.totalEvents.toLocaleString()} audit events all-time${stats.topAction7d ? ` · top 7d action: ${stats.topAction7d} (${stats.topAction7dCount}×).` : '.'}`
      : 'Empty audit log — events append on operator actions, agent runs, and system jobs.'

  return metricTip(
    'Total append-only audit log entries stored for projects you can access.',
    'Counts all audit_events rows. topAction7d is the most frequent action string in the last 7 days.',
    takeaway,
  )
}

export function totalEventsDetail(stats: AuditStats): string {
  return stats.topAction7d ? `Top 7d: ${stats.topAction7d}` : 'No 7d activity'
}

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
