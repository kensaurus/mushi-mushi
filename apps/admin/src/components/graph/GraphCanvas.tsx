/**
 * FILE: apps/admin/src/components/graph/GraphCanvas.tsx
 * PURPOSE: ReactFlow visualization wrapper. Owns the canvas chrome
 *          (background, controls, minimap, pan/zoom hint above the canvas,
 *          legend, empty panel) so the page can stay focused on data + state.
 */

import { useEffect, useState } from 'react'
import { Card } from '../../components/ui'
import {
  ReactFlow,
  Background,
  Panel,
  useReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from '@xyflow/react'
import { useTheme } from '../../lib/useTheme'
import { readVizToken } from '../../lib/vizTokens'
import { GraphLegend } from './GraphLegend'
import { ReactFlowChip } from './NodeChip'
import { GraphSidePanel } from './GraphSidePanel'
import type { BlastRadiusItem, GraphNode } from './types'

/** Zoom +/−/fit control rendered as a Panel so it picks up design tokens
 *  instead of React Flow's hardcoded white stylesheet. Must be a child of
 *  ReactFlow so it can call useReactFlow(). */
function ZoomControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow()
  const btn =
    'flex items-center justify-center w-7 h-7 text-fg-secondary hover:text-fg hover:bg-surface-overlay motion-safe:transition-opacity'
  return (
    <div className="flex flex-col rounded-md border border-edge/70 bg-surface-raised/90 backdrop-blur shadow-raised overflow-hidden">
      <button
        type="button"
        onClick={() => zoomIn({ duration: 200 })}
        className={`${btn} border-b border-edge/50`}
        aria-label="Zoom in"
        title="Zoom in"
      >
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
          <path d="M6.5 2v9M2 6.5h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => zoomOut({ duration: 200 })}
        className={`${btn} border-b border-edge/50`}
        aria-label="Zoom out"
        title="Zoom out"
      >
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
          <path d="M2 6.5h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => fitView({ duration: 300, padding: 0.2 })}
        className={btn}
        aria-label="Fit view"
        title="Fit view"
      >
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
          <path
            d="M2 4.5V2h2.5M11 4.5V2H8.5M2 8.5V11h2.5M11 8.5V11H8.5"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  )
}

interface Props {
  flowNodes: Node[]
  flowEdges: Edge[]
  filteredCount: number
  filteredEdgeCount: number
  onNodeClick: NodeMouseHandler
  onPaneClick: () => void
  onResetView: () => void
  hidden?: boolean
  // 2026-05-07 — selection panel now floats *inside* the ReactFlow
  // viewport (top-right) instead of as a sibling 18rem column. This keeps
  // the canvas full-width (the user's reported "wasted space" was the
  // sibling column eating ~25 % of horizontal real estate even when no
  // node was selected) and means clicks reveal context without the eye
  // jumping outside the spatial map.
  selectedNode?: GraphNode | null
  blastRadius?: BlastRadiusItem[]
  blastLoading?: boolean
  onClearSelection?: () => void
}

const HINT_KEY = 'mushi.graph.hintSeen'

function hintAlreadySeen(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(HINT_KEY) === '1'
  } catch {
    return true
  }
}

// Breaks only on the separators. A single sentence in a narrow column wraps
// mid-phrase ("scroll to" / "zoom · click") at phone width.
const HINT_PHRASES = ['Drag to pan', 'scroll to zoom', 'click a node for blast radius'] as const

