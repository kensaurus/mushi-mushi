/**
 * FILE: apps/admin/src/components/connect/ConnectStepFlow.tsx
 * PURPOSE: Compact horizontal ReactFlow showing the 6 connect-setup lanes
 *          (GitHub → SDK → MCP → CLI → Upgrade → Native CI) with live status
 *          rings. Purely static — no drag/zoom/selection.
 *
 * Design:
 *  - "done"    node: green ring + checkmark
 *  - "current" node: brand ring + pulsing dot (first incomplete lane)
 *  - "todo"    node: muted ring
 *  - Edges connect left→right with an animated stroke for the current pair
 *  - md+: ReactFlow diagram; below md: accessible vertical step list
 *
 * Layout:
 *  - Fixed node width; positions spread evenly across the measured container
 *  - Horizontal scroll when the container is narrower than the minimum canvas
 *  - Vertical padding keeps nodes centered in the canvas (no top-clipped look)
 *
 * Accessibility: diagram has role="img" + aria-label; mobile list is keyboard-
 * reachable; full lane detail stays in WorkflowStageRow list below.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Handle,
  Position,
  useReactFlow,
  type Node,
  type Edge,
  type NodeProps,
  type NodeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { WorkflowPosture } from '../../lib/guideLiveOverlay'
import type { LaneMetaFact, LaneMetaTone } from '../../lib/connectLaneMetadata'
import { ConnectStepLaneReadout } from './ConnectStepLaneReadout'

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
const NODE_H = 78
const STEP_GAP_MIN = 16
const CANVAS_PAD_X = 12
const CANVAS_PAD_Y = 10

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------
function nodeRing(posture: StepNodeData['posture']): string {
  switch (posture) {
    case 'clear':
    case 'ok':
      return 'ring-2 ring-ok/70'
    case 'current':
      return 'ring-2 ring-brand'
    case 'open':
    case 'warn':
    case 'danger':
      return 'ring-2 ring-warn/70'
    default:
      return 'ring-1 ring-edge-subtle'
  }
}

function nodeBg(posture: StepNodeData['posture']): string {
  switch (posture) {
    case 'clear':
    case 'ok':
      return 'bg-ok-muted/60'
    case 'current':
      return 'bg-brand-subtle/60'
    case 'open':
    case 'warn':
    case 'danger':
      return 'bg-warn-muted/40'
    default:
      return 'bg-surface-raised/60'
  }
}

function nodeTextTone(posture: StepNodeData['posture']): string {
  switch (posture) {
    case 'clear':
    case 'ok':
      return 'text-ok'
    case 'current':
      return 'text-brand'
    case 'open':
    case 'warn':
    case 'danger':
      return 'text-warning-foreground'
    default:
      return 'text-fg-faint'
  }
}

function nodeStatusMark(posture: StepNodeData['posture']): string {
  switch (posture) {
    case 'clear':
    case 'ok':
      return '✓'
    case 'current':
      return '→'
    case 'open':
    case 'warn':
    case 'danger':
      return '!'
    default:
      return String.fromCharCode(0x25cb) // ○
  }
}

/** Default selected lane: current step, else first incomplete, else first. */
export function pickDefaultConnectStepIndex(lanes: StepNodeData[]): number {
  const currentIdx = lanes.findIndex((l) => l.posture === 'current')
  if (currentIdx >= 0) return currentIdx
  const openIdx = lanes.findIndex((l) => l.posture !== 'clear' && l.posture !== 'ok')
  if (openIdx >= 0) return openIdx
  return 0
}

function postureLabel(posture: StepNodeData['posture']): string {
  if (posture === 'clear' || posture === 'ok') return 'done'
  if (posture === 'current') return 'in progress'
  if (posture === 'open' || posture === 'warn' || posture === 'danger') return 'needs attention'
  return 'pending'
}

function metaToneClass(tone: LaneMetaTone | undefined): string {
  switch (tone) {
    case 'ok':
      return 'text-ok'
    case 'warn':
      return 'text-warning-foreground'
    case 'info':
      return 'text-info'
    default:
      return 'text-fg-faint'
  }
}

