/**
 * CONNECT SNAPSHOT — SDK heartbeat, GitHub link, MCP posture, and version drift.
 */

import { Link } from 'react-router-dom'
import { Section, StatCard, SnapshotSectionHint } from '../ui'
import { LINK_ACCENT } from '../../lib/chipTone'
import { MetricStrip } from '../MetricStrip'
import type { McpStats } from '../mcp/types'
import type { SdkStatus } from '../SdkVersionBadge'
import {
  githubDetail,
  githubTooltip,
  mcpConnectedDetail,
  mcpConnectedTooltip,
  mcpEndpointDetail,
  mcpEndpointTooltip,
  mcpToolsDetail,
  mcpToolsTooltip,
  sdkHeartbeatDetail,
  sdkHeartbeatTooltip,
  sdkVersionDetail,
  sdkVersionTooltip,
  sdkVersionValue,
  type ConnectSnapshotStats,
} from '../../lib/statTooltips/connect'
import { connectLinks } from '../../lib/statCardLinks'

interface Props {
  githubConnected: boolean
  githubRepoUrl: string | null
  sdkConnected: boolean
  sdkLastSeenAt: string | null
  sdkVersion: string | null
  sdkLatestVersion: string | null
  sdkStatus: SdkStatus | null
  mcpStats: McpStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  description?: string
  sectionTitle?: string
  statLabels?: Record<string, string>
  hideLinks?: boolean
  compact?: boolean
}

export function ConnectSnapshotStrip({
  githubConnected,
  githubRepoUrl,
  sdkConnected,
  sdkLastSeenAt,
  sdkVersion,
  sdkLatestVersion,
  sdkStatus,
  mcpStats,
  statsFetchedAt,
  statsValidating,
  description,
  sectionTitle = 'CONNECT SNAPSHOT',
  statLabels,
  hideLinks = false,
  compact = false,
}: Props) {
  const input: ConnectSnapshotStats = {
    githubConnected,
    githubRepoUrl,
    sdkConnected,
    sdkLastSeenAt,
    sdkVersion,
    sdkLatestVersion,
    sdkStatus,
    mcpStats,
  }

  const versionDrift =
    Boolean(sdkVersion && sdkLatestVersion && sdkVersion !== sdkLatestVersion) ||
    sdkStatus === 'deprecated' ||
    sdkStatus === 'outdated'

  return (
    <Section
      title={sectionTitle}
      freshness={{ at: statsFetchedAt, isValidating: statsValidating }}
    >
      <SnapshotSectionHint text={description} />
      <MetricStrip cols={compact ? 4 : 7} ariaLabel="Connect hub snapshot">
        <StatCard
          label={statLabels?.github ?? 'GitHub'}
          value={githubConnected ? 'Linked' : '—'}
          accent={githubConnected ? 'text-ok' : 'text-warn'}
          tooltip={githubTooltip(input)}
          detail={githubDetail(input)}
          to={connectLinks.github}
        />
        <StatCard
          label={statLabels?.sdkHeartbeat ?? 'SDK live'}
          value={sdkConnected ? 'Live' : '—'}
          accent={sdkConnected ? 'text-ok' : 'text-warn'}
          tooltip={sdkHeartbeatTooltip(input)}
          detail={sdkHeartbeatDetail(input)}
          to={connectLinks.sdk}
        />
        <StatCard
          label={statLabels?.sdkVersion ?? 'SDK version'}
          value={sdkVersionValue(input)}
          accent={versionDrift ? 'text-warn' : sdkVersion ? 'text-ok' : undefined}
          tooltip={sdkVersionTooltip(input)}
          detail={sdkVersionDetail(input)}
          to={connectLinks.sdkVersion}
        />
        <StatCard
          label={statLabels?.mcpConnected ?? 'MCP in IDE'}
          value={mcpStats.connectedKeyCount}
          accent={
            mcpStats.connectedKeyCount > 0
              ? 'text-ok'
              : mcpStats.mcpReadKeyCount > 0
                ? 'text-warn'
                : undefined
          }
          tooltip={mcpConnectedTooltip(input)}
          detail={mcpConnectedDetail(input)}
          to={connectLinks.mcpConnected}
        />
        {!compact ? (
          <StatCard
            label={statLabels?.mcpUnused ?? 'Unused keys'}
            value={mcpStats.neverConnectedCount}
            accent={mcpStats.neverConnectedCount > 0 ? 'text-warn' : 'text-ok'}
            tooltip={mcpConnectedTooltip(input)}
            detail={mcpStats.neverConnectedCount > 0 ? 'Add to IDE or revoke' : 'All keys used'}
            to={connectLinks.mcpUnused}
          />
        ) : null}
        {!compact ? (
          <StatCard
            label={statLabels?.mcpEndpoint ?? 'MCP endpoint'}
            value={mcpStats.endpointMismatch ? 'Mismatch' : mcpStats.lastSeenEndpointHost ? 'Aligned' : '—'}
            accent={mcpStats.endpointMismatch ? 'text-warn' : mcpStats.lastSeenEndpointHost ? 'text-ok' : undefined}
            tooltip={mcpEndpointTooltip(input)}
            detail={mcpEndpointDetail(input)}
            to={connectLinks.mcpConnected}
          />
        ) : null}
        {!compact ? (
          <StatCard
            label={statLabels?.tools ?? 'MCP catalog'}
            value={mcpStats.toolCount}
            accent="text-info"
            tooltip={mcpToolsTooltip(input)}
            detail={mcpToolsDetail(input)}
            to={connectLinks.tools}
          />
        ) : null}
      </MetricStrip>
      {!hideLinks ? (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-fg-muted">
          <Link to="/mcp?tab=setup" className={LINK_ACCENT}>
            MCP setup →
          </Link>
          <Link to="/projects" className="hover:text-fg underline-offset-2 hover:underline">
            API keys →
          </Link>
          <Link to="/integrations/config" className="hover:text-fg underline-offset-2 hover:underline">
            GitHub integrations →
          </Link>
        </div>
      ) : null}
    </Section>
  )
}
