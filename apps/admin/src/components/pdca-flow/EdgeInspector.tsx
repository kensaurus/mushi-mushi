/**
 * FILE: apps/admin/src/components/pdca-flow/EdgeInspector.tsx
 * PURPOSE: Tiny popover rendered inside the PDCA canvas whenever the user
 *          clicks an edge. Each edge represents a hand-off between two
 *          stages (e.g. Plan → Do = "classified reports becoming fix
 *          attempts"), so the inspector answers the most common click-
 *          intent: "what is flowing through here right now, and is it
 *          healthy?"
 *
 *          We keep it lightweight — no drawer, no overlay, no pointer-
 *          events-greedy scrim — because the edges are small click
 *          targets and a heavy drawer would feel out of scale. The
 *          popover closes on outside click / escape / edge re-click.
 */
import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import type { PdcaStage } from '../dashboard/types'
import type { PdcaEdgeData } from './pdcaFlow.data'
import { PDCA_STAGES } from '../../lib/pdca'
import { STAGE_HEX } from '../flow-primitives/flowTokens'

interface EdgeInspectorProps {
  edge: {
    id: string
    data: PdcaEdgeData
    centerX: number
    centerY: number
  }
  stages: PdcaStage[]
  onClose: () => void
}

const TRANSITION_COPY: Record<string, { label: string; hint: string; href: string }> = {
  'plan->do': {
    label: 'Classified → queued for fix',
    hint: 'Classified reports waiting for the fix worker to pick them up.',
    href: '/reports?status=classified',
  },
  'do->check': {
    label: 'Drafts → judge',
    hint: 'Fix drafts the orchestrator produced, queued for the Judge to score.',
    href: '/fixes?status=drafted',
  },
  'check->act': {
    label: 'Scored → ship or iterate',
    hint: 'Judged fixes ready for human ship / iterate / dismiss decisions.',
    href: '/judge',
  },
  'act->plan': {
    label: 'Shipped → reporter feedback',
    hint: 'Shipped fixes re-entering the plan stage as new reporter signal.',
    href: '/reports',
  },
}

export function EdgeInspector({ edge, stages, onClose }: EdgeInspectorProps) {
  const ref = useRef<HTMLDivElement>(null)
  const sourceStage = stages.find((s) => s.id === edge.data.sourceStageId)
  const targetStage = stages.find((s) => s.id === edge.data.targetStageId)
  const copy = TRANSITION_COPY[edge.id] ?? {
    label: `${edge.data.sourceStageId} → ${edge.data.targetStageId}`,
    hint: 'Hand-off between two PDCA stages.',
    href: '/reports',
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    function onClick(e: MouseEvent) {
      if (!ref.current) return
      if (ref.current.contains(e.target as Node)) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    // Defer outside-click listener a tick so the opening click doesn't
    // immediately re-close the popover.
    const t = setTimeout(() => window.addEventListener('click', onClick), 0)
    return () => {
      clearTimeout(t)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('click', onClick)
    }
  }, [onClose])

  const sourceMeta = PDCA_STAGES[edge.data.sourceStageId]
  const targetMeta = PDCA_STAGES[edge.data.targetStageId]
  const failing = Boolean(edge.data.failing)
  const flowing = Boolean(edge.data.flowing)
  const inFlightCount = sourceStage?.count ?? 0

  return (
    <div
      ref={ref}
      className="pointer-events-auto absolute z-20 w-64 rounded-md border border-edge/70 bg-surface-overlay/95 p-2.5 text-2xs shadow-card backdrop-blur-sm motion-safe:animate-mushi-fade-in"
      style={{
        left: edge.centerX,
        top: edge.centerY,
        transform: 'translate(-50%, calc(-100% - 8px))',
      }}
      role="dialog"
      aria-label={`Details for ${copy.label}`}
    >
      <header className="flex items-center gap-1.5 mb-1">
        <StageDot stageId={edge.data.sourceStageId} />
        <span className="text-fg-muted text-3xs tabular-nums">{sourceMeta.letter}</span>
        <span className="text-fg-faint" aria-hidden="true">
          →
        </span>
        <StageDot stageId={edge.data.targetStageId} />
        <span className="text-fg-muted text-3xs tabular-nums">{targetMeta.letter}</span>
        <span className="ml-auto inline-flex items-center gap-1">
          {flowing && (
            <span className="text-3xs uppercase tracking-wider text-brand font-medium">Flowing</span>
          )}
          {failing && (
            <span className="text-3xs uppercase tracking-wider text-danger font-medium">Stalled</span>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-fg-faint hover:text-fg inline-flex h-4 w-4 items-center justify-center rounded-sm"
          >
            ✕
          </button>
        </span>
      </header>
      <p className="font-medium text-fg leading-tight">{copy.label}</p>
      <p className="mt-0.5 text-fg-faint leading-snug">{copy.hint}</p>

      <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-0.5 text-3xs">
        <dt className="text-fg-muted">In flight</dt>
        <dd className="font-mono tabular-nums text-fg">{inFlightCount}</dd>
        {targetStage?.bottleneck && (
          <>
            <dt className="text-fg-muted">Next stage</dt>
            <dd className="text-fg truncate" title={targetStage.bottleneck}>
              {targetStage.bottleneck}
            </dd>
          </>
        )}
      </dl>

      <Link
        to={copy.href}
        onClick={onClose}
        className="mt-2 inline-flex items-center gap-1 text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 rounded-sm"
      >
        Open {targetMeta.label.toLowerCase()} queue
        <span aria-hidden="true">→</span>
      </Link>
    </div>
  )
}

function StageDot({ stageId }: { stageId: PdcaEdgeData['sourceStageId'] }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-2 w-2 rounded-full"
      style={{ backgroundColor: STAGE_HEX[stageId] }}
    />
  )
}
