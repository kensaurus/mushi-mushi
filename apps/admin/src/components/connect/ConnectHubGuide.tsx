/**
 * Visible Connect hub setup lanes guide.
 *
 * Renders a ReactFlow pipeline diagram at the top for glanceable status,
 * then the full WorkflowStageRow detail list inside a collapsible panel.
 */

import { useMemo } from 'react'
import {
  IconGit,
  IconIntegrations,
  IconMcp,
  IconTerminal,
} from '../icons'
import { FeatureExplainPanel } from '../FeatureExplainPanel'
import { WorkflowStageRow } from '../workflow/WorkflowStageRow'
import {
  CONNECT_EXPLAINER_SUMMARY,
  CONNECT_SETUP_LANES,
  isConnectGuideExpanded,
} from '../../lib/connectExplainer'
import { connectLaneOverlay, type WorkflowPosture } from '../../lib/guideLiveOverlay'
import { ConnectStepFlow, type StepNodeData } from './ConnectStepFlow'

const LANE_ICON: Record<string, typeof IconGit> = {
  github: IconGit,
  sdk: IconIntegrations,
  mcp: IconMcp,
  cli: IconTerminal,
  upgrade: IconIntegrations,
  native_ci: IconTerminal,
}

const LANE_SHORT: Record<string, string> = {
  github: 'GitHub',
  sdk: 'SDK',
  mcp: 'MCP',
  cli: 'CLI',
  upgrade: 'Upgrade',
  native_ci: 'Native CI',
}

interface Props {
  githubConnected: boolean
  sdkConnected: boolean
  nativeCiNeedsAttention?: boolean
  mcpConnected?: boolean
  cliConnected?: boolean
  upgradeComplete?: boolean
}

export function ConnectHubGuide({
  githubConnected,
  sdkConnected,
  nativeCiNeedsAttention,
  mcpConnected,
  cliConnected,
  upgradeComplete,
}: Props) {
  const flags = {
    githubConnected,
    sdkConnected,
    nativeCiNeedsAttention,
    mcpConnected,
    cliConnected,
    upgradeComplete,
  }

  // Build StepFlow lane data: mark the first non-clear lane as 'current' so
  // the diagram shows exactly where the user is in the pipeline.
  const stepLanes: StepNodeData[] = useMemo(() => {
    const overlays = CONNECT_SETUP_LANES.map((lane) => ({
      lane,
      overlay: connectLaneOverlay(lane.id, flags),
    }))

    let currentAssigned = false
    return overlays.map(({ lane, overlay }, i) => {
      let posture: WorkflowPosture | 'current'
      if (overlay.posture === 'clear') {
        posture = 'clear'
      } else if (!currentAssigned) {
        posture = 'current'
        currentAssigned = true
      } else {
        posture = 'info'
      }
      return {
        label: lane.label,
        shortLabel: LANE_SHORT[lane.id] ?? lane.label,
        posture,
        stepIdx: i,
        totalSteps: CONNECT_SETUP_LANES.length,
        metric: overlay.metric,
      }
    })
  // Recompute only when a connection-state input changes; the derived overlay
  // map is intentionally not a dependency.
  }, [githubConnected, sdkConnected, nativeCiNeedsAttention, mcpConnected, cliConnected, upgradeComplete])

  return (
    <div className="space-y-2">
      {/* Pipeline flow diagram — always visible for glanceable status */}
      <div
        className="rounded-md border border-edge-subtle bg-surface-raised/40 py-3 px-2 overflow-hidden"
        aria-label="Setup pipeline overview"
      >
        <ConnectStepFlow lanes={stepLanes} />
      </div>

      {/* Expandable detail rows */}
      <FeatureExplainPanel
        title="Install order — GitHub → SDK → MCP → CLI"
        summary={CONNECT_EXPLAINER_SUMMARY}
        category="workflow"
        defaultOpen={isConnectGuideExpanded({
          githubConnected,
          sdkConnected,
          nativeCiNeedsAttention,
        })}
      >
        <div className="space-y-1">
          {CONNECT_SETUP_LANES.map((lane) => {
            const overlay = connectLaneOverlay(lane.id, flags)
            const Icon = LANE_ICON[lane.id] ?? IconIntegrations
            return (
              <WorkflowStageRow
                key={lane.id}
                id={lane.id}
                shortLabel={lane.label.replace(/^\d+\.\s*/, '')}
                icon={<Icon size={14} />}
                metric={overlay.metric}
                posture={overlay.posture}
                actionLine={overlay.actionLine}
                plain={lane.plain}
              />
            )
          })}
        </div>
      </FeatureExplainPanel>
    </div>
  )
}
