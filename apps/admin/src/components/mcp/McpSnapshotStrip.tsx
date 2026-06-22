/**
 * FILE: McpSnapshotStrip.tsx
 * PURPOSE: MCP KPI strip using MetricStrip — replaces hand-rolled 6-col grid on McpPage.
 */

import { Section, StatCard, SnapshotSectionHint } from '../ui'
import { MetricStrip } from '../MetricStrip'
import type { McpStats } from './types'
import {
  activeKeysDetail,
  activeKeysTooltip,
  connectedDetail,
  connectedTooltip,
  endpointDetail,
  endpointTooltip,
  mcpReadDetail,
  mcpReadTooltip,
  sdkOnlyDetail,
  sdkOnlyTooltip,
  toolsDetail,
  toolsTooltip,
} from '../../lib/statTooltips/mcp'
import { mcpLinks } from '../../lib/statCardLinks'

interface Props {
  stats: McpStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  sectionTitle?: string
  hint?: string
  statLabels?: Record<string, string>
}

export function McpSnapshotStrip({
  stats,
  statsFetchedAt,
  statsValidating,
  sectionTitle = 'MCP SNAPSHOT',
  hint,
  statLabels,
}: Props) {
  return (
    <Section title={sectionTitle} freshness={{ at: statsFetchedAt, isValidating: statsValidating }}>
      {hint ? <SnapshotSectionHint text={hint} /> : null}
      <MetricStrip cols={6} ariaLabel="MCP snapshot">
        <StatCard
          label={statLabels?.activeKeys ?? 'Active keys'}
          value={stats.activeKeyCount}
          accent={stats.activeKeyCount > 0 ? 'text-brand' : undefined}
          tooltip={activeKeysTooltip(stats)}
          detail={activeKeysDetail()}
          to={mcpLinks.activeKeys}
        />
        <StatCard
          label={statLabels?.mcpRead ?? 'mcp:read'}
          value={stats.mcpReadKeyCount}
          accent={stats.mcpReadKeyCount > 0 ? 'text-ok' : 'text-warn'}
          tooltip={mcpReadTooltip(stats)}
          detail={mcpReadDetail(stats)}
          to={mcpLinks.mcpRead}
        />
        <StatCard
          label={statLabels?.connected ?? 'Connected'}
          value={stats.connectedKeyCount}
          accent={
            stats.connectedKeyCount > 0
              ? 'text-ok'
              : stats.mcpReadKeyCount > 0
                ? 'text-warn'
                : undefined
          }
          tooltip={connectedTooltip(stats)}
          detail={connectedDetail(stats)}
          to={mcpLinks.connected}
        />
        <StatCard
          label={statLabels?.sdkOnly ?? 'SDK-only keys'}
          value={stats.reportOnlyKeyCount}
          accent={stats.reportOnlyKeyCount > 0 && stats.mcpReadKeyCount === 0 ? 'text-warn' : undefined}
          tooltip={sdkOnlyTooltip(stats)}
          detail={sdkOnlyDetail()}
          to={mcpLinks.sdkOnly}
        />
        <StatCard
          label={statLabels?.tools ?? 'Tools'}
          value={stats.toolCount}
          accent="text-info"
          tooltip={toolsTooltip(stats)}
          detail={toolsDetail(stats)}
          to={mcpLinks.tools}
        />
        <StatCard
          label={statLabels?.endpoint ?? 'Endpoint'}
          value={stats.endpointMismatch ? 'Mismatch' : stats.lastSeenAt ? 'OK' : '—'}
          accent={stats.endpointMismatch ? 'text-danger' : stats.lastSeenAt ? 'text-ok' : undefined}
          tooltip={endpointTooltip(stats)}
          detail={endpointDetail(stats)}
          to={mcpLinks.endpoint}
        />
      </MetricStrip>
    </Section>
  )
}
