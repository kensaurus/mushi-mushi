/**
 * FILE: apps/admin/src/lib/statTooltips/mcp.ts
 * PURPOSE: Human-readable StatCard tooltips for the MCP SNAPSHOT strip.
 */

import type { MetricTooltipData } from '../../components/ui'
import type { McpStats } from '../../components/mcp/types'
import { metricTip } from '../metricTooltipBuilder'

export function activeKeysTooltip(stats: McpStats): MetricTooltipData {
  const takeaway =
    stats.activeKeyCount > 0
      ? `${stats.activeKeyCount} active API key${stats.activeKeyCount === 1 ? '' : 's'} on this project — rotate or revoke unused keys on /projects.`
      : 'No active API keys — mint one on /projects to connect SDK or MCP agents.'

  return metricTip(
    'Non-revoked API keys currently active for the project.',
    'Counts project_api_keys rows where is_active is true for the active project (all scopes).',
    takeaway,
    stats.activeKeyCount === 0
      ? { tone: 'info', text: 'Mint a key on /projects — pick mcp:read for browse or mcp:write for fix dispatch.' }
      : undefined,
  )
}

export function activeKeysDetail(): string {
  return 'All scopes on this project'
}

export function mcpReadTooltip(stats: McpStats): MetricTooltipData {
  const takeaway =
    stats.mcpReadKeyCount > 0
      ? `${stats.mcpReadKeyCount} key${stats.mcpReadKeyCount === 1 ? '' : 's'} with mcp:read${stats.mcpWriteKeyCount > 0 ? ` · ${stats.mcpWriteKeyCount} with mcp:write` : ''} — agents can browse tools and resources.`
      : stats.reportOnlyKeyCount > 0
        ? `${stats.reportOnlyKeyCount} SDK-only key${stats.reportOnlyKeyCount === 1 ? '' : 's'} — add mcp:read scope to expose the catalog to agents.`
        : 'No MCP-scoped keys — mint mcp:read or mcp:write on /projects.'

  return metricTip(
    'Active keys that include the mcp:read scope (browse tools, resources, prompts).',
    'Counts active project_api_keys whose scopes array includes mcp:read. mcpWriteKeyCount is keys with mcp:write.',
    takeaway,
    stats.mcpReadKeyCount === 0
      ? { tone: 'info', text: 'Mint on /projects with mcp:read so Cursor can list Mushi tools.' }
      : undefined,
  )
}

export function mcpReadDetail(stats: McpStats): string {
  return stats.mcpWriteKeyCount > 0 ? `${stats.mcpWriteKeyCount} write` : 'Mint on /projects'
}

export function connectedTooltip(stats: McpStats): MetricTooltipData {
  const takeaway =
    stats.connectedKeyCount > 0
      ? `${stats.connectedKeyCount} mcp:read key${stats.connectedKeyCount === 1 ? '' : 's'} sent a heartbeat${stats.lastSeenAt ? ` — last seen ${stats.daysSinceLastSeen != null ? `${stats.daysSinceLastSeen}d ago` : 'recently'}.` : '.'}`
      : stats.mcpReadKeyCount > 0
        ? `${stats.neverConnectedCount} mcp:read key${stats.neverConnectedCount === 1 ? '' : 's'} never connected — paste the Setup snippet into your IDE.`
        : 'No MCP keys to connect — mint mcp:read first.'

  return metricTip(
    'mcp:read keys that have recorded a last_seen_at heartbeat from an agent or IDE.',
    'Counts active keys with mcp:read scope where last_seen_at is set. neverConnectedCount is mcp:read keys with no heartbeat yet.',
    takeaway,
    stats.neverConnectedCount > 0 && stats.connectedKeyCount === 0
      ? { tone: 'warn', text: 'Complete IDE handshake on Setup tab — keys exist but no heartbeat yet.' }
      : stats.endpointMismatch
        ? { tone: 'warn', text: 'Endpoint mismatch — agent may be hitting the wrong API host.' }
        : undefined,
  )
}

export function connectedDetail(stats: McpStats): string {
  return stats.neverConnectedCount > 0 ? `${stats.neverConnectedCount} never used` : 'Keys with heartbeat'
}

export function sdkOnlyTooltip(stats: McpStats): MetricTooltipData {
  const takeaway =
    stats.reportOnlyKeyCount > 0
      ? `${stats.reportOnlyKeyCount} key${stats.reportOnlyKeyCount === 1 ? '' : 's'} with report:write only — captures bugs but cannot expose MCP tools to agents.`
      : 'No SDK-only keys — every active key includes an MCP scope or you have no keys yet.'

  return metricTip(
    'Active keys with report:write (or other scopes) but without mcp:read or mcp:write.',
    'Counts active project_api_keys where scopes lack both mcp:read and mcp:write.',
    takeaway,
    stats.reportOnlyKeyCount > 0 && stats.mcpReadKeyCount === 0
      ? { tone: 'info', text: 'Add mcp:read scope on /projects so agents can browse the catalog.' }
      : undefined,
  )
}

export function sdkOnlyDetail(): string {
  return 'report:write without MCP scope'
}

export function toolsTooltip(stats: McpStats): MetricTooltipData {
  const takeaway = `${stats.toolCount} MCP tools, ${stats.resourceCount} resources, and ${stats.promptCount} slash prompts advertised in the catalog — static counts from the server catalog.`

  return metricTip(
    'Tools, resources, and prompts the MCP server advertises to connected agents.',
    'Static catalog counts returned by GET /v1/admin/mcp/stats (TOOL_COUNT, RESOURCE_COUNT, PROMPT_COUNT).',
    takeaway,
  )
}

export function toolsDetail(stats: McpStats): string {
  return `${stats.resourceCount} resources · ${stats.promptCount} prompts`
}

export function endpointTooltip(stats: McpStats): MetricTooltipData {
  const takeaway = stats.endpointMismatch
    ? `Agent heartbeat hit ${stats.lastSeenEndpointHost ?? 'unknown host'} but snippet should use ${stats.expectedEndpointHost ?? 'cloud API host'} — fix on Setup tab.`
    : stats.lastSeenAt
      ? `Last heartbeat OK${stats.lastSeenEndpointHost ? ` (${stats.lastSeenEndpointHost})` : ''}.`
      : 'No agent heartbeat yet — endpoint health unknown until first MCP connection.'

  return metricTip(
    'Whether the last MCP heartbeat used the expected API host.',
    'Compares last_seen_endpoint_host on the most recent mcp:read key against the API host from the current request. Mismatch surfaces as danger accent.',
    takeaway,
    stats.endpointMismatch
      ? { tone: 'warn', text: 'Endpoint mismatch — update IDE snippet to the cloud API host on Setup.' }
      : undefined,
  )
}

export function endpointDetail(stats: McpStats): string {
  return stats.expectedEndpointHost ?? 'Cloud API host'
}
