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
import { SDK_FRESHNESS_LABEL, sdkFreshness } from '../../lib/heartbeat'

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
  /** The project or MCP feed has not answered yet: show no verdict, only "Checking…". */
  loading?: boolean
}

const CHECKING = 'Checking…'

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
  loading = false,
}: Props) {
  const freshness = sdkFreshness(sdkLastSeenAt)
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
          value={loading ? '…' : githubConnected ? 'Linked' : '—'}
          accent={loading ? undefined : githubConnected ? 'text-ok' : 'text-warn'}
          tooltip={githubTooltip(input)}
          detail={loading ? CHECKING : githubDetail(input)}
          to={connectLinks.github}
        />
        <StatCard
          label={statLabels?.sdkHeartbeat ?? 'SDK live'}
          value={loading ? '…' : sdkConnected ? SDK_FRESHNESS_LABEL[freshness] : '—'}
          accent={loading ? undefined : freshness === 'healthy' ? 'text-ok' : 'text-warn'}
          tooltip={sdkHeartbeatTooltip(input)}
          detail={loading ? CHECKING : sdkHeartbeatDetail(input)}
          to={connectLinks.sdk}
        />
        <StatCard
          label={statLabels?.sdkVersion ?? 'SDK version'}
          value={loading ? '…' : sdkVersionValue(input)}
          accent={loading ? undefined : versionDrift ? 'text-warn' : sdkVersion ? 'text-ok' : undefined}
          tooltip={sdkVersionTooltip(input)}
          detail={loading ? CHECKING : sdkVersionDetail(input)}
          to={connectLinks.sdkVersion}
        />
        <StatCard
          label={statLabels?.mcpConnected ?? 'MCP in IDE'}
          value={loading ? '…' : mcpStats.connectedKeyCount}
          accent={
            loading
              ? undefined
              : mcpStats.connectedKeyCount > 0
              ? 'text-ok'
              : mcpStats.mcpReadKeyCount > 0
                ? 'text-warn'
                : undefined
          }
          tooltip={mcpConnectedTooltip(input)}
          detail={loading ? CHECKING : mcpConnectedDetail(input)}
          to={connectLinks.mcpConnected}
        />
        {!compact ? (
          <StatCard
            label={statLabels?.mcpUnused ?? 'Unused keys'}
            value={loading ? '…' : mcpStats.neverConnectedCount}
            accent={loading ? undefined : mcpStats.neverConnectedCount > 0 ? 'text-warn' : 'text-ok'}
            tooltip={mcpConnectedTooltip(input)}
            detail={loading ? CHECKING : mcpStats.neverConnectedCount > 0 ? 'Add to IDE or revoke' : 'All keys used'}
            to={connectLinks.mcpUnused}
          />
        ) : null}
        {!compact ? (
          <StatCard
            label={statLabels?.mcpEndpoint ?? 'MCP endpoint'}
            value={loading ? '…' : mcpStats.endpointMismatch ? 'Mismatch' : mcpStats.lastSeenEndpointHost ? 'Aligned' : '—'}
            accent={loading ? undefined : mcpStats.endpointMismatch ? 'text-warn' : mcpStats.lastSeenEndpointHost ? 'text-ok' : undefined}
            tooltip={mcpEndpointTooltip(input)}
            detail={loading ? CHECKING : mcpEndpointDetail(input)}
            to={connectLinks.mcpConnected}
          />
        ) : null}
        {!compact ? (
          <StatCard
            label={statLabels?.tools ?? 'MCP catalog'}
            value={loading ? '…' : mcpStats.toolCount}
            accent={loading ? undefined : 'text-info'}
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
