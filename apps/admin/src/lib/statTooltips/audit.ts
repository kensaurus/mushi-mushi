/**
 * FILE: apps/admin/src/lib/statTooltips/audit.ts
 * PURPOSE: One-line details for the Audit breakdown tiles (people, agents, system).
 */

export function humanActorsDetail(): string {
  return 'Console, CLI and Slack in the last 24h'
}

export function agentActorsDetail(): string {
  return 'Agents and API keys in the last 24h'
}

export function systemActorsDetail(): string {
  return 'System, cron and webhook jobs'
}
