'use client'

import {
  Background,
  MarkerType,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeTypes,
} from '@xyflow/react'
import { useReducedMotion } from 'framer-motion'
import { useEffect, useMemo, useState } from 'react'
import { PaperEdge } from './edges/PaperEdge'
import { LogTicker } from './LogTicker'
import { StageNode } from './nodes/StageNode'
import { StageDrawer } from './StageDrawer'
import {
  reportSample,
  stageEdges,
  stages,
  type MushiStageId,
  type PaperEdgeData,
  type StageNodeData,
} from './data'

const nodeTypes: NodeTypes = { stage: StageNode }
const edgeTypes: EdgeTypes = { paper: PaperEdge }

const AUTO_CYCLE_MS = 3600

export function MushiCanvasViewport() {
  return (
    <div className="relative">
      <ReactFlowProvider>
        <CanvasInner />
      </ReactFlowProvider>
    </div>
  )
}

function CanvasInner() {
  const [focusIndex, setFocusIndex] = useState(0)
  const [selectedStageId, setSelectedStageId] = useState<MushiStageId | null>(null)
  const [hovering, setHovering] = useState(false)
  const reducedMotion = useReducedMotion()
  const { fitView, setCenter } = useReactFlow()
  const focusStage = stages[focusIndex] ?? stages[0]
  const selectedStage = selectedStageId
    ? stages.find((stage) => stage.id === selectedStageId) ?? null
    : null

  useEffect(() => {
    const id = window.setTimeout(() => {
      fitView({ padding: 0.18, duration: reducedMotion ? 0 : 560 })
    }, 80)

    return () => window.clearTimeout(id)
  }, [fitView, reducedMotion])

  useEffect(() => {
    if (reducedMotion) return
    if (selectedStageId) return
    if (hovering) return

    const id = window.setInterval(() => {
      setFocusIndex((prev) => (prev + 1) % stages.length)
    }, AUTO_CYCLE_MS)

    return () => window.clearInterval(id)
  }, [reducedMotion, selectedStageId, hovering])

  useEffect(() => {
    const target = selectedStage ?? focusStage
    const drawerOpen = !!selectedStage
    const centerX = target.position.x + 110
    const centerY = target.position.y + 96 - (drawerOpen ? 110 : 0)
    setCenter(centerX, centerY, {
      zoom: drawerOpen ? 1.05 : 0.92,
      duration: reducedMotion ? 0 : 620,
    })
  }, [focusStage, selectedStage, reducedMotion, setCenter])

  const nodes = useMemo<Node<StageNodeData>[]>(
    () =>
      stages.map((stage) => ({
        id: stage.id,
        type: 'stage',
        position: stage.position,
        draggable: false,
        selectable: false,
        data: {
          stage,
          focused: stage.id === focusStage.id,
          selected: stage.id === selectedStageId,
          onSelect: setSelectedStageId,
        },
      })),
    [focusStage.id, selectedStageId],
  )

  const edges = useMemo<Edge<PaperEdgeData>[]>(
    () =>
      stageEdges.map((edge, index) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
        type: 'paper',
        animated: index === focusIndex,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: 'var(--mushi-ink)',
          width: 16,
          height: 16,
        },
        data: {
          label: edge.label,
          active: index <= focusIndex,
          flowing: index === focusIndex,
        },
      })),
    [focusIndex],
  )

  return (
    <div
      className="mushi-canvas-light mushi-canvas-frame relative h-[min(620px,calc(100vh-9rem))] min-h-[480px] w-full overflow-hidden rounded-[2rem] border border-[var(--mushi-rule)] shadow-[0_30px_100px_-64px_rgba(14,13,11,0.55)]"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      {/* Top-left stage indicator. Vermillion is reserved for the live dot
          (semantic) and a single ARIA-current pulse — the stage number itself
          is now ink so it doesn't compete with the active jump pill on the
          right OR the active card's bottom rail. The kicker is the data
          carrier; it should read like a caption, not a brand stripe. */}
      <div className="pointer-events-none absolute left-4 top-4 z-10 inline-flex items-center gap-2.5 rounded-full border border-[var(--mushi-rule)] bg-[color-mix(in_oklch,var(--mushi-paper)_92%,white)] px-3 py-1.5 shadow-[0_10px_40px_-30px_rgba(14,13,11,0.45)] backdrop-blur sm:left-6 sm:top-6">
        <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--mushi-vermillion)]" />
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--mushi-ink-muted)]">
          <span className="text-[var(--mushi-ink)] font-semibold">
            Stage {String(focusStage.index + 1).padStart(2, '0')}
          </span>
          <span className="mx-2 opacity-40">/</span>
          {focusStage.kicker}
        </p>
      </div>

      {/* Stage jump pills. The previous treatment painted the active pill in
          solid vermillion AND tinted inactive labels in vermillion-on-hover —
          all five pills competed for "I am current". The fix is the M3 /
          Stripe / Vercel pattern: active = micro-pill (solid vermillion
          wrapping ONLY the digits + label), inactive = neutral ink-muted
          text on transparent (hover lifts to ink, not brand). The bounding
          box is identical for every pill (px-2 py-0.5 → no layout shift on
          state change) — the active *signal* is colour, not size, killing
          the H1 "active mass mismatch" the user named "weirdly big". */}
      <div className="absolute right-4 top-4 z-10 sm:right-6 sm:top-6">
        <div className="flex items-center gap-0.5 rounded-full border border-[var(--mushi-rule)] bg-[color-mix(in_oklch,var(--mushi-paper)_92%,white)] p-1 shadow-[0_10px_40px_-30px_rgba(14,13,11,0.45)] backdrop-blur">
          {stages.map((stage) => {
            const isActive = stage.id === focusStage.id
            const isSelected = stage.id === selectedStageId
            const lit = isActive || isSelected
            return (
              <button
                key={stage.id}
                type="button"
                onClick={() => {
                  setFocusIndex(stage.index)
                  setSelectedStageId(stage.id)
                }}
                aria-label={`Jump to stage ${stage.index + 1}: ${stage.title}`}
                aria-current={isActive ? 'step' : undefined}
                className={`group inline-flex items-center gap-1.5 rounded-full px-2 py-1 font-mono text-[9px] uppercase tracking-[0.18em] transition-colors ${
                  lit
                    ? 'bg-[var(--mushi-vermillion)] text-white shadow-[inset_0_-1.5px_0_rgba(0,0,0,0.18)]'
                    : 'text-[var(--mushi-ink-muted)] hover:bg-[color-mix(in_oklch,var(--mushi-ink)_8%,transparent)] hover:text-[var(--mushi-ink)]'
                }`}
              >
                <span className={lit ? 'font-semibold' : 'opacity-70'}>
                  {String(stage.index + 1).padStart(2, '0')}
                </span>
                <span className="hidden sm:inline">{stage.id}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Bottom-left "click any card" hint REMOVED. It said the same thing as
          the section header at the right ("Click any card to inspect →") in
          the same viewport fold (enhance-page-ui H14). Keeping it would have
          paid two sets of pixels for one piece of guidance. The keyboard
          shortcut hint can come back later as a discoverable affordance. */}

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        minZoom={0.5}
        maxZoom={1.4}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={false}
        zoomOnPinch={false}
        zoomOnScroll={false}
        panOnScroll={false}
        preventScrolling={false}
        onNodeClick={(_, node) => {
          const id = node.id as MushiStageId
          const idx = stages.findIndex((stage) => stage.id === id)
          if (idx >= 0) setFocusIndex(idx)
          setSelectedStageId(id)
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="var(--mushi-rule)" gap={22} size={1} />
        <Panel position="bottom-center">
          <LogTicker focusStageId={focusStage.id} />
        </Panel>
      </ReactFlow>

      <StageDrawer
        stage={selectedStage}
        sample={reportSample}
        onClose={() => setSelectedStageId(null)}
      />
    </div>
  )
}
