/**
 * FILE: apps/admin/src/components/pdca-flow/pdcaFlow.data.ts
 * PURPOSE: Factory helpers that turn PDCA stage metadata into React Flow
 *          nodes + edges. The layout is intentionally fixed (4 nodes in
 *          a diamond loop) and never dragged — this is a narrative diagram,
 *          not a canvas editor — so we hard-code positions here rather
 *          than pulling in a layout engine.
 *
 *          Two variants:
 *            • `live`      — used on the dashboard; nodes carry real
 *                            counts, bottleneck strings, and a focus flag.
 *            • `onboarding`— used on OnboardingPage + FirstRunTour; nodes
 *                            carry outcome copy ("Capture user-felt bugs…")
 *                            instead of live numbers so first-run users
 *                            see what the loop *means*, not empty zeros.
 */

import { MarkerType, type Edge, type Node } from '@xyflow/react'
import { PDCA_ORDER, PDCA_STAGES, PDCA_STAGE_OUTCOMES } from '../../lib/pdca'
import type { PdcaStageId } from '../../lib/pdca'
import type { PdcaStage, PdcaStageTone } from '../dashboard/types'
import { STAGE_HEX } from '../flow-primitives/flowTokens'

export type PdcaFlowVariant = 'live' | 'onboarding'

export interface PdcaNodeData extends Record<string, unknown> {
  stageId: PdcaStageId
  letter: 'P' | 'D' | 'C' | 'A'
  title: string
  subtitle: string
  /** Live variant only: the living count (e.g. "12 waiting"). */
  count?: number
  countLabel?: string
  /** Live variant only: current bottleneck / clean state. */
  bottleneck?: string | null
  tone?: PdcaStageTone
  isFocus?: boolean
  /** Set when this stage is actively executing right now (dispatch in
   *  flight, judge running, etc.). Drives the running-glow. */
  isRunning?: boolean
  href: string
  ctaLabel: string
  /** 0..1 — optional per-stage health score (judge average, success rate).
   *  Drives the inline <StageHealthRing /> when present. */
  health?: number | null
}

export interface PdcaEdgeData extends Record<string, unknown> {
  sourceColor: string
  targetColor: string
  edgeLabel?: string
  /** Source node id — the gradient-edge animates when this stage is the
   *  current focus (i.e. the bottleneck is "here, act now"). */
  sourceStageId: PdcaStageId
  /** Target stage id — lets the inspector/drawer key off the segment the
   *  user clicked without parsing the edge id. */
  targetStageId: PdcaStageId
  /** When true the edge adds the traveling-dots overlay on top of the
   *  marching-ants. Communicates "data is flowing RIGHT NOW," not just
   *  "this is the focus direction." */
  flowing?: boolean
  /** When true the edge renders red-dashed to signal "data is getting
   *  stuck on this segment." Derived from the target stage's tone at the
   *  data layer so the edge component stays presentational. */
  failing?: boolean
}

// Fixed positions — horizontal row: Plan → Do → Check → Act, with a
// loop-back arc below connecting Act back to Plan via bottom handles.
// The 48px gap between nodes leaves room for the arrowhead without crowding.
const GAP = 48
const NODE_WIDTH = 220
const NODE_HEIGHT = 172
/** Left/top inset so loop-back arrowheads + markers stay inside fitView bounds. */
const LAYOUT_INSET_X = 36
const LAYOUT_INSET_Y = 8

const POSITIONS: Record<PdcaStageId, { x: number; y: number }> = {
  plan:  { x: LAYOUT_INSET_X,                             y: LAYOUT_INSET_Y },
  do:    { x: LAYOUT_INSET_X + NODE_WIDTH + GAP,         y: LAYOUT_INSET_Y },
  check: { x: LAYOUT_INSET_X + (NODE_WIDTH + GAP) * 2,   y: LAYOUT_INSET_Y },
  act:   { x: LAYOUT_INSET_X + (NODE_WIDTH + GAP) * 3,   y: LAYOUT_INSET_Y },
}

const STAGE_HREF: Record<PdcaStageId, string> = {
  plan: '/reports',
  do: '/fixes',
  check: '/judge',
  act: '/integrations',
}

const LIVE_CTA_LABEL: Record<PdcaStageId, string> = {
  plan: 'Open triage',
  do: 'Review drafts',
  check: 'Open scores',
  act: 'See integrations',
}

