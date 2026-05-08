/**
 * FILE: apps/admin/src/components/hero-flow/heroFlow.data.ts
 * PURPOSE: Factory helpers that turn the per-page Decide / Act / Verify
 *          payload into React Flow nodes + edges for `<HeroFlow />`. The
 *          three-node, two-edge "lane" layout is hard-coded — this is a
 *          narrative diagram of the operator's loop on a single page, NOT
 *          a draggable canvas. Variants like `pdcaFlow.data.ts`, but
 *          purpose-built for the page hero (3 stations, not 4).
 *
 *          Wave V (2026-05-08): refactor of `PageHero` away from the
 *          5-column flex grid + CSS marching dots. The same Decide / Act /
 *          Verify props now drive a real ReactFlow canvas so the hero
 *          shares the dashboard's flow vocabulary (gradient bezier edges,
 *          severity-tinted ribbon, hover lift, click-to-expand).
 */
import type { Edge, Node } from '@xyflow/react'

import type { PageAction } from '../PageActionBar'

export type HeroSeverity = 'ok' | 'info' | 'warn' | 'crit' | 'neutral'

/** Hex tints used inside SVG `<defs>` (CSS variables don't always resolve
 *  in `<linearGradient>` across browsers — we keep the source of truth in
 *  TS so a theme tweak only touches one file. Aligned with the dashboard
 *  flow's `flowTokens.ts` so the two flows feel like one system. */
export const HERO_SEVERITY_HEX: Record<HeroSeverity, string> = {
  ok: '#34d399',
  info: '#60a5fa',
  warn: '#fbbf24',
  crit: '#ef4444',
  neutral: '#94a3b8',
}

export const HERO_ACTION_TONE_HEX: Record<PageAction['tone'], string> = {
  plan: '#60a5fa',
  do: '#f5b544',
  check: '#fbbf24',
  act: '#34d399',
  idle: '#94a3b8',
}

export interface HeroDecideData {
  label: string
  metric?: string
  summary: string
  severity: HeroSeverity
}

export interface HeroActData {
  /** When `null`, the node renders an "all clear" calm state. */
  action: PageAction | null
}

export interface HeroVerifyData {
  label: string
  detail: string
  to?: string
  secondaryTo?: string
  secondaryLabel?: string
}

export interface HeroNodeBaseData extends Record<string, unknown> {
  scope: string
  expanded: boolean
  onToggle: () => void
}

export interface HeroDecideNodeData extends HeroNodeBaseData {
  kind: 'decide'
  decide: HeroDecideData
  /** Optional accessory rendered in the expanded body. */
  accessory?: unknown
}

export interface HeroActNodeData extends HeroNodeBaseData {
  kind: 'act'
  act: HeroActData
}

export interface HeroVerifyNodeData extends HeroNodeBaseData {
  kind: 'verify'
  verify: HeroVerifyData
}

export type HeroNodeData = HeroDecideNodeData | HeroActNodeData | HeroVerifyNodeData

export interface HeroEdgeData extends Record<string, unknown> {
  sourceColor: string
  targetColor: string
  flowing?: boolean
  failing?: boolean
  /** Short metadata label rendered at the edge midpoint via
   *  EdgeLabelRenderer. Derived from real page data — never stubbed. */
  label?: string
}

// ─── Layout ────────────────────────────────────────────────────────────
//
// Three stations on a single horizontal lane. Width chosen so the canvas
// fits a 1024px-wide page chrome at md+ without horizontal scroll, and so
// the bezier between siblings has enough horizontal slack to bend rather
// than reading as a straight line.

const NODE_WIDTH = 250
const NODE_HEIGHT = 152
const NODE_GAP = 110

const POSITIONS = {
  decide: { x: 0, y: 0 },
  act: { x: NODE_WIDTH + NODE_GAP, y: 0 },
  verify: { x: 2 * (NODE_WIDTH + NODE_GAP), y: 0 },
} as const

