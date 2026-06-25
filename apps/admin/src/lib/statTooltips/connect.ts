/**
 * FILE: apps/admin/src/lib/statTooltips/connect.ts
 * PURPOSE: StatCard tooltips for the Connect hub snapshot strip.
 */

export type { PlainStatTooltipOpts } from '../usePlainStatTooltips'

import type { MetricTooltipData } from '../../components/ui'
import type { McpStats } from '../../components/mcp/types'
import type { SdkStatus } from '../../components/SdkVersionBadge'
import { metricTip } from '../metricTooltipBuilder'

export interface ConnectSnapshotStats {
  githubConnected: boolean
  githubRepoUrl: string | null
  sdkConnected: boolean
  sdkLastSeenAt: string | null
  sdkVersion: string | null
  sdkLatestVersion: string | null
  sdkStatus: SdkStatus | null
  mcpStats: McpStats
}

function formatRelative(iso: string | null): string {
  if (!iso) return 'never'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return 'just now'
  const mins = Math.floor(ms / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 48) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

export function githubTooltip(input: ConnectSnapshotStats): MetricTooltipData {
  const takeaway = input.githubConnected
    ? `Repository linked${input.githubRepoUrl ? ` (${input.githubRepoUrl})` : ''} — upgrade PRs and codebase indexing are available.`
    : 'Connect GitHub to unlock SDK upgrade PRs, autofix branches, and repo indexing.'

  return metricTip(
    'Whether a primary GitHub repository is linked and dispatch preflight is ready.',
    'Matches GitHubConnectCard — repo URL from preflight plus github check ready, not github_app_connected alone.',
    takeaway,
    !input.githubConnected
      ? { tone: 'info', text: 'Start on Integrations → link repo, then return here for SDK/MCP install.' }
      : undefined,
  )
}

export function githubDetail(input: ConnectSnapshotStats): string {
  return input.githubConnected ? 'Repo linked' : 'Not linked'
}

export function sdkHeartbeatTooltip(input: ConnectSnapshotStats): MetricTooltipData {
  const takeaway = input.sdkConnected
    ? `SDK heartbeat seen ${formatRelative(input.sdkLastSeenAt)} — reporters are reaching Mushi Cloud.`
    : 'No SDK heartbeat yet — paste the install snippet and ship a build with NEXT_PUBLIC_MUSHI_* vars.'

  return metricTip(
    'Whether an active API key recorded last_seen_at from your app or CI.',
    'Scans project api_keys for is_active rows with a non-null last_seen_at timestamp.',
    takeaway,
    !input.sdkConnected
      ? { tone: 'warn', text: 'Native apps need CI secrets baked at compile time — see Native CI card below.' }
      : undefined,
  )
}

export function sdkHeartbeatDetail(input: ConnectSnapshotStats): string {
  return input.sdkConnected ? formatRelative(input.sdkLastSeenAt) : 'No heartbeat'
}

export function sdkVersionTooltip(input: ConnectSnapshotStats): MetricTooltipData {
  const drift =
    input.sdkVersion && input.sdkLatestVersion && input.sdkVersion !== input.sdkLatestVersion
  const takeaway =
    input.sdkStatus === 'deprecated'
      ? `Production reports ${input.sdkVersion ?? 'unknown'} — deprecated; upgrade via Create Upgrade PR.`
      : drift
        ? `${input.sdkVersion} in prod vs ${input.sdkLatestVersion} latest — open Update center for a bump PR.`
        : input.sdkVersion
          ? `${input.sdkVersion} matches latest published @mushi-mushi/* release.`
          : 'Version unknown until the SDK sends its first report with package metadata.'

  return metricTip(
    'SDK version observed in production reports vs latest npm publish.',
    'Reads project.sdk_version, sdk_latest_version, and sdk_status from the projects feed.',
    takeaway,
    drift || input.sdkStatus === 'deprecated'
      ? { tone: 'warn', text: 'Create Upgrade PR bumps semver-only @mushi-mushi/* deps in your repo.' }
      : undefined,
  )
}

export function sdkVersionDetail(input: ConnectSnapshotStats): string {
  if (!input.sdkVersion) return 'Awaiting first report'
  if (input.sdkLatestVersion && input.sdkVersion !== input.sdkLatestVersion) {
    return `Latest ${input.sdkLatestVersion}`
  }
  return input.sdkStatus === 'up-to-date' ? 'Up to date' : (input.sdkStatus ?? 'tracked')
}

export function sdkVersionValue(input: ConnectSnapshotStats): string {
  return input.sdkVersion ?? '—'
}

export function mcpConnectedTooltip(input: ConnectSnapshotStats): MetricTooltipData {
  const { mcpStats: stats } = input
  return metricTip(
    'mcp:read keys that sent a heartbeat from Cursor, Claude, or another MCP client.',
    'From GET /v1/admin/mcp/stats — connectedKeyCount vs neverConnectedCount on mcp:read keys.',
    stats.connectedKeyCount > 0
      ? `${stats.connectedKeyCount} key${stats.connectedKeyCount === 1 ? '' : 's'} in IDE${stats.lastSeenAt ? ` — last seen ${formatRelative(stats.lastSeenAt)}.` : '.'}`
      : stats.mcpReadKeyCount > 0
        ? `${stats.neverConnectedCount} unused mcp:read key${stats.neverConnectedCount === 1 ? '' : 's'} — paste Setup snippet into your IDE.`
        : 'Mint mcp:read on Projects, then add MCP via deeplink below.',
    stats.neverConnectedCount > 0 && stats.connectedKeyCount === 0
      ? { tone: 'warn', text: 'Keys exist but no IDE handshake — open MCP Setup tab.' }
      : undefined,
  )
}

export function mcpConnectedDetail(input: ConnectSnapshotStats): string {
  const { mcpStats: stats } = input
  return stats.neverConnectedCount > 0 ? `${stats.neverConnectedCount} unused` : 'In IDE'
}

export function mcpToolsTooltip(input: ConnectSnapshotStats): MetricTooltipData {
  const { mcpStats: stats } = input
  return metricTip(
    'Tools, resources, and prompts advertised to connected MCP agents.',
    'Static catalog counts from GET /v1/admin/mcp/stats.',
    `${stats.toolCount} tools · ${stats.resourceCount} resources · ${stats.promptCount} prompts available once MCP connects.`,
  )
}

export function mcpToolsDetail(input: ConnectSnapshotStats): string {
  const { mcpStats: stats } = input
  return `${stats.resourceCount} resources · ${stats.promptCount} prompts`
}

export function mcpEndpointDetail(input: ConnectSnapshotStats): string {
  const { mcpStats: stats } = input
  if (stats.endpointMismatch && stats.lastSeenEndpointHost) {
    return `IDE → ${stats.lastSeenEndpointHost}`
  }
  if (stats.expectedEndpointHost) return stats.expectedEndpointHost
  return '—'
}

export function mcpEndpointTooltip(input: ConnectSnapshotStats): MetricTooltipData {
  const { mcpStats: stats } = input
  return metricTip(
    'Host your MCP client last connected from vs what this console expects.',
    'From GET /v1/admin/mcp/stats — lastSeenEndpointHost vs expectedEndpointHost.',
    stats.endpointMismatch
      ? `Mismatch: IDE uses ${stats.lastSeenEndpointHost}; admin expects ${stats.expectedEndpointHost}. Update MCP snippet endpoint.`
      : stats.lastSeenEndpointHost
        ? `Last MCP handshake from ${stats.lastSeenEndpointHost}.`
        : 'No MCP IDE handshake recorded yet.',
    stats.endpointMismatch
      ? { tone: 'warn', text: 'Fix endpoint in MCP setup before debugging tool errors.' }
      : undefined,
  )
}