// ---------------------------------------------------------------------------
// Custom node renderer
// ---------------------------------------------------------------------------
function StepNode({ data }: NodeProps<Node<StepNodeData>>) {
  const ring = nodeRing(data.posture)
  const bg = nodeBg(data.posture)
  const textTone = nodeTextTone(data.posture)
  const mark = nodeStatusMark(data.posture)
  const isCurrent = data.posture === 'current'
  const isSelected = Boolean(data.selected)
  const nodeWidth = data.nodeWidth ?? NODE_W

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      aria-label={`${data.label}, ${postureLabel(data.posture)}${isSelected ? ', selected' : ''}`}
      className={`relative flex flex-col items-center justify-center gap-0.5 rounded-lg px-1.5 py-1.5 text-center ${ring} ${bg} h-[78px] cursor-pointer transition-[transform,opacity] select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised ${
        isSelected ? 'ring-2 ring-brand shadow-sm scale-[1.02]' : 'hover:brightness-[1.03]'
      }`}
      style={{
        width: nodeWidth,
        minWidth: nodeWidth,
        boxShadow: isCurrent && !isSelected ? '0 0 0 3px var(--color-brand-subtle)' : undefined,
      }}
      title={data.label}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0, pointerEvents: 'none' }} tabIndex={-1} />
      <span className={`text-xs font-bold leading-none ${textTone} flex items-center gap-0.5`} aria-hidden="true">
        {isCurrent && (
          <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-brand motion-safe:animate-pulse" />
        )}
        {mark}
      </span>
      <span className="text-2xs font-medium leading-snug text-fg whitespace-normal break-words hyphens-auto px-0.5">
        {data.shortLabel}
      </span>
      {data.metaLine ? (
        <span
          className={`max-w-full truncate px-0.5 text-3xs font-semibold tabular-nums leading-none ${metaToneClass(data.metaTone)}`}
          title={data.metaLine}
        >
          {data.metaLine}
        </span>
      ) : (
        <span className="text-3xs text-fg-faint tabular-nums" aria-hidden="true">
          {data.stepIdx + 1}/{data.totalSteps}
        </span>
      )}
      <Handle type="source" position={Position.Right} style={{ opacity: 0, pointerEvents: 'none' }} tabIndex={-1} />
    </div>
  )
}

const NODE_TYPES = { step: StepNode }

/** Keep the graph pinned at the origin whenever the canvas is remeasured. */
function ViewportLock({ canvasW, canvasH }: { canvasW: number; canvasH: number }) {
  const { setViewport } = useReactFlow()
  useEffect(() => {
    void setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 0 })
  }, [setViewport, canvasW, canvasH])
  return null
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

function buildNodes(
  lanes: StepNodeData[],
  positions: number[],
  nodeW: number,
  nodeY: number,
  selectedIdx: number,
): Node<StepNodeData>[] {
  return lanes.map((data, i) => ({
    id: `step-${i}`,
    type: 'step',
    position: { x: positions[i] ?? 0, y: nodeY },
    data: { ...data, nodeWidth: nodeW, selected: i === selectedIdx },
    draggable: false,
    selectable: true,
    focusable: true,
  }))
}

function buildEdges(lanes: StepNodeData[]): Edge[] {
  return lanes.slice(0, -1).map((lane, i) => {
    const isActiveEdge = lane.posture === 'clear' && lanes[i + 1].posture === 'current'
    return {
      id: `e-${i}-${i + 1}`,
      source: `step-${i}`,
      target: `step-${i + 1}`,
      style: {
        stroke: isActiveEdge
          ? 'var(--color-brand)'
          : lane.posture === 'clear'
            ? 'var(--color-ok)'
            : 'var(--color-edge)',
        strokeWidth: isActiveEdge ? 2 : 1.5,
        strokeDasharray: isActiveEdge ? undefined : (lane.posture === 'info' ? '4,3' : undefined),
        opacity: 0.7,
      },
      animated: isActiveEdge,
    }
  })
}

