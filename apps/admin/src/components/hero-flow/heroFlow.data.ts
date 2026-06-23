/**
 * FILE: apps/admin/src/components/hero-flow/heroFlow.data.ts
 * PURPOSE: Builds React Flow nodes and edges for the page-hero `<HeroFlow />`
 *          Decide / Act / Verify narrative diagram (three-node lane layout).
 */
import type { Edge, Node } from '@xyflow/react'

import { readVizToken } from '../../lib/vizTokens'
import type { PageAction } from '../PageActionBar'
import type { DavEvidence } from '../../lib/davManifest'
import type { OperatorTraceLine } from './operatorTrace'

export type HeroSeverity = 'ok' | 'info' | 'warn' | 'crit' | 'neutral'

/** Hex tints used inside SVG `<defs>` (CSS variables don't always resolve
 *  in `<linearGradient>` across browsers — we keep the source of truth in
 *  TS so a theme tweak only touches one file. Aligned with the dashboard
 *  flow's `flowTokens.ts` so the two flows feel like one system. */
export const HERO_SEVERITY_HEX: Record<HeroSeverity, string> = {
  ok: readVizToken('viz-score-ok'),
  info: readVizToken('viz-flow-info'),
  warn: readVizToken('viz-score-warn'),
  crit: readVizToken('viz-flow-danger'),
  neutral: readVizToken('viz-neutral'),
}

export const HERO_ACTION_TONE_HEX: Record<PageAction['tone'], string> = {
  plan: readVizToken('viz-flow-info'),
  do: readVizToken('viz-flow-brand'),
  check: readVizToken('viz-score-warn'),
  act: readVizToken('viz-score-ok'),
  idle: readVizToken('viz-neutral'),
}

export interface HeroDecideData {
  label: string
  metric?: string
  summary: string
  severity: HeroSeverity
  /** data-dav-anchor value for on-page spotlight. */
  anchor?: string
  /** Structured live data for the detail panel. */
  evidence?: DavEvidence
  /** configDocs IDs that are currently unset/blocking. */
  missingConfigIds?: string[]
  debugLines?: OperatorTraceLine[]
}

export interface HeroActIdle {
  label: string
  metric?: string
  summary: string
}

export interface HeroActData {
  /** When `null`, the node renders contextual idle copy from `idle`. */
  action: PageAction | null
  /** Shown when `action` is null — driven by live nav-meta, not generic filler. */
  idle?: HeroActIdle
  /** data-dav-anchor value for on-page spotlight. */
  anchor?: string
  /** Structured live data for the detail panel. */
  evidence?: DavEvidence
  /** configDocs IDs that are currently unset/blocking. */
  missingConfigIds?: string[]
  debugLines?: OperatorTraceLine[]
}

export interface HeroVerifyData {
  label: string
  detail: string
  to?: string
  secondaryTo?: string
  secondaryLabel?: string
  /** data-dav-anchor value for on-page spotlight. */
  anchor?: string
  /** Structured live data for the detail panel. */
  evidence?: DavEvidence
  /** configDocs IDs that are currently unset/blocking. */
  missingConfigIds?: string[]
  debugLines?: OperatorTraceLine[]
}

export interface HeroNodeBaseData extends Record<string, unknown> {
  scope: string
  expanded: boolean
  onToggle: () => void
  /** Collapsed-tile trace preview (built in PageHero). */
  operatorTrace?: OperatorTraceLine[]
}

export interface HeroDecideNodeData extends HeroNodeBaseData {
  kind: 'decide'
  decide: HeroDecideData
  /** Optional accessory rendered in the compact (non-expanded) body. */
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
  /** Warn/crit pages get a faint tinted rail even when idle. */
  severityTint?: boolean
  /** Full metadata label (tooltip when truncated). */
  label?: string
  /** Single-line display copy for the edge pill. */
  labelDisplay?: string
  /** When true, hover reveals `label` in a tooltip. */
  labelTruncated?: boolean
  /** Max pill width — long copy uses truncate + tooltip. */
  labelMaxWidth?: number
}

