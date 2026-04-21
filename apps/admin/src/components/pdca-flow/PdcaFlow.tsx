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
 *          the stage drawer.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Panel,
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
import { PdcaFlowContext } from './PdcaFlowContext'
import { StageDrawer } from '../flow-primitives/StageDrawer'
import { StageDrawerContent } from './StageDrawerContent'
import { PdcaFlowControls } from '../flow-primitives/PdcaFlowControls'
import { PdcaLegendPanel } from '../flow-primitives/PdcaLegendPanel'
import { PipelineActivityLog } from './PipelineActivityLog'
import { PipelineActionPanel } from './PipelineActionPanel'
import { useFlowKeyboardNav } from '../flow-primitives/useFlowKeyboardNav'
import type { ActivityItem } from '../dashboard/types'

const NODE_TYPES = { pdcaStep: PdcaStepNode }
const EDGE_TYPES = { pdcaGradient: PdcaGradientEdge }

const VARIANT_HEIGHT: Record<PdcaFlowVariant, string> = {
  live: 'h-[380px] sm:h-[420px]',
  onboarding: 'h-[360px] sm:h-[380px]',
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

export function PdcaFlow({
  variant,
  stages = [],
  focusStage = null,
  runningStage = null,
  activity,
  interactive = false,
  showActionPanel = false,
  showActivityLog = false,
  className = '',
  ariaLabel,
}: PdcaFlowProps) {
  const [openStage, setOpenStage] = useState<PdcaStageId | null>(() => readInitialHash())
  const [replayKey, setReplayKey] = useState(0)

  const nodes: Node<PdcaNodeData>[] = useMemo(
    () => buildNodes(variant, stages, focusStage, runningStage),
    [variant, stages, focusStage, runningStage],
  )
  const edges: Edge<PdcaEdgeData>[] = useMemo(
    () => buildEdges(focusStage, runningStage),
    [focusStage, runningStage, replayKey],
  )

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
    const onHash = () => {
      const next = readInitialHash()
      setOpenStage(next)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const onReplay = useCallback(() => setReplayKey((k) => k + 1), [])

  // Canonical React Flow click path — fires even if the custom-node
  // <button> inside is obscured or CSS accidentally pins pointer-events.
  // Guarded to the live variant so the onboarding explainer keeps its
  // Link-based navigation.
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
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            fitView
            fitViewOptions={{ padding: 0.2, includeHiddenNodes: false }}
            proOptions={{ hideAttribution: true }}
            onNodeClick={onNodeClick}
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
                  focusCount={openStageData?.count}
                  focusCountLabel={openStageData?.countLabel}
                />
              </Panel>
            )}

            {interactive && (
              <Panel position="bottom-right">
                <PdcaFlowControls onReplay={onReplay} />
              </Panel>
            )}

            {showActionPanel && variant === 'live' && (
              <Panel position="top-right">
                <PipelineActionPanel />
              </Panel>
            )}

            {showActivityLog && variant === 'live' && activity && (
              <Panel position="bottom-center">
                <PipelineActivityLog activity={activity} />
              </Panel>
            )}
          </ReactFlow>
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
