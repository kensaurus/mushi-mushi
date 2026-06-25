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
    'Counts audit_events where action matches failure patterns (fix.failed, integration.disconnected, etc.) or severity = fail.',
    takeaway,
    stats.failCount24h > 0
      ? { tone: 'warn', text: `${stats.failCount24h} failure event${stats.failCount24h === 1 ? '' : 's'} — open Log tab filtered by action.` }
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
      ? `${stats.humanCount24h} human-actor event${stats.humanCount24h === 1 ? '' : 's'} in 24h — operators with email or uuid attribution.`
      : 'No human-attributed audit events in the 24h sample.'

  return metricTip(
    'Audit events attributed to human operators (email + uuid) in the last 24 hours.',
    'audit_events where actor_type = human or actor_id resolves to an authenticated user email.',
    takeaway,
  )
}

export function humanActorsDetail(): string {
  return 'Email + uuid in last 24h sample'
}

export function agentActorsTooltip(stats: AuditStats): MetricTooltipData {
  const takeaway =
    stats.agentCount24h > 0
      ? `${stats.agentCount24h} agent event${stats.agentCount24h === 1 ? '' : 's'} in 24h — classify, fix-worker, judge-batch, and other LLM agents.`
      : 'No agent-attributed events in 24h — automations may be idle.'

  return metricTip(
    'Audit events attributed to AI agents or LLM pipelines in the last 24 hours.',
    'audit_events where actor_id matches agent_* patterns or actor_type = agent / llm.',
    takeaway,
  )
}

export function agentActorsDetail(): string {
  return 'LLM / agent_* ids in last 24h'
}

export function systemActorsTooltip(stats: AuditStats): MetricTooltipData {
  const takeaway =
    stats.systemCount24h > 0
      ? `${stats.systemCount24h} system event${stats.systemCount24h === 1 ? '' : 's'} in 24h — cron jobs, webhooks, or null actor background work.`
      : 'No system-attributed events in 24h.'

  return metricTip(
    'Audit events from system actors: scheduled cron, webhooks, or unattributed background jobs.',
    'audit_events where actor_type = system or actor_id is null / cron / webhook identifiers.',
    takeaway,
  )
}

export function systemActorsDetail(): string {
  return 'Cron / webhook / null actor'
}
