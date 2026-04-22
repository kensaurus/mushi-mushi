/**
 * FILE: apps/admin/src/components/pdca-flow/PdcaFlow.tsx
 * PURPOSE: React Flow canvas that renders the four-stage PDCA loop as an
 *          interactive diagram. Two variants:
 *
 *            • `live`       — dashboard cockpit; each node shows the living
 *                             count + bottleneck pulled from the dashboard
 *                             payload. A hover toolbar + click-to-open
 *                             drawer expose inline actions (dispatch,
 *                             dismiss, undo, re-dispatch, run judge…).
 *            • `onboarding` — first-run explainer; nodes show the stage
 *                             outcome and a verb-led CTA. Clicking a node
 *                             reveals the drawer with plain-language
 *                             instructions rather than live data.
 *
 *          We lock pan/zoom by default; the `interactive` prop opts in to
 *          pan+zoom+the flow-controls panel, and (always-on) click-to-open
 *          the stage drawer. The interactive variant additionally exposes:
 *            • MiniMap for quick orientation + click-to-focus
 *            • Tidy button (re-apply canonical layout + fit view)
 *            • Edge inspector popover (click edge → what's flowing here)
 *            • Right-click context menu on nodes
 *            • Log ↔ node focus sync (click activity → node highlights)
 *
 *          The outer component owns hash-sync + drawer state; the inner
 *          canvas component lives inside ReactFlowProvider so we can call
 *          `useReactFlow` for imperative focus + fitBounds operations.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  MiniMap,
  Panel,
  useReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { PdcaStepNode } from './PdcaStepNode'
import { PdcaGradientEdge } from './PdcaGradientEdge'
import {
  buildEdges,
  buildNodes,
  type PdcaEdgeData,
  type PdcaFlowVariant,
  type PdcaNodeData,
} from './pdcaFlow.data'
import type { PdcaStage } from '../dashboard/types'
import type { PdcaStageId } from '../../lib/pdca'
import { PDCA_STAGES } from '../../lib/pdca'
import { STAGE_HEX } from '../flow-primitives/flowTokens'
import { PdcaFlowContext } from './PdcaFlowContext'
import { StageDrawer } from '../flow-primitives/StageDrawer'
import { StageDrawerContent } from './StageDrawerContent'
import { PdcaFlowControls } from '../flow-primitives/PdcaFlowControls'
import { PdcaLegendPanel } from '../flow-primitives/PdcaLegendPanel'
import { PipelineActivityLog } from './PipelineActivityLog'
import { PipelineActionPanel } from './PipelineActionPanel'
import { EdgeInspector } from './EdgeInspector'
import { NodeContextMenu } from './NodeContextMenu'
import { useFlowKeyboardNav } from '../flow-primitives/useFlowKeyboardNav'
import type { ActivityItem } from '../dashboard/types'

const NODE_TYPES = { pdcaStep: PdcaStepNode }
const EDGE_TYPES = { pdcaGradient: PdcaGradientEdge }

const VARIANT_HEIGHT: Record<PdcaFlowVariant, string> = {
  live: 'h-[440px] sm:h-[480px]',
  onboarding: 'h-[400px] sm:h-[430px]',
}

const DRAWER_HASH_PREFIX = '#pdca='

function readInitialHash(): PdcaStageId | null {
  if (typeof window === 'undefined') return null
  const h = window.location.hash
  if (!h.startsWith(DRAWER_HASH_PREFIX)) return null
  const v = h.slice(DRAWER_HASH_PREFIX.length)
  if (v === 'plan' || v === 'do' || v === 'check' || v === 'act') return v
  return null
}

interface PdcaFlowProps {
  variant: PdcaFlowVariant
  stages?: PdcaStage[]
  focusStage?: PdcaStageId | null
  /** Stage currently executing (dispatch running, judge running, etc.). */
  runningStage?: PdcaStageId | null
  /** Recent activity items for the bottom panel (live variant only). */
  activity?: ActivityItem[]
  /** When true, allow pan + zoom and render the controls panel. */
  interactive?: boolean
  /** When true, render the top-right action panel (Run judge, Pause…). */
  showActionPanel?: boolean
  /** When true, render the bottom-center activity log. */
  showActivityLog?: boolean
  className?: string
  ariaLabel?: string
}

