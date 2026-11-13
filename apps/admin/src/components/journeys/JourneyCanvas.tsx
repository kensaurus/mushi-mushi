/**
 * FILE: apps/admin/src/components/journeys/JourneyCanvas.tsx
 * PURPOSE: The Journey optimizer's flow map (React Flow + dagre, see
 *          journeyLayout.ts). Each card is a page with its visits and exit
 *          rate, coloured by its worst finding; each arrow is people moving
 *          between pages, thicker for more moves, dashed when no link on
 *          the page leads there. Clicking a card selects the page so the
 *          page beside the map can show its findings.
 */

import { createContext, memo, useContext, useMemo } from 'react'
import { BaseEdge, EdgeLabelRenderer, Handle, Position, ReactFlow, ReactFlowProvider, getBezierPath, type EdgeProps, type NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { FlowCanvasBackground } from '../flow-primitives/FlowCanvasBackground'
import { TONE_HEX } from '../flow-primitives/flowTokens'
import { readVizToken } from '../../lib/vizTokens'
import { CHIP_TONE } from '../../lib/chipTone'
import { KIND_LABEL, percent, type JourneyFinding, type JourneyMap } from '../../lib/journeys'
import { buildJourneyLayout, type JourneyEdgeData, type JourneyNodeData } from './journeyLayout'

const HANDLE_CLS = '!h-1.5 !w-1.5 !min-h-0 !min-w-0 !border-0 !bg-transparent'
const FIT_VIEW_OPTIONS = { padding: 0.12, maxZoom: 1.1, minZoom: 0.3 }
const PRO_OPTIONS = { hideAttribution: true }

interface Selection {
  selected: string | null
  onSelect: (path: string | null) => void
}
const SelectionContext = createContext<Selection | null>(null)

const SEVERITY_BORDER = {
  high: 'border-danger/70',
  medium: 'border-warn/70',
  low: 'border-edge',
} as const

function PageNodeInner({ data }: NodeProps) {
  const { node, severity, isRoot, share } = data as JourneyNodeData
  const sel = useContext(SelectionContext)
  const selected = sel?.selected === node.path
  const border = selected ? 'border-brand ring-2 ring-brand/40' : severity ? SEVERITY_BORDER[severity] : 'border-edge hover:border-brand/40'
  const issue = node.issues[0]
  return (
    <div className="relative h-full w-full">
      <Handle type="target" position={Position.Left} className={HANDLE_CLS} isConnectable={false} />
      <button
        type="button"
        onClick={() => sel?.onSelect(selected ? null : node.path)}
        aria-pressed={selected}
        aria-label={`${node.path}: ${node.visits} visits${issue ? `, ${KIND_LABEL[issue]}` : ''}`}
        title={node.path}
        className={`nodrag nopan flex h-full w-full flex-col justify-between overflow-hidden rounded-md border bg-surface-raised px-2.5 py-1.5 text-left shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 ${border}`}
      >
        {/* Share of all views as a thin bar along the top. */}
        <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-brand/70" style={{ width: `${Math.max(2, Math.round(share * 100))}%` }} />
        <span className="flex min-w-0 items-center gap-1">
          {isRoot && <span className={`shrink-0 rounded-sm border px-1 text-3xs font-semibold ${CHIP_TONE.brandSubtle}`}>START</span>}
          {node.broken && <span className={`shrink-0 rounded-sm border px-1 text-3xs font-semibold ${CHIP_TONE.dangerSubtle}`}>BROKEN</span>}
          <span className="min-w-0 truncate font-mono text-2xs text-fg">{node.path}</span>
        </span>
        <span className="flex items-center gap-2 text-3xs text-fg-muted">
          <span>{node.visits} {node.visits === 1 ? 'visit' : 'visits'}</span>
          {node.exitRate != null && <span>{percent(node.exitRate)} leave</span>}
          {node.depth != null && node.depth > 0 && <span>{node.depth} clicks</span>}
        </span>
        <span className="min-w-0 truncate text-3xs">
          {issue ? (
            <span className={severity === 'high' ? 'text-danger' : severity === 'medium' ? 'text-warn' : 'text-fg-faint'}>
              {KIND_LABEL[issue]}
              {node.issues.length > 1 ? ` +${node.issues.length - 1}` : ''}
            </span>
          ) : (
            <span className="text-fg-faint">{node.inScan ? `${node.inbound ?? 0} links in · ${node.outbound ?? 0} out` : 'seen in visits'}</span>
          )}
        </span>
      </button>
      <Handle type="source" position={Position.Right} className={HANDLE_CLS} isConnectable={false} />
    </div>
  )
}

function JourneyEdgeInner({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps) {
  const d = data as JourneyEdgeData
  const sel = useContext(SelectionContext)
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
  const [from, to] = id.split('->')
  const focused = sel?.selected != null && (sel.selected === from || sel.selected === to)
  const dimmed = sel?.selected != null && !focused
  const used = d.moves > 0
  const color = d.onIssue ? TONE_HEX.warn : used ? readVizToken('viz-flow-info') : readVizToken('viz-graph-muted')
  return (
    <>
      <BaseEdge
        path={path}
        style={{
          stroke: color,
          strokeWidth: d.width,
          opacity: dimmed ? 0.12 : used ? 0.75 : 0.35,
          strokeDasharray: used && d.hasScan && !d.linked ? '6 4' : !used ? '2 4' : undefined,
        }}
      />
      {used && (focused || d.width >= 4) && (
        <EdgeLabelRenderer>
          <span
            className="pointer-events-none absolute rounded-sm border border-edge-subtle bg-surface-raised px-1 font-mono text-3xs text-fg-secondary"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {d.moves}
          </span>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

const NODE_TYPES = { 'journey-page': memo(PageNodeInner) }
const EDGE_TYPES = { journey: memo(JourneyEdgeInner) }

interface Props {
  map: JourneyMap
  hasScan: boolean
  findings: JourneyFinding[]
  selected: string | null
  onSelect: (path: string | null) => void
}

export function JourneyCanvas({ map, hasScan, findings, selected, onSelect }: Props) {
  const layout = useMemo(() => buildJourneyLayout(map, hasScan, findings), [map, hasScan, findings])
  const selection = useMemo(() => ({ selected, onSelect }), [selected, onSelect])
  const height = Math.min(640, Math.max(320, layout.height + 80))
  return (
    <SelectionContext.Provider value={selection}>
      <div className="w-full overflow-hidden rounded-md border border-edge-subtle bg-surface" style={{ height }} data-testid="journey-canvas">
        <ReactFlowProvider>
          <ReactFlow
            nodes={layout.nodes}
            edges={layout.edges}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            fitView
            fitViewOptions={FIT_VIEW_OPTIONS}
            proOptions={PRO_OPTIONS}
            nodesDraggable={false}
            nodesConnectable={false}
            edgesFocusable={false}
            elementsSelectable={false}
            panOnDrag
            panOnScroll={false}
            zoomOnScroll={false}
            zoomOnPinch
            minZoom={0.3}
            maxZoom={1.6}
            onPaneClick={() => onSelect(null)}
          >
            <FlowCanvasBackground />
          </ReactFlow>
        </ReactFlowProvider>
      </div>
    </SelectionContext.Provider>
  )
}