/** Compact edge-pill copy — breaks on a word boundary when possible. */
export function formatHeroEdgeLabel(
  text: string,
  maxLen = 28,
): { display: string; full: string; truncated: boolean } {
  const full = text.trim()
  if (full.length <= maxLen) {
    return { display: full, full, truncated: false }
  }
  const slice = full.slice(0, maxLen)
  const lastSpace = slice.lastIndexOf(' ')
  const cut = lastSpace >= 10 ? lastSpace : maxLen
  return {
    display: `${full.slice(0, cut).trimEnd()}…`,
    full,
    truncated: true,
  }
}

// ─── Layout ────────────────────────────────────────────────────────────
//
// Three stations on a single horizontal lane. Positions are derived from
// the live container width so the hero stretches with the page instead of
// sitting in a fixed ~910px band with dead margins on wide screens.

const DEFAULT_NODE_WIDTH = 250
/** Content-sized lane height — every tile (Decide / Act+CTA / Verify+proof)
 *  fits in this band with its action row pinned to the bottom, so the lane
 *  reads as one aligned strip without dead vertical whitespace. */
const DEFAULT_NODE_HEIGHT = 118
const DEFAULT_NODE_GAP = 80

export interface HeroLayoutMetrics {
  nodeWidth: number
  nodeHeight: number
  /** Act tile is slightly taller when a primary CTA is present. */
  actNodeHeight: number
  actOffsetY: number
  gap: number
  /** Max width for edge midpoint pills — derived from gap so long copy wraps
   *  instead of overlapping the next node. */
  labelMaxWidth: number
  positions: {
    decide: { x: number; y: number }
    act: { x: number; y: number }
    verify: { x: number; y: number }
  }
  totalWidth: number
}

/** Compute node geometry from the hero container's client width. */
export function computeHeroLayout(
  containerWidth: number,
  opts?: { expanded?: boolean; hasActiveCta?: boolean },
): HeroLayoutMetrics {
  const padding = 12
  const usable = Math.max(360, containerWidth - padding * 2)
  const minNode = 168
  const maxNode = 420
  // Gaps are the "label channels" between nodes — keep them wide enough that
  // edge pills can wrap to 2–3 readable lines instead of one char per line.
  const minGap = 64
  const maxGap = 112

  let gap = Math.min(maxGap, Math.max(minGap, Math.floor(usable * 0.11)))
  let nodeWidth = Math.floor((usable - 2 * gap) / 3)
  nodeWidth = Math.min(maxNode, Math.max(minNode, nodeWidth))

  // If nodes hit max width, pour leftover space into wider gaps (pill room).
  const slack = usable - (3 * nodeWidth + 2 * gap)
  if (slack > 0) {
    gap = Math.min(maxGap, gap + Math.floor(slack / 2))
  }

  const totalWidth = 3 * nodeWidth + 2 * gap
  const offsetX = padding + Math.max(0, (usable - totalWidth) / 2)
  const laneHeight = opts?.expanded ? 150 : DEFAULT_NODE_HEIGHT

  return {
    nodeWidth,
    nodeHeight: laneHeight,
    actNodeHeight: laneHeight,
    actOffsetY: 0,
    gap,
    labelMaxWidth: Math.max(80, Math.min(160, Math.floor(gap * 0.5))),
    positions: {
      decide: { x: offsetX, y: 0 },
      act: { x: offsetX + nodeWidth + gap, y: 0 },
      verify: { x: offsetX + 2 * (nodeWidth + gap), y: 0 },
    },
    totalWidth: offsetX + totalWidth + padding,
  }
}

const FALLBACK_LAYOUT = computeHeroLayout(
  3 * DEFAULT_NODE_WIDTH + 2 * DEFAULT_NODE_GAP + 24,
)

