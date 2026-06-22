/**
 * FILE: connectLaneMetadata.ts
 * PURPOSE: Live metadata lines and readout facts for Connect pipeline lanes
 *          (versions, heartbeats, repo slug, MCP keys) from project + MCP stats.
 */

import type { SdkStatus } from '../components/SdkVersionBadge'
import type { McpStats } from '../components/mcp/types'
import type { StepNodeData } from '../components/connect/ConnectStepFlow'

export type LaneMetaTone = 'ok' | 'warn' | 'muted' | 'info'

export interface ConnectLaneFlags {
  githubConnected: boolean
  sdkConnected: boolean
  mcpConnected?: boolean
  cliConnected?: boolean
  upgradeComplete?: boolean
  nativeCiNeedsAttention?: boolean
}

export interface LaneMetaFact {
  label: string
  value: string
  tone?: LaneMetaTone
}

export interface ConnectLaneContext extends ConnectLaneFlags {
  githubRepoUrl?: string | null
  sdkVersion?: string | null
  sdkLatestVersion?: string | null
  sdkStatus?: SdkStatus | null
  sdkLastSeenAt?: string | null
  mcpStats?: Pick<
    McpStats,
    | 'connectedKeyCount'
    | 'neverConnectedCount'
    | 'mcpReadKeyCount'
    | 'toolCount'
    | 'lastSeenAt'
    | 'endpointMismatch'
  >
}

function formatRelativeShort(iso: string | null | undefined): string | null {
  if (!iso) return null
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return 'just now'
  const mins = Math.floor(ms / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 48) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function repoSlug(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean)
    if (parts.length >= 2) return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
    return parts[parts.length - 1] ?? null
  } catch {
    const trimmed = url.replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/\/$/, '')
    return trimmed.split('?')[0] || null
  }
}

function versionDrift(ctx: ConnectLaneContext): boolean {
  if (ctx.sdkStatus === 'deprecated' || ctx.sdkStatus === 'outdated') return true
  return Boolean(
    ctx.sdkVersion && ctx.sdkLatestVersion && ctx.sdkVersion !== ctx.sdkLatestVersion,
  )
}

