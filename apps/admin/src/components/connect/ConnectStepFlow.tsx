/**
 * FILE: apps/admin/src/components/connect/ConnectStepFlow.tsx
 * PURPOSE: Lane data shape and layout helpers for the 6 connect-setup lanes
 *          (GitHub → SDK → MCP → CLI → Upgrade → Native CI). The ReactFlow
 *          canvas that rendered them had no importer and was removed in the
 *          2026-10-16 dead-code pass.
 */

import type { WorkflowPosture } from '../../lib/guideLiveOverlay'
import type { LaneMetaFact, LaneMetaTone } from '../../lib/connectLaneMetadata'

// ---------------------------------------------------------------------------
// Node data shape
// ---------------------------------------------------------------------------
export interface StepNodeData {
  label: string
  shortLabel: string
  posture: WorkflowPosture | 'current'
  stepIdx: number
  totalSteps: number
  nodeWidth?: number
  laneId?: string
  plain?: string
  metric?: string
  actionLine?: string
  actionHref?: string
  overlayPosture?: WorkflowPosture
  selected?: boolean
  metaLine?: string
  metaTone?: LaneMetaTone
  facts?: LaneMetaFact[]
  [key: string]: unknown
}

const NODE_W = 108
const STEP_GAP_MIN = 16
const CANVAS_PAD_X = 12

/** Default selected lane: current step, else first incomplete, else first. */
export function pickDefaultConnectStepIndex(lanes: StepNodeData[]): number {
  const currentIdx = lanes.findIndex((l) => l.posture === 'current')
  if (currentIdx >= 0) return currentIdx
  const openIdx = lanes.findIndex((l) => l.posture !== 'clear' && l.posture !== 'ok')
  if (openIdx >= 0) return openIdx
  return 0
}

export function minConnectStepCanvasWidth(laneCount: number, nodeW = NODE_W): number {
  if (laneCount <= 0) return 0
  if (laneCount === 1) return nodeW + CANVAS_PAD_X * 2
  return laneCount * nodeW + (laneCount - 1) * STEP_GAP_MIN + CANVAS_PAD_X * 2
}

/** Evenly distribute fixed-width nodes across the measured container (scroll when too narrow). */
export function buildConnectStepNodePositions(
  laneCount: number,
  containerWidth: number,
  nodeW = NODE_W,
): { positions: number[]; canvasW: number } {
  const minCanvasW = minConnectStepCanvasWidth(laneCount, nodeW)
  const canvasW = Math.max(containerWidth, minCanvasW)

  if (laneCount <= 0) return { positions: [], canvasW }
  if (laneCount === 1) {
    return { positions: [(canvasW - nodeW) / 2], canvasW }
  }

  const innerSpan = canvasW - CANVAS_PAD_X * 2 - nodeW
  const step = innerSpan / (laneCount - 1)
  const positions = Array.from({ length: laneCount }, (_, i) => CANVAS_PAD_X + i * step)
  return { positions, canvasW }
}