export const HERO_FLOW_LAYOUT = {
  nodeWidth: DEFAULT_NODE_WIDTH,
  nodeHeight: DEFAULT_NODE_HEIGHT,
  gap: DEFAULT_NODE_GAP,
  totalWidth: FALLBACK_LAYOUT.totalWidth,
  totalHeight: DEFAULT_NODE_HEIGHT,
} as const

interface BuildHeroFlowInput {
  scope: string
  decide: HeroDecideData
  act: HeroActData
  verify: HeroVerifyData
  layout: HeroLayoutMetrics
  /** Per-tile expand state. Owned by `<HeroFlow />` and threaded into
   *  each node's data so the custom node component can render its
   *  expanded body inside the React Flow node tree (rather than a sibling
   *  layer that would lose alignment with the node body). */
  expanded: 'decide' | 'act' | 'verify' | null
  onToggle: (tile: 'decide' | 'act' | 'verify') => void
  /** Optional decide accessory (sparkline, trend chip). */
  decideAccessory?: unknown
  operatorTraces?: {
    decide: OperatorTraceLine[]
    act: OperatorTraceLine[]
    verify: OperatorTraceLine[]
  }
}

export function buildHeroNodes(input: BuildHeroFlowInput): Node<HeroNodeData>[] {
  const { layout } = input
  const baseProps = {
    draggable: false,
    connectable: false,
    selectable: false,
    width: layout.nodeWidth,
    height: layout.nodeHeight,
  }
  return [
    {
      ...baseProps,
      id: 'decide',
      type: 'heroDecide',
      position: layout.positions.decide,
      data: {
        kind: 'decide',
        scope: input.scope,
        decide: input.decide,
        accessory: input.decideAccessory,
        expanded: input.expanded === 'decide',
        onToggle: () => input.onToggle('decide'),
        operatorTrace: input.operatorTraces?.decide,
      } satisfies HeroDecideNodeData,
    },
    {
      ...baseProps,
      id: 'act',
      type: 'heroAct',
      position: layout.positions.act,
      height: layout.nodeHeight,
      data: {
        kind: 'act',
        scope: input.scope,
        act: input.act,
        expanded: input.expanded === 'act',
        onToggle: () => input.onToggle('act'),
        operatorTrace: input.operatorTraces?.act,
      } satisfies HeroActNodeData,
    },
    {
      ...baseProps,
      id: 'verify',
      type: 'heroVerify',
      position: layout.positions.verify,
      data: {
        kind: 'verify',
        scope: input.scope,
        verify: input.verify,
        expanded: input.expanded === 'verify',
        onToggle: () => input.onToggle('verify'),
        operatorTrace: input.operatorTraces?.verify,
      } satisfies HeroVerifyNodeData,
    },
  ]
}

// Re-export DavEvidence so consumers can import from one hero-flow location.
export type { DavEvidence }

export function buildHeroEdges(input: {
  decide: HeroDecideData
  act: HeroActData
  verify: HeroVerifyData
  layout: HeroLayoutMetrics
}): Edge<HeroEdgeData>[] {
  const decideHex = HERO_SEVERITY_HEX[input.decide.severity]
  const actHex = input.act.action
    ? HERO_ACTION_TONE_HEX[input.act.action.tone]
    : HERO_ACTION_TONE_HEX.idle
  const verifyHex = HERO_SEVERITY_HEX.ok

  const failingFirst = input.decide.severity === 'crit'
  const failingSecond = false
  const needsAttention =
    input.decide.severity === 'warn' ||
    input.decide.severity === 'crit' ||
    Boolean(input.act.action)
  const flowingFirst = needsAttention
  const flowingSecond = needsAttention && Boolean(input.verify.to)
  const severityIdle =
    input.decide.severity === 'warn' || input.decide.severity === 'crit'

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
        severityTint: severityIdle,
        label: input.act.action?.reason ?? input.decide.summary,
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
        severityTint: false,
        label: input.verify.detail,
      },
    },
  ]
}
