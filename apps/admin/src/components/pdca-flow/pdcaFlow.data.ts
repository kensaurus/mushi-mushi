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

import type { Edge, Node } from '@xyflow/react'
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
  /** When true the edge adds the traveling-dots overlay on top of the
   *  marching-ants. Communicates "data is flowing RIGHT NOW," not just
   *  "this is the focus direction." */
  flowing?: boolean
}

// Fixed positions. ReactFlow coordinates — we center each node manually
// so the diamond reads as P (left) → D (top) → C (right) → A (bottom) → P.
// The viewBox auto-fits via fitView + padding.
const POSITIONS: Record<PdcaStageId, { x: number; y: number }> = {
  plan: { x: 0, y: 120 },
  do: { x: 240, y: 0 },
  check: { x: 480, y: 120 },
  act: { x: 240, y: 240 },
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
): Edge<PdcaEdgeData>[] {
  // P → D → C → A → P. The last edge closes the loop so users see that
  // shipped fixes re-enter the Plan stage as new signal.
  const pairs: Array<[PdcaStageId, PdcaStageId]> = [
    ['plan', 'do'],
    ['do', 'check'],
    ['check', 'act'],
    ['act', 'plan'],
  ]
  return pairs.map(([source, target]) => ({
    id: `${source}->${target}`,
    source,
    target,
    type: 'pdcaGradient',
    sourceHandle: 'out',
    targetHandle: 'in',
    animated: source === focusStage || source === runningStage,
    data: {
      sourceColor: STAGE_HEX[source],
      targetColor: STAGE_HEX[target],
      sourceStageId: source,
      flowing: source === runningStage,
    },
  }))
}