export const HERO_FLOW_LAYOUT = {
  nodeWidth: NODE_WIDTH,
  nodeHeight: NODE_HEIGHT,
  gap: NODE_GAP,
  totalWidth: 3 * NODE_WIDTH + 2 * NODE_GAP,
  totalHeight: NODE_HEIGHT,
} as const

interface BuildHeroFlowInput {
  scope: string
  decide: HeroDecideData
  act: HeroActData
  verify: HeroVerifyData
  /** Per-tile expand state. Owned by `<HeroFlow />` and threaded into
   *  each node's data so the custom node component can render its
   *  expanded body inside the React Flow node tree (rather than a sibling
   *  layer that would lose alignment with the node body). */
  expanded: 'decide' | 'act' | 'verify' | null
  onToggle: (tile: 'decide' | 'act' | 'verify') => void
  /** Optional decide accessory (sparkline, trend chip). */
  decideAccessory?: unknown
}

export function buildHeroNodes(input: BuildHeroFlowInput): Node<HeroNodeData>[] {
  const baseProps = {
    draggable: false,
    connectable: false,
    selectable: false,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
  }
  return [
    {
      ...baseProps,
      id: 'decide',
      type: 'heroDecide',
      position: POSITIONS.decide,
      data: {
        kind: 'decide',
        scope: input.scope,
        decide: input.decide,
        accessory: input.decideAccessory,
        expanded: input.expanded === 'decide',
        onToggle: () => input.onToggle('decide'),
      } satisfies HeroDecideNodeData,
    },
    {
      ...baseProps,
      id: 'act',
      type: 'heroAct',
      position: POSITIONS.act,
      data: {
        kind: 'act',
        scope: input.scope,
        act: input.act,
        expanded: input.expanded === 'act',
        onToggle: () => input.onToggle('act'),
      } satisfies HeroActNodeData,
    },
    {
      ...baseProps,
      id: 'verify',
      type: 'heroVerify',
      position: POSITIONS.verify,
      data: {
        kind: 'verify',
        scope: input.scope,
        verify: input.verify,
        expanded: input.expanded === 'verify',
        onToggle: () => input.onToggle('verify'),
      } satisfies HeroVerifyNodeData,
    },
  ]
}

export function buildHeroEdges(input: {
  decide: HeroDecideData
  act: HeroActData
  verify: HeroVerifyData
}): Edge<HeroEdgeData>[] {
  const decideHex = HERO_SEVERITY_HEX[input.decide.severity]
  const actHex = input.act.action
    ? HERO_ACTION_TONE_HEX[input.act.action.tone]
    : HERO_ACTION_TONE_HEX.idle
  const verifyHex = HERO_SEVERITY_HEX.neutral

  const failingFirst = input.decide.severity === 'crit'
  const failingSecond = false
  const hasAction = Boolean(input.act.action)
  const flowingFirst = hasAction || failingFirst
  const flowingSecond = hasAction && Boolean(input.verify.to)

  // Derive real metadata labels from the page data — no stubs.
  const firstLabel = hasAction
    ? input.act.action!.title.length > 30
      ? input.act.action!.title.slice(0, 28) + '…'
      : input.act.action!.title
    : input.decide.severity !== 'neutral' && input.decide.severity !== 'ok'
      ? input.decide.severity
      : undefined
  const secondLabel = input.verify.to
    ? 'evidence'
    : undefined

  return [
    {
      id: 'decide->act',
      source: 'decide',
      target: 'act',
      sourceHandle: 'out',
      targetHandle: 'in',
      type: 'heroGradient',
      data: {
        sourceColor: decideHex,
        targetColor: actHex,
        flowing: flowingFirst,
        failing: failingFirst,
        label: firstLabel,
      },
    },
    {
      id: 'act->verify',
      source: 'act',
      target: 'verify',
      sourceHandle: 'out',
      targetHandle: 'in',
      type: 'heroGradient',
      data: {
        sourceColor: actHex,
        targetColor: verifyHex,
        flowing: flowingSecond,
        failing: failingSecond,
        label: secondLabel,
      },
    },
  ]
}