export function PdcaFlow(props: PdcaFlowProps) {
  const {
    variant,
    stages = [],
    focusStage = null,
    runningStage = null,
    className = '',
    ariaLabel,
  } = props

  const [openStage, setOpenStage] = useState<PdcaStageId | null>(() => readInitialHash())
  const [replayKey, setReplayKey] = useState(0)

  const onOpenStage = useCallback((stage: PdcaStageId | null) => {
    setOpenStage(stage)
    if (typeof window !== 'undefined') {
      if (stage) {
        history.replaceState(null, '', `${DRAWER_HASH_PREFIX}${stage}`)
      } else if (window.location.hash.startsWith(DRAWER_HASH_PREFIX)) {
        history.replaceState(null, '', window.location.pathname + window.location.search)
      }
    }
  }, [])

  // Sync openStage with hash changes made elsewhere (e.g. the user hits the
  // back button or edits the URL).
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onHash = () => setOpenStage(readInitialHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const onReplay = useCallback(() => setReplayKey((k) => k + 1), [])

  useFlowKeyboardNav({
    enabled: variant === 'live',
    openStage,
    onOpen: onOpenStage,
  })

  const openStageMeta = openStage ? PDCA_STAGES[openStage] : null
  const openStageData = openStage ? stages.find((s) => s.id === openStage) ?? null : null

  const ctxValue = useMemo(
    () => ({
      variant,
      focusStage,
      runningStage,
      openStage,
      onOpenStage,
      onReplay,
    }),
    [variant, focusStage, runningStage, openStage, onOpenStage, onReplay],
  )

  return (
    <PdcaFlowContext.Provider value={ctxValue}>
      <div
        className={`relative w-full ${VARIANT_HEIGHT[variant]} rounded-md border border-edge/60 bg-surface-raised/30 overflow-hidden ${className}`.trim()}
        role="region"
        aria-label={ariaLabel ?? 'Plan, Do, Check, Act loop diagram'}
        data-tour-id="pdca-flow"
      >
        <ReactFlowProvider>
          <PdcaFlowCanvas
            {...props}
            openStage={openStage}
            onOpenStage={onOpenStage}
            onReplay={onReplay}
            replayKey={replayKey}
          />
        </ReactFlowProvider>
      </div>

      {variant === 'live' && openStageMeta && (
        <StageDrawer
          open={!!openStage}
          onClose={() => onOpenStage(null)}
          title={`${openStageMeta.label} stage`}
          subtitle={openStageMeta.hint}
          titleAccent={
            <span
              aria-hidden="true"
              className={`inline-flex items-center justify-center w-6 h-6 rounded-sm font-bold text-[0.7rem] leading-none shrink-0 ${openStageMeta.badgeBg} ${openStageMeta.badgeFg}`}
            >
              {openStageMeta.letter}
            </span>
          }
        >
          {openStage && (
            <StageDrawerContent
              stageId={openStage}
              stage={openStageData}
              onClose={() => onOpenStage(null)}
            />
          )}
        </StageDrawer>
      )}
    </PdcaFlowContext.Provider>
  )
}

interface PdcaFlowCanvasProps extends PdcaFlowProps {
  openStage: PdcaStageId | null
  onOpenStage: (stage: PdcaStageId | null) => void
  onReplay: () => void
  replayKey: number
}

function PdcaFlowCanvas({
  variant,
  stages = [],
  focusStage = null,
  runningStage = null,
  activity,
  interactive = false,
  showActionPanel = false,
  showActivityLog = false,
  onOpenStage,
  onReplay,
  replayKey,
}: PdcaFlowCanvasProps) {
  const rf = useReactFlow<Node<PdcaNodeData>, Edge<PdcaEdgeData>>()
  const containerRef = useRef<HTMLDivElement>(null)
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [logFocusStage, setLogFocusStage] = useState<PdcaStageId | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<{
    id: string
    data: PdcaEdgeData
    centerX: number
    centerY: number
  } | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; node: PdcaNodeData } | null>(null)

  const nodes: Node<PdcaNodeData>[] = useMemo(
    () => buildNodes(variant, stages, focusStage, runningStage),
    [variant, stages, focusStage, runningStage],
  )
  const edges: Edge<PdcaEdgeData>[] = useMemo(
    // replayKey isn't read by buildEdges, but bumping it is how the parent
    // asks us to remount/reanimate the edges (replay button).
    () => buildEdges(focusStage, runningStage, stages),
    [focusStage, runningStage, stages, replayKey],
  )

  const onNodeClick = useCallback(
    (_: unknown, node: Node<PdcaNodeData>) => {
      if (variant !== 'live') return
      const id = node.data.stageId
      if (id === 'plan' || id === 'do' || id === 'check' || id === 'act') {
        onOpenStage(id)
      }
    },
    [variant, onOpenStage],
  )

  // Right-click = "show me every action on this stage". We anchor the menu
  // to the container so it survives React Flow's transform; the cursor
  // position is relative to the container so the menu appears where the
  // pointer is regardless of zoom.
  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node<PdcaNodeData>) => {
      if (variant !== 'live') return
      event.preventDefault()
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      setCtxMenu({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        node: node.data,
      })
    },
    [variant],
  )

  // Clicking an edge opens the inspector at the bezier's midpoint —
  // screen-space so the popover stays put while the user pans/zooms.
  const onEdgeClick = useCallback(
    (event: React.MouseEvent, edge: Edge<PdcaEdgeData>) => {
      event.stopPropagation()
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      setSelectedEdge({
        id: edge.id,
        data: (edge.data ?? {}) as PdcaEdgeData,
        centerX: event.clientX - rect.left,
        centerY: event.clientY - rect.top,
      })
    },
    [],
  )

  const onPaneClick = useCallback(() => {
    setSelectedEdge(null)
    setCtxMenu(null)
  }, [])

  const onTidy = useCallback(() => {
    // Our layout is fixed (buildNodes sets canonical positions every render),
    // so "tidy" == re-fit the view with a gentle animation.
    rf.fitView({ duration: 400, padding: 0.2 })
  }, [rf])

  // Imperative focus for the activity-log sync path. When a user clicks an
  // activity row we fly the canvas to the matching stage node and briefly
  // highlight it so they can verify cause→effect.
  const focusStageNode = useCallback(
    (stageId: PdcaStageId) => {
      const node = rf.getNode(stageId)
      if (!node) return
      rf.setCenter(node.position.x + 120, node.position.y + 40, { zoom: 1.1, duration: 450 })
      setLogFocusStage(stageId)
      if (focusTimerRef.current) clearTimeout(focusTimerRef.current)
      focusTimerRef.current = setTimeout(() => {
        setLogFocusStage((s) => (s === stageId ? null : s))
        focusTimerRef.current = null
      }, 1400)
    },
    [rf],
  )

  // Cancel any pending focus-reset timer if the canvas unmounts mid-pulse so
  // React doesn't warn about state updates on an unmounted component.
  useEffect(() => {
    return () => {
      if (focusTimerRef.current) clearTimeout(focusTimerRef.current)
    }
  }, [])

  // Drive the node-highlight pulse entirely through a data-attribute on the
  // outer wrapper — child nodes pick it up via CSS [data-flash-stage="…"]
  // so we don't re-render React Flow's node tree just to nudge a style.
  useEffect(() => {
    if (!containerRef.current) return
    if (logFocusStage) {
      containerRef.current.dataset.flashStage = logFocusStage
    } else {
      delete containerRef.current.dataset.flashStage
    }
  }, [logFocusStage])

  const minimapNodeColor = useCallback(
    (node: Node<PdcaNodeData>) => STAGE_HEX[node.data.stageId] ?? '#60a5fa',
    [],
  )

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.2, includeHiddenNodes: false }}
        proOptions={{ hideAttribution: true }}
        onNodeClick={onNodeClick}
        onNodeContextMenu={onNodeContextMenu}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={variant === 'live'}
        panOnDrag={interactive}
        panOnScroll={false}
        zoomOnScroll={interactive}
        zoomOnPinch={interactive}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        minZoom={0.6}
        maxZoom={1.4}
        defaultEdgeOptions={{ type: 'pdcaGradient' }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={16}
          size={1}
          color="var(--color-edge-subtle)"
        />

        {variant === 'live' && (
          <Panel position="top-left">
            <PdcaLegendPanel
              focusStage={focusStage}
              runningStage={runningStage}
              focusCount={stages.find((s) => s.id === focusStage)?.count}
              focusCountLabel={stages.find((s) => s.id === focusStage)?.countLabel}
            />
          </Panel>
        )}

        {interactive && (
          <Panel position="bottom-right">
            <PdcaFlowControls onReplay={onReplay} onTidy={onTidy} />
          </Panel>
        )}

        {showActionPanel && variant === 'live' && (
          <Panel position="top-right">
            <PipelineActionPanel />
          </Panel>
        )}

        {showActivityLog && variant === 'live' && activity && (
          <Panel position="bottom-left" className="!m-2 max-w-[17rem]">
            <PipelineActivityLog activity={activity} onFocusStage={focusStageNode} />
          </Panel>
        )}

        {interactive && (
          <MiniMap
            pannable
            zoomable
            nodeColor={minimapNodeColor}
            nodeStrokeWidth={2}
            maskColor="rgba(0, 0, 0, 0.35)"
            className="!bg-surface-overlay/90 !border !border-edge/60 !rounded-md !backdrop-blur-sm"
            style={{ width: 132, height: 88 }}
            onNodeClick={(_, node) => {
              const id = (node.data as PdcaNodeData | undefined)?.stageId
              if (id === 'plan' || id === 'do' || id === 'check' || id === 'act') {
                focusStageNode(id)
                if (variant === 'live') onOpenStage(id)
              }
            }}
          />
        )}
      </ReactFlow>

      {selectedEdge && (
        <EdgeInspector
          edge={selectedEdge}
          stages={stages}
          onClose={() => setSelectedEdge(null)}
        />
      )}

      {ctxMenu && (
        <NodeContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          node={ctxMenu.node}
          onClose={() => setCtxMenu(null)}
          onInspect={() => onOpenStage(ctxMenu.node.stageId)}
          onFocusLog={() => focusStageNode(ctxMenu.node.stageId)}
        />
      )}
    </div>
  )
}
