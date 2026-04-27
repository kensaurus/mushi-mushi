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

// Idle auto-cycle: when no stage is selected, advance focus every N ms so
// the canvas always *looks alive* instead of frozen on stage 01. Pauses
// while the user is hovering the frame or has a drawer open. The cycle
// is paused entirely for `prefers-reduced-motion` users.
const AUTO_CYCLE_MS = 3600

export function MushiCanvasClient() {
  return (
    <div className="relative">
      <ReactFlowProvider>
        <MushiCanvasViewport />
      </ReactFlowProvider>
    </div>
  )
}

function MushiCanvasViewport() {
  const [focusIndex, setFocusIndex] = useState(0)
  const [selectedStageId, setSelectedStageId] = useState<MushiStageId | null>(null)
  const [hovering, setHovering] = useState(false)
  const reducedMotion = useReducedMotion()
  const { fitView, setCenter } = useReactFlow()
  const focusStage = stages[focusIndex] ?? stages[0]
  const selectedStage = selectedStageId
    ? stages.find((stage) => stage.id === selectedStageId) ?? null
    : null

  // Initial fit so the entire loop is visible no matter the breakpoint.
  useEffect(() => {
    const id = window.setTimeout(() => {
      fitView({ padding: 0.18, duration: reducedMotion ? 0 : 560 })
    }, 80)

    return () => window.clearTimeout(id)
  }, [fitView, reducedMotion])

  // Idle auto-cycle: only when no drawer is open and the user isn't
  // hovering. This is what makes the canvas feel inhabited the moment
  // it scrolls into view.
  useEffect(() => {
    if (reducedMotion) return
    if (selectedStageId) return
    if (hovering) return

    const id = window.setInterval(() => {
      setFocusIndex((prev) => (prev + 1) % stages.length)
    }, AUTO_CYCLE_MS)

    return () => window.clearInterval(id)
  }, [reducedMotion, selectedStageId, hovering])

  // Camera follows either the selected stage (drawer-priority) or the
  // current focus. When the drawer is open we shift centerY upward so
  // the active card stays visible above the bottom drawer overlay.
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
      {/* Stage badge — top-left. Reads as a film-strip slate so users
          immediately know they're watching one report walk. */}
      <div className="pointer-events-none absolute left-4 top-4 z-10 inline-flex items-center gap-2.5 rounded-full border border-[var(--mushi-rule)] bg-[color-mix(in_oklch,var(--mushi-paper)_92%,white)] px-3 py-1.5 shadow-[0_10px_40px_-30px_rgba(14,13,11,0.45)] backdrop-blur sm:left-6 sm:top-6">
        <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--mushi-vermillion)]" />
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--mushi-ink-muted)]">
          <span className="text-[var(--mushi-vermillion)]">
            Stage {String(focusStage.index + 1).padStart(2, '0')}
          </span>
          <span className="mx-2 opacity-50">/</span>
          {focusStage.kicker}
        </p>
      </div>

      {/* Stage progress dock — five clickable pips. Click jumps focus
          AND opens the drawer for that stage. Auto-cycle pauses while
          a drawer is open or the user is hovering anywhere on the frame. */}
      <div className="absolute right-4 top-4 z-10 sm:right-6 sm:top-6">
        <div className="flex items-center gap-1 rounded-full border border-[var(--mushi-rule)] bg-[color-mix(in_oklch,var(--mushi-paper)_92%,white)] px-2 py-1.5 shadow-[0_10px_40px_-30px_rgba(14,13,11,0.45)] backdrop-blur">
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
                className={`group inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] transition-colors ${
                  lit
                    ? 'bg-[var(--mushi-vermillion)] text-white'
                    : 'text-[var(--mushi-ink-muted)] hover:text-[var(--mushi-vermillion)]'
                }`}
              >
                <span>{String(stage.index + 1).padStart(2, '0')}</span>
                <span className={`hidden sm:inline ${lit ? 'text-white' : ''}`}>
                  {stage.id}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Hint pill — bottom-left. Tells users the canvas is interactive
          without resorting to a tutorial overlay. Hidden when a drawer
          is open (the drawer itself is the "you've discovered it" payoff). */}
      {!selectedStageId && (
        <div className="pointer-events-none absolute bottom-4 left-4 z-10 hidden items-center gap-2 rounded-full border border-[var(--mushi-rule)] bg-[color-mix(in_oklch,var(--mushi-paper)_92%,white)] px-3 py-1.5 shadow-[0_10px_40px_-30px_rgba(14,13,11,0.45)] backdrop-blur sm:left-6 sm:bottom-6 sm:inline-flex">
          <span aria-hidden="true" className="font-mono text-[10px] tracking-[0.24em] text-[var(--mushi-vermillion)]">
            ⌥
          </span>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--mushi-ink-muted)]">
            Click any card · or pick a stage above
          </p>
        </div>
      )}

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
