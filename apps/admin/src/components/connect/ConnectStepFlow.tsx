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
 *
 * Accessibility: the diagram has role="img" + aria-label; the full lane detail
 * stays in the expandable WorkflowStageRow list below it.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  type Node,
  type Edge,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { WorkflowPosture } from '../../lib/guideLiveOverlay'

// ---------------------------------------------------------------------------
// Node data shape
// ---------------------------------------------------------------------------
export interface StepNodeData {
  label: string
  shortLabel: string
  posture: WorkflowPosture | 'current'
  stepIdx: number
  totalSteps: number
  [key: string]: unknown
}

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

// ---------------------------------------------------------------------------
// Custom node renderer
// ---------------------------------------------------------------------------
function StepNode({ data }: NodeProps<Node<StepNodeData>>) {
  const ring = nodeRing(data.posture)
  const bg = nodeBg(data.posture)
  const textTone = nodeTextTone(data.posture)
  const mark = nodeStatusMark(data.posture)
  const isCurrent = data.posture === 'current'

  return (
    <div
      className={`relative flex flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-2 text-center ${ring} ${bg} w-[84px] h-[60px] transition-all select-none`}
      style={{ boxShadow: isCurrent ? '0 0 0 3px var(--color-brand-subtle)' : undefined }}
    >
      {/* Status indicator */}
      <span className={`text-xs font-bold leading-none ${textTone} flex items-center gap-0.5`}>
        {isCurrent && (
          <span
            className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-brand motion-safe:animate-pulse"
            aria-hidden="true"
          />
        )}
        {mark}
      </span>
      {/* Label */}
      <span className="text-2xs font-medium leading-tight text-fg line-clamp-2 max-w-full">
        {data.shortLabel}
      </span>
      {/* Step number */}
      <span className="text-3xs text-fg-faint tabular-nums">
        {data.stepIdx + 1}/{data.totalSteps}
      </span>
    </div>
  )
}

const NODE_TYPES = { step: StepNode }

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------
const NODE_W = 84
const NODE_H = 60
const STEP_GAP = 36

function buildNodes(lanes: StepNodeData[]): Node<StepNodeData>[] {
  return lanes.map((data, i) => ({
    id: `step-${i}`,
    type: 'step',
    position: { x: i * (NODE_W + STEP_GAP), y: 0 },
    data,
    draggable: false,
    selectable: false,
    focusable: false,
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

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export interface ConnectStepFlowProps {
  lanes: StepNodeData[]
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function ConnectStepFlow({ lanes }: ConnectStepFlowProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => setWidth(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const nodes = useMemo(() => buildNodes(lanes), [lanes])
  const edges = useMemo(() => buildEdges(lanes), [lanes])

  const canvasW = lanes.length * NODE_W + (lanes.length - 1) * STEP_GAP
  const canvasH = NODE_H + 16

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-x-auto"
      role="img"
      aria-label={`Connect setup pipeline: ${lanes.map((l) => `${l.shortLabel} (${l.posture === 'clear' ? 'done' : l.posture === 'current' ? 'in progress' : 'pending'})`).join(' → ')}`}
    >
      <div
        style={{ height: canvasH, width: Math.max(canvasW + 32, width) }}
        className="mx-auto"
      >
        {width > 0 && (
          <ReactFlowProvider>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={NODE_TYPES}
              fitView
              fitViewOptions={{ padding: 0.08, includeHiddenNodes: false }}
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
              minZoom={0.4}
              maxZoom={1}
            />
          </ReactFlowProvider>
        )}
      </div>
    </div>
  )
}