export function GraphCanvas({
  flowNodes,
  flowEdges,
  filteredCount,
  filteredEdgeCount,
  onNodeClick,
  onPaneClick,
  onResetView,
  hidden = false,
  selectedNode = null,
  blastRadius = [],
  blastLoading = false,
  onClearSelection,
}: Props) {
  const [hintDismissed, setHintDismissed] = useState(() => hintAlreadySeen())
  const { resolved } = useTheme()
  const dotGrid = readVizToken(
    resolved === 'dark' ? 'viz-node-border-dark' : 'viz-node-border-light',
  )

  // Auto-fade the pan/zoom hint after 6s. Stored in localStorage so it doesn't
  // re-appear every refresh once the user has seen it. The first paint
  // already reads that flag so a returning visit does not resize the canvas.
  useEffect(() => {
    if (hintAlreadySeen()) return
    const t = setTimeout(() => {
      setHintDismissed(true)
      try {
        window.localStorage.setItem(HINT_KEY, '1')
      } catch {
        // ignore
      }
    }, 6000)
    return () => clearTimeout(t)
  }, [])

  const dismissHint = () => {
    setHintDismissed(true)
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(HINT_KEY, '1')
      } catch {
        // ignore
      }
    }
  }

  return (
    <div
      // 2026-05-08 — switched from a raw calc() to clamp() so the canvas
      // is bounded on both ends. The page now carries PageHero + PageHelp
      // + QuickViewsRow + two filter-chip rows above the canvas (~520 px
      // of chrome at typical zoom). The old `100vh-360` produced a 700 px+
      // canvas at 1080 p viewports, eating the entire fold and burying the
      // GraphBackendPanel / OntologyPanel below. clamp(380px, 100vh-540px,
      // 600px) yields: 380 px at 920 px viewport, 540 px at 1080 px, and
      // caps at 600 px even on tall displays — leaving the panels visible
      // without scrolling on most desktop monitors.
      className="border border-edge rounded-md bg-surface-root"
      style={{
        height: 'clamp(380px, calc(100dvh - 540px), 600px)',
        // Grid (not a block) so the hint takes its own row and the flow
        // fills the rest. A top-center Panel is left:50% + shrink-to-fit,
        // which at 390px is only half the canvas: the hint wraps mid-phrase
        // and the tall chip covers the nodes.
        display: hidden ? 'none' : 'grid',
        gridTemplateRows: hintDismissed ? 'minmax(0, 1fr)' : 'auto minmax(0, 1fr)',
      }}
      role="region"
      aria-label={`Knowledge graph visualization with ${filteredCount} nodes and ${filteredEdgeCount} edges. Switch to Table view for a screen-reader-friendly list.`}
      tabIndex={0}
    >
      {!hintDismissed && (
        <div
          data-testid="graph-pan-zoom-hint"
          className="flex items-center gap-2 border-b border-edge-subtle bg-surface-raised px-3 py-1.5 text-2xs text-fg-secondary"
        >
          <span aria-hidden="true" className="shrink-0">🖱️</span>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5">
            {HINT_PHRASES.map((phrase, i) => (
              <span key={phrase} className="inline-flex items-center gap-1.5 whitespace-nowrap">
                {i > 0 && <span aria-hidden="true">·</span>}
                <span data-hint-phrase className="whitespace-nowrap">{phrase}</span>
              </span>
            ))}
          </div>
          <button
            type="button"
            onClick={dismissHint}
            className="shrink-0 rounded-sm px-1 text-danger hover:bg-danger-muted/50 text-xs leading-none"
            aria-label="Dismiss hint"
          >
            ✕
          </button>
        </div>
      )}
      <div className="h-full min-h-0 overflow-hidden">
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.15}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        panOnDrag
        panOnScroll={false}
        zoomOnScroll
        nodeOrigin={[0.5, 0.5]}
        nodeTypes={{ default: ReactFlowChip }}
        aria-label="Knowledge graph nodes and edges. Use Tab to focus, Enter or Space to select a node and load its blast radius."
      >
        <Background gap={24} color={dotGrid} />
        <Panel position="bottom-right">
          <ZoomControls />
        </Panel>
        <Panel position="bottom-left">
          <GraphLegend />
        </Panel>
        {selectedNode && onClearSelection && (
          // In-canvas detail panel.
          // Wrapped in a fixed-width track so the floating card never
          // exceeds ~22rem regardless of node label length (long labels
          // truncate inside the panel via `wrap-break-word`). Pointer
          // events: auto so the panel intercepts clicks (otherwise the
          // ReactFlow `onPaneClick` swallows them and the user can't
          // scroll the blast-radius list). Max-h leaves headroom above
          // the bottom-right Controls overlay.
          <Panel position="top-right">
            <div className="w-[22rem] max-w-[calc(100vw-3rem)] max-h-[min(70%,28rem)] overflow-y-auto rounded-md shadow-raised pointer-events-auto">
              <GraphSidePanel
                node={selectedNode}
                blastRadius={blastRadius}
                blastLoading={blastLoading}
                onClear={onClearSelection}
              />
            </div>
          </Panel>
        )}
        {filteredCount === 0 && (
          <Panel position="top-center">
            <Card  className="backdrop-blur px-3 py-2 text-2xs text-fg-secondary max-w-sm text-center">
              <div className="font-medium text-fg mb-0.5">No nodes match these filters</div>
              <div className="text-fg-muted">
                Try the{' '}
                <button
                  type="button"
                  onClick={onResetView}
                  className="underline hover:text-fg"
                >
                  All
                </button>{' '}
                view, enable more node/edge types, or uncheck "Hide isolated nodes".
              </div>
            </Card>
          </Panel>
        )}
      </ReactFlow>
      </div>
    </div>
  )
}
