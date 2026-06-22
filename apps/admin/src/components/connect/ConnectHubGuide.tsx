/**
 * Visible Connect hub setup lanes guide.
 *
 * Interactive ReactFlow pipeline — each node shows live metadata (versions,
 * heartbeats, repo slug); click for the fact grid below.
 */

import {
  IconGit,
  IconIntegrations,
  IconMcp,
  IconTerminal,
} from '../icons'
import type { SdkStatus } from '../SdkVersionBadge'
import type { McpStats } from '../mcp/types'
import { buildConnectStepLanes } from '../../lib/connectStepLanes'
import { ConnectStepFlow } from './ConnectStepFlow'

const LANE_ICON: Record<string, typeof IconGit> = {
  github: IconGit,
  sdk: IconIntegrations,
  mcp: IconMcp,
  cli: IconTerminal,
  upgrade: IconIntegrations,
  native_ci: IconTerminal,
}

interface Props {
  githubConnected: boolean
  githubRepoUrl?: string | null
  sdkConnected: boolean
  sdkVersion?: string | null
  sdkLatestVersion?: string | null
  sdkStatus?: SdkStatus | null
  sdkLastSeenAt?: string | null
  mcpStats?: McpStats
  nativeCiNeedsAttention?: boolean
  mcpConnected?: boolean
  cliConnected?: boolean
  upgradeComplete?: boolean
}

function renderLaneIcon(laneId: string | undefined) {
  if (!laneId) return null
  const Icon = LANE_ICON[laneId] ?? IconIntegrations
  return <Icon size={14} />
}

export function ConnectHubGuide({
  githubConnected,
  githubRepoUrl,
  sdkConnected,
  sdkVersion,
  sdkLatestVersion,
  sdkStatus,
  sdkLastSeenAt,
  mcpStats,
  nativeCiNeedsAttention,
  mcpConnected,
  cliConnected,
  upgradeComplete,
}: Props) {
  const stepLanes = buildConnectStepLanes({
    githubConnected,
    githubRepoUrl,
    sdkConnected,
    sdkVersion,
    sdkLatestVersion,
    sdkStatus,
    sdkLastSeenAt,
    mcpStats,
    nativeCiNeedsAttention,
    mcpConnected: mcpConnected ?? false,
    cliConnected,
    upgradeComplete,
  })

  return (
    <div
      className="rounded-md border border-edge-subtle bg-surface-raised py-2 px-2 min-w-0"
      aria-label="Install pipeline stepper"
    >
      <ConnectStepFlow lanes={stepLanes} renderLaneIcon={renderLaneIcon} />
    </div>
  )
}