interface LiveNodeOptions {
  focusStage: PdcaStageId | null | undefined
  runningStage: PdcaStageId | null | undefined
}

function buildLiveNodes(stages: PdcaStage[], opts: LiveNodeOptions): Node<PdcaNodeData>[] {
  const byId = new Map(stages.map((s) => [s.id, s]))
  return PDCA_ORDER.map((id) => {
    const meta = PDCA_STAGES[id]
    const live = byId.get(id)
    return {
      id,
      type: 'pdcaStep',
      position: POSITIONS[id],
      width:  NODE_WIDTH,
      height: NODE_HEIGHT,
      draggable: false,
      connectable: false,
      selectable: false,
      data: {
        stageId: id,
        letter: meta.letter,
        title: meta.label,
        subtitle: live?.description ?? meta.hint,
        count: live?.count ?? 0,
        countLabel: live?.countLabel ?? '',
        bottleneck: live?.bottleneck ?? null,
        tone: live?.tone ?? 'ok',
        isFocus: opts.focusStage === id,
        isRunning: opts.runningStage === id,
        href: live?.cta.to ?? STAGE_HREF[id],
        ctaLabel: live?.cta.label ?? LIVE_CTA_LABEL[id],
      },
    }
  })
}

function buildOnboardingNodes(): Node<PdcaNodeData>[] {
  return PDCA_ORDER.map((id) => {
    const meta = PDCA_STAGES[id]
    const outcome = PDCA_STAGE_OUTCOMES[id]
    return {
      id,
      type: 'pdcaStep',
      position: POSITIONS[id],
      width:  NODE_WIDTH,
      height: NODE_HEIGHT,
      draggable: false,
      connectable: false,
      selectable: false,
      data: {
        stageId: id,
        letter: meta.letter,
        title: outcome.pipelineLabel,
        subtitle: outcome.outcome,
        href: STAGE_HREF[id],
        ctaLabel: outcome.headline,
      },
    }
  })
}

export function buildNodes(
  variant: PdcaFlowVariant,
  stages: PdcaStage[],
  focusStage: PdcaStageId | null | undefined,
  runningStage: PdcaStageId | null | undefined = null,
): Node<PdcaNodeData>[] {
  return variant === 'live'
    ? buildLiveNodes(stages, { focusStage, runningStage })
    : buildOnboardingNodes()
}

export function buildEdges(
  focusStage: PdcaStageId | null | undefined,
  runningStage: PdcaStageId | null | undefined = null,
  stages: PdcaStage[] = [],
): Edge<PdcaEdgeData>[] {
  // P → D → C → A → P. The last edge closes the loop so users see that
  // shipped fixes re-enter the Plan stage as new signal.
  // Forward edges: right→left handles follow the horizontal row naturally.
  // Loop-back (act→plan): uses dedicated bottom handles so the arc sweeps
  // below all four nodes instead of creating an ugly reverse S-curve.
  const EDGE_LABEL: Partial<Record<`${PdcaStageId}->${PdcaStageId}`, string>> = {
    'plan->do': 'Triage',
    'do->check': 'Draft',
    'check->act': 'Score',
    'act->plan': 'Loop',
  }
  const pairs: Array<[PdcaStageId, PdcaStageId, string, string]> = [
    ['plan',  'do',    'out',      'in'     ],
    ['do',    'check', 'out',      'in'     ],
    ['check', 'act',   'out',      'in'     ],
    ['act',   'plan',  'loop-out', 'loop-in'],
  ]
  const DANGER_HEX = '#ef4444'
  const toneById = new Map(stages.map((s) => [s.id, s.tone]))
  return pairs.map(([source, target, sourceHandle, targetHandle]) => {
    // Paint the segment red when the *target* stage is urgent.
    const failing = toneById.get(target) === 'urgent'
    const arrowColor = failing ? DANGER_HEX : STAGE_HEX[target]
    return {
      id: `${source}->${target}`,
      source,
      target,
      type: 'pdcaGradient',
      sourceHandle,
      targetHandle,
      animated: source === focusStage || source === runningStage || failing,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 18,
        height: 18,
        color: arrowColor,
      },
      data: {
        sourceColor: STAGE_HEX[source],
        targetColor: STAGE_HEX[target],
        edgeLabel: EDGE_LABEL[`${source}->${target}`],
        sourceStageId: source,
        targetStageId: target,
        flowing: source === runningStage,
        failing,
      },
    }
  })
}