function laneMetadata(laneId: string, ctx: ConnectLaneContext): {
  metaLine?: string
  metaTone?: LaneMetaTone
  facts?: LaneMetaFact[]
} {
  switch (laneId) {
    case 'github': {
      const slug = repoSlug(ctx.githubRepoUrl)
      return {
        metaLine: ctx.githubConnected ? (slug ?? 'Linked') : 'Not linked',
        metaTone: ctx.githubConnected ? 'ok' : 'warn',
        facts: [
          {
            label: 'Repository',
            value: slug ?? (ctx.githubConnected ? 'Linked' : '—'),
            tone: ctx.githubConnected ? 'ok' : 'warn',
          },
          {
            label: 'Status',
            value: ctx.githubConnected ? 'Ready for PRs' : 'Connect on Integrations',
            tone: ctx.githubConnected ? 'ok' : 'warn',
          },
        ],
      }
    }
    case 'sdk': {
      const heartbeat = formatRelativeShort(ctx.sdkLastSeenAt)
      const metaLine = ctx.sdkVersion
        ? `v${ctx.sdkVersion.replace(/^v/i, '')}`
        : ctx.sdkConnected && heartbeat
          ? `Live · ${heartbeat}`
          : ctx.sdkConnected
            ? 'Live'
            : 'Not installed'
      return {
        metaLine,
        metaTone: ctx.sdkConnected ? 'ok' : 'warn',
        facts: [
          {
            label: 'Installed',
            value: ctx.sdkVersion ? `v${ctx.sdkVersion.replace(/^v/i, '')}` : ctx.sdkConnected ? 'Unknown tag' : '—',
            tone: ctx.sdkConnected ? 'ok' : 'warn',
          },
          {
            label: 'Latest npm',
            value: ctx.sdkLatestVersion ? `v${ctx.sdkLatestVersion.replace(/^v/i, '')}` : '—',
            tone: versionDrift(ctx) ? 'warn' : 'muted',
          },
          {
            label: 'Heartbeat',
            value: heartbeat ?? (ctx.sdkConnected ? 'Recent' : 'None yet'),
            tone: ctx.sdkConnected ? 'ok' : 'warn',
          },
        ],
      }
    }
    case 'mcp': {
      const connected = ctx.mcpStats?.connectedKeyCount ?? 0
      const unused = ctx.mcpStats?.neverConnectedCount ?? 0
      const lastSeen = formatRelativeShort(ctx.mcpStats?.lastSeenAt)
      return {
        metaLine: ctx.mcpConnected
          ? `${connected} in IDE`
          : unused > 0
            ? `${unused} unused`
            : (ctx.mcpStats?.mcpReadKeyCount ?? 0) > 0
              ? 'Add to IDE'
              : 'Not set up',
        metaTone: ctx.mcpConnected ? 'ok' : unused > 0 ? 'warn' : 'muted',
        facts: [
          {
            label: 'IDE keys',
            value: connected > 0 ? String(connected) : 'None active',
            tone: connected > 0 ? 'ok' : 'warn',
          },
          {
            label: 'Catalog',
            value: ctx.mcpStats ? `${ctx.mcpStats.toolCount} tools` : '—',
            tone: 'info',
          },
          {
            label: 'Last seen',
            value: lastSeen ?? 'Never',
            tone: lastSeen ? 'ok' : 'muted',
          },
        ],
      }
    }
    case 'cli':
      return {
        metaLine: ctx.cliConnected ? 'Installed' : 'Optional',
        metaTone: ctx.cliConnected ? 'ok' : 'muted',
        facts: [
          { label: 'Package', value: '@mushi-mushi/cli', tone: 'muted' },
          {
            label: 'Status',
            value: ctx.cliConnected ? 'Available locally' : 'Install when needed',
            tone: ctx.cliConnected ? 'ok' : 'muted',
          },
        ],
      }
    case 'upgrade': {
      const installed = ctx.sdkVersion?.replace(/^v/i, '') ?? null
      const latest = ctx.sdkLatestVersion?.replace(/^v/i, '') ?? null
      const drift = versionDrift(ctx)
      let metaLine = 'Up to date'
      let metaTone: LaneMetaTone = 'ok'
      if (drift && installed && latest) {
        metaLine = `${installed} → ${latest}`
        metaTone = 'warn'
      } else if (drift && installed) {
        metaLine = `${installed} · update`
        metaTone = 'warn'
      } else if (!ctx.upgradeComplete && latest) {
        metaLine = `Latest v${latest}`
        metaTone = 'info'
      }
      return {
        metaLine,
        metaTone,
        facts: [
          {
            label: 'Installed',
            value: installed ? `v${installed}` : '—',
            tone: drift ? 'warn' : 'ok',
          },
          {
            label: 'Latest',
            value: latest ? `v${latest}` : '—',
            tone: drift ? 'warn' : 'muted',
          },
          {
            label: 'npm status',
            value: ctx.sdkStatus ?? (drift ? 'Update available' : ctx.upgradeComplete ? 'Up to date' : '—'),
            tone: drift ? 'warn' : ctx.upgradeComplete ? 'ok' : 'muted',
          },
        ],
      }
    }
    case 'native_ci':
      return {
        metaLine: ctx.nativeCiNeedsAttention ? 'Needs setup' : 'Ready',
        metaTone: ctx.nativeCiNeedsAttention ? 'warn' : 'ok',
        facts: [
          {
            label: 'Mobile builds',
            value: ctx.nativeCiNeedsAttention ? 'Secrets missing' : 'Secrets synced',
            tone: ctx.nativeCiNeedsAttention ? 'warn' : 'ok',
          },
          {
            label: 'Applies to',
            value: 'Capacitor / React Native',
            tone: 'muted',
          },
        ],
      }
    default:
      return {}
  }
}

export function attachConnectLaneMetadata(
  lanes: StepNodeData[],
  ctx: ConnectLaneContext,
): StepNodeData[] {
  return lanes.map((lane) => {
    if (!lane.laneId) return lane
    const meta = laneMetadata(lane.laneId, ctx)
    return { ...lane, ...meta }
  })
}