/** Vertical, keyboard-friendly fallback for narrow viewports. */
export function ConnectStepPipelineList({
  lanes,
  selectedIdx,
  onSelect,
  renderLaneIcon,
}: {
  lanes: StepNodeData[]
  selectedIdx: number
  onSelect: (idx: number) => void
  renderLaneIcon?: (laneId: string | undefined) => ReactNode
}) {
  return (
    <ol className="md:hidden space-y-1.5" aria-label="Install pipeline steps">
      {lanes.map((lane, idx) => {
        const ring = nodeRing(lane.posture)
        const bg = nodeBg(lane.posture)
        const textTone = nodeTextTone(lane.posture)
        const isSelected = idx === selectedIdx
        return (
          <li key={`${lane.shortLabel}-${lane.stepIdx}`}>
            <button
              type="button"
              onClick={() => onSelect(idx)}
              aria-expanded={isSelected}
              className={`flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                isSelected ? 'border-brand/40 bg-brand-subtle/30' : `border-edge-subtle ${bg}`
              }`}
            >
              <span
                className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-sm font-bold ${ring} ${textTone}`}
                aria-hidden="true"
              >
                {nodeStatusMark(lane.posture)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-fg">{lane.label}</p>
                {lane.metaLine ? (
                  <p className={`text-3xs font-semibold tabular-nums truncate ${metaToneClass(lane.metaTone)}`}>
                    {lane.metaLine}
                  </p>
                ) : (
                  <p className="text-3xs text-fg-muted">
                    Step {lane.stepIdx + 1} of {lane.totalSteps} · {postureLabel(lane.posture)}
                  </p>
                )}
              </div>
            </button>
            {isSelected ? (
              <ConnectStepLaneReadout
                lane={lane}
                icon={renderLaneIcon?.(lane.laneId)}
                className="mt-1.5"
              />
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}

export interface ConnectStepFlowProps {
  lanes: StepNodeData[]
  renderLaneIcon?: (laneId: string | undefined) => ReactNode
}

export function ConnectStepFlow({ lanes, renderLaneIcon }: ConnectStepFlowProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [selectedIdx, setSelectedIdx] = useState(() => pickDefaultConnectStepIndex(lanes))

  useEffect(() => {
    setSelectedIdx(pickDefaultConnectStepIndex(lanes))
  }, [lanes])

  const onNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    const idx = Number(node.id.replace('step-', ''))
    if (!Number.isNaN(idx)) setSelectedIdx(idx)
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => setContainerWidth(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /** Fallback width when ResizeObserver has not fired yet — avoids empty md+ canvas. */
  const measuredWidth =
    containerWidth > 0 ? containerWidth : minConnectStepCanvasWidth(lanes.length)

  const layout = useMemo(
    () => buildConnectStepNodePositions(lanes.length, measuredWidth),
    [lanes.length, measuredWidth],
  )

  const canvasW = layout.canvasW
  const canvasH = NODE_H + CANVAS_PAD_Y * 2
  const nodeY = CANVAS_PAD_Y
  const selectedLane = lanes[selectedIdx] ?? lanes[0]

  const nodes = useMemo(
    () => buildNodes(lanes, layout.positions, NODE_W, nodeY, selectedIdx),
    [lanes, layout.positions, nodeY, selectedIdx],
  )
  const edges = useMemo(() => buildEdges(lanes), [lanes])

  const ariaSummary = lanes
    .map((l) => `${l.shortLabel} (${postureLabel(l.posture)})`)
    .join(' → ')

  return (
    <div className="space-y-2">
      <ConnectStepPipelineList
        lanes={lanes}
        selectedIdx={selectedIdx}
        onSelect={setSelectedIdx}
        renderLaneIcon={renderLaneIcon}
      />
      <div
        ref={containerRef}
        className="connect-step-flow relative hidden w-full min-w-0 md:block"
        role="group"
        aria-label={`Connect setup pipeline: ${ariaSummary}. Select a step for details.`}
      >
        <p className="mb-1.5 px-1 text-3xs text-fg-faint">
          Tap a step · <span className="text-fg-muted">{selectedLane?.shortLabel ?? '—'}</span>
        </p>
        <div
          className="connect-step-flow__scroll w-full min-w-0 overflow-x-auto overscroll-x-contain scroll-smooth"
          style={{ height: canvasH }}
        >
          <div
            className="connect-step-flow__canvas shrink-0"
            style={{
              height: canvasH,
              width: canvasW,
              minWidth: canvasW,
            }}
          >
            <ReactFlowProvider>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={NODE_TYPES}
                onNodeClick={onNodeClick}
                defaultViewport={{ x: 0, y: 0, zoom: 1 }}
                proOptions={{ hideAttribution: true }}
                panOnDrag={false}
                panOnScroll={false}
                zoomOnScroll={false}
                zoomOnPinch={false}
                zoomOnDoubleClick={false}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={false}
                preventScrolling={false}
                minZoom={1}
                maxZoom={1}
                tabIndex={-1}
                className="connect-step-flow__graph"
                style={{ width: canvasW, height: canvasH }}
              >
                <ViewportLock canvasW={canvasW} canvasH={canvasH} />
              </ReactFlow>
            </ReactFlowProvider>
          </div>
        </div>
        {selectedLane ? (
          <ConnectStepLaneReadout
            lane={selectedLane}
            icon={renderLaneIcon?.(selectedLane.laneId)}
          />
        ) : null}
      </div>
    </div>
  )
}
