/**
 * FILE: connectStepLanes.ts
 * PURPOSE: Shared install-pipeline lane builder for Connect hub stepper surfaces.
 */

import { CONNECT_SETUP_LANES } from './connectExplainer'
import { connectLaneOverlay, type WorkflowPosture } from './guideLiveOverlay'
import { attachConnectLaneMetadata, type ConnectLaneContext, type ConnectLaneFlags } from './connectLaneMetadata'
import type { StepNodeData } from '../components/connect/ConnectStepFlow'

export type { ConnectLaneFlags, ConnectLaneContext }

const LANE_SHORT: Record<string, string> = {
  github: 'GitHub',
  sdk: 'SDK',
  mcp: 'MCP',
  cli: 'CLI',
  upgrade: 'Upgrade PR',
  native_ci: 'Native CI',
}

export function buildConnectStepLanes(ctx: ConnectLaneContext): StepNodeData[] {
  const overlays = CONNECT_SETUP_LANES.map((lane) => ({
    lane,
    overlay: connectLaneOverlay(lane.id, ctx),
  }))

  let currentAssigned = false
  const lanes = overlays.map(({ lane, overlay }, i) => {
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
      laneId: lane.id,
      label: lane.label,
      shortLabel: LANE_SHORT[lane.id] ?? lane.label,
      plain: lane.plain,
      posture,
      overlayPosture: overlay.posture,
      metric: overlay.metric,
      actionLine: overlay.actionLine,
      actionHref: overlay.actionHref,
      stepIdx: i,
      totalSteps: CONNECT_SETUP_LANES.length,
    }
  })

  return attachConnectLaneMetadata(lanes, ctx)
}
