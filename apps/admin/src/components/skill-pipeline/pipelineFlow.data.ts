/**
 * FILE: apps/admin/src/components/skill-pipeline/pipelineFlow.data.ts
 * PURPOSE: Generic pipeline flow factory — maps N arbitrary steps (a skill
 *          chain) to React Flow nodes + edges, reusing PdcaGradientEdge and
 *          a new SkillStepNode for rendering. Layout is a horizontal row with
 *          a fixed step width, leaving room for the chain to grow dynamically.
 *
 *          Unlike pdcaFlow.data.ts (4 fixed PDCA stages), this factory handles
 *          1..N steps derived from agent_skills.chain_slugs at run creation time.
 */

import { MarkerType, type Edge, type Node } from '@xyflow/react'

import { readVizToken, stepStatusColor } from '../../lib/vizTokens'

// ── Step status colours ───────────────────────────────────────────────────────
export const STEP_STATUS_HEX: Record<string, string> = {
  pending: readVizToken('viz-step-pending'),
  running: readVizToken('viz-step-running'),
  passed: readVizToken('viz-step-passed'),
  failed: readVizToken('viz-step-failed'),
  skipped: readVizToken('viz-step-skipped'),
}

/** Runtime reader — prefers live CSS token over module-init fallback. */
export function resolveStepStatusColor(status: string): string {
  return stepStatusColor(status)
}

export const STEP_STATUS_LABEL: Record<string, string> = {
  pending:  'Pending',
  running:  'Running',
  passed:   'Passed',
  failed:   'Failed',
  skipped:  'Skipped',
}

// ── Node data ─────────────────────────────────────────────────────────────────

export interface PipelineStepNodeData extends Record<string, unknown> {
  stepIndex: number
  skillSlug: string
  skillTitle: string
  status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped'
  agentRef?: string | null
  prUrl?: string | null
  notes?: string | null
  /** Whether this is the currently-active step. */
  isCurrent: boolean
}

// Shape consumed by the reused PdcaGradientEdge renderer (type: 'pdcaGradient').
// It reads sourceColor/targetColor/edgeLabel/flowing/failing only — the PDCA
// edge's stage-id fields are inspector-only and not needed for pipeline edges.
export interface PipelineEdgeData extends Record<string, unknown> {
  sourceColor: string
  targetColor: string
  edgeLabel: string
  flowing: boolean
  failing: boolean
}

// ── Layout constants ──────────────────────────────────────────────────────────
const NODE_WIDTH = 200
const NODE_HEIGHT = 120
const GAP = 40
const INSET_X = 24
const INSET_Y = 16

// ── Factory ───────────────────────────────────────────────────────────────────

export interface PipelineStep {
  step_index: number
  skill_slug: string
  status: string
  agent_ref?: string | null
  pr_url?: string | null
  notes?: string | null
}

export interface SkillInfo {
  slug: string
  title: string
}

export function buildPipelineNodes(
  steps: PipelineStep[],
  skillInfoMap: Map<string, SkillInfo>,
): Node<PipelineStepNodeData>[] {
  return steps.map((step) => {
    const info = skillInfoMap.get(step.skill_slug)
    const x = INSET_X + step.step_index * (NODE_WIDTH + GAP)
    const currentStatuses: string[] = ['running']
    return {
      id: `step-${step.step_index}`,
      type: 'skillStep',
      position: { x, y: INSET_Y },
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      draggable: false,
      connectable: false,
      selectable: false,
      data: {
        stepIndex: step.step_index,
        skillSlug: step.skill_slug,
        skillTitle: info?.title ?? step.skill_slug,
        status: (step.status as PipelineStepNodeData['status']) ?? 'pending',
        agentRef: step.agent_ref ?? null,
        prUrl: step.pr_url ?? null,
        notes: step.notes ?? null,
        isCurrent: currentStatuses.includes(step.status),
      },
    }
  })
}

export function buildPipelineEdges(steps: PipelineStep[]): Edge<PipelineEdgeData>[] {
  const edges: Edge<PipelineEdgeData>[] = []
  for (let i = 0; i < steps.length - 1; i++) {
    const src = steps[i]
    const tgt = steps[i + 1]
    const sourceColor = STEP_STATUS_HEX[src.status] ?? STEP_STATUS_HEX.pending
    const targetColor = STEP_STATUS_HEX[tgt.status] ?? STEP_STATUS_HEX.pending
    const failing = tgt.status === 'failed'
    const flowing = src.status === 'running'
    edges.push({
      id: `edge-${src.step_index}-${tgt.step_index}`,
      source: `step-${src.step_index}`,
      target: `step-${tgt.step_index}`,
      type: 'pdcaGradient',   // reuse the existing animated gradient edge
      sourceHandle: 'out',
      targetHandle: 'in',
      animated: flowing || failing,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 16,
        height: 16,
        color: failing ? readVizToken('viz-flow-danger') : targetColor,
      },
      data: {
        sourceColor,
        targetColor,
        edgeLabel: `Step ${i + 1}→${i + 2}`,
        flowing,
        failing,
      },
    })
  }
  return edges
}

/** Compute canvas width needed to fit all steps in a horizontal row. */
export function pipelineCanvasWidth(stepCount: number): number {
  return INSET_X * 2 + stepCount * NODE_WIDTH + Math.max(0, stepCount - 1) * GAP
}
