/**
 * FILE: ConnectProvenanceBand.tsx
 * PURPOSE: Scannable connection health on the Connect hub — signal tiles first,
 *          technical URLs in a collapsed details block (less jargon up front).
 */

import { useState } from 'react'
import { Section, StatCard } from '../ui'
import type { McpStats } from '../mcp/types'
import { RESOLVED_EXTERNAL_API_URL, RESOLVED_MCP_HTTP_URL } from '../../lib/env'
import { EndpointCodeRow } from '../readout'
import { MetricStrip } from '../MetricStrip'
import { IconChevronDown, IconGlobe } from '../icons'

function formatRelativeShort(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return 'just now'
  const mins = Math.floor(ms / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 48) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export interface ConnectProvenanceBandProps {
  mcpStats: McpStats
  sdkLastSeenAt: string | null
  sdkConnected: boolean
  projectId: string | null
  statsFetchedAt: string | null
  statsValidating?: boolean
}

export function ConnectProvenanceBand({
  mcpStats,
  sdkLastSeenAt,
  sdkConnected,
  projectId,
  statsFetchedAt,
  statsValidating,
}: ConnectProvenanceBandProps) {
  const [techOpen, setTechOpen] = useState(false)
  const endpointMismatch = mcpStats.endpointMismatch
  const mcpSeenHost = mcpStats.lastSeenEndpointHost

  const sdkValue = sdkConnected && sdkLastSeenAt ? `Live · ${formatRelativeShort(sdkLastSeenAt)}` : 'No signal yet'
  const sdkAccent = sdkConnected ? 'text-ok' : 'text-warn'

  const mcpValue =
    mcpStats.connectedKeyCount > 0
      ? `${mcpStats.connectedKeyCount} key${mcpStats.connectedKeyCount === 1 ? '' : 's'} in IDE`
      : mcpStats.mcpReadKeyCount > 0
        ? `${mcpStats.neverConnectedCount} unused key${mcpStats.neverConnectedCount === 1 ? '' : 's'}`
        : 'Not set up'
  const mcpAccent =
    mcpStats.connectedKeyCount > 0 ? 'text-ok' : mcpStats.neverConnectedCount > 0 ? 'text-warn' : undefined

  const matchValue = endpointMismatch
    ? 'Mismatch'
    : mcpStats.connectedKeyCount > 0
      ? 'Aligned'
      : 'Unverified'
  const matchAccent = endpointMismatch ? 'text-warn' : mcpStats.connectedKeyCount > 0 ? 'text-ok' : undefined
  const matchDetail = endpointMismatch
    ? `IDE uses ${mcpSeenHost ?? 'a different host'}`
    : mcpStats.lastSeenAt
      ? `Last MCP ping ${formatRelativeShort(mcpStats.lastSeenAt)}`
      : undefined

  return (
    <Section
      title="Connection health"
      freshness={{ at: statsFetchedAt, isValidating: statsValidating }}
    >
      <p className="mb-3 max-w-2xl text-xs leading-relaxed text-fg-muted">
        Quick check that your app and editor are hitting the same Mushi project.
      </p>

      <MetricStrip cols={4} ariaLabel="Connection health signals">
        <StatCard
          label="Your app (SDK)"
          value={sdkValue}
          accent={sdkAccent}
          detail={sdkConnected ? 'Reports flowing to this project' : 'Install SDK or check API key'}
        />
        <StatCard
          label="Your editor (MCP)"
          value={mcpValue}
          accent={mcpAccent}
          detail={
            mcpStats.connectedKeyCount > 0
              ? `${mcpStats.toolCount} tools in catalog`
              : 'Add MCP config from the MCP tab'
          }
        />
        <StatCard
          label="URL match"
          value={matchValue}
          accent={matchAccent}
          detail={matchDetail}
        />
        <StatCard
          label="MCP catalog"
          value={String(mcpStats.toolCount)}
          accent="text-info"
          detail={`${mcpStats.resourceCount} resources · ${mcpStats.promptCount} prompts`}
        />
      </MetricStrip>

      <div className="mt-3 rounded-md border border-edge-subtle/80 bg-surface-raised/30">
        <button
          type="button"
          onClick={() => setTechOpen((v) => !v)}
          aria-expanded={techOpen}
          className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-2xs font-medium text-fg-secondary hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset"
        >
          <IconGlobe size={14} className="shrink-0 text-fg-faint" aria-hidden />
          <span className="flex-1">URLs & project ID</span>
          <IconChevronDown
            size={14}
            className={`shrink-0 text-fg-faint motion-safe:transition-transform ${techOpen ? 'rotate-180' : ''}`}
            aria-hidden
          />
        </button>
        {techOpen ? (
          <div className="space-y-2 border-t border-edge-subtle/60 px-3 py-3">
            <EndpointCodeRow label="Admin API" url={RESOLVED_EXTERNAL_API_URL} />
            <EndpointCodeRow label="MCP server" url={RESOLVED_MCP_HTTP_URL} />
            {projectId ? (
              <div className="rounded-md border border-edge-subtle bg-surface-root/40 px-3 py-2">
                <span className="text-3xs font-medium uppercase tracking-wider text-fg-faint">
                  Project ID
                </span>
                <p className="mt-1 font-mono text-2xs text-fg-secondary break-all">{projectId}</p>
              </div>
            ) : null}
            <p className="text-3xs text-fg-faint leading-relaxed">
              Expected host for MCP heartbeats:{' '}
              <span className="font-mono text-fg-muted">
                {mcpStats.expectedEndpointHost ??
                  RESOLVED_EXTERNAL_API_URL.replace(/^https?:\/\//, '').split('/')[0]}
              </span>
            </p>
          </div>
        ) : null}
      </div>
    </Section>
  )
}
