/**
 * FILE: apps/admin/src/components/pdca-flow/PdcaStepNode.tsx
 * PURPOSE: Custom React Flow node for a single PDCA stage. Dense header +
 *          title + subtitle + live count / bottleneck so the whole diamond
 *          fits inside the dashboard hero without a second scroll.
 *
 *          Interaction model (live variant):
 *            • Clicking the body opens the StageDrawer (progressive
 *              disclosure — the drawer is where dispatch/undo/review
 *              happens so the flow canvas stays uncluttered).
 *            • Hover toolbar exposes "Inspect" + "Open full page" shortcuts.
 *            • A running glow fires when this stage is the active one.
 *            • Freshly-changed counts pop once; cleared bottlenecks
 *              trigger a celebration ring.
 */

import { memo, useEffect, useRef, useState } from 'react'
import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import { Link } from 'react-router-dom'
import { PDCA_STAGES } from '../../lib/pdca'
import type { PdcaNodeData } from './pdcaFlow.data'
import { usePdcaFlow } from './PdcaFlowContext'
import { StageHoverToolbar } from '../flow-primitives/StageHoverToolbar'
import { StageHealthRing } from '../flow-primitives/StageHealthRing'
import { STAGE_HEX, TONE_HEX } from '../flow-primitives/flowTokens'
import { usePrevious } from '../flow-primitives/usePrevious'

const TONE_NUMBER: Record<NonNullable<PdcaNodeData['tone']>, string> = {
  ok: 'text-fg',
  warn: 'text-warn',
  urgent: 'text-danger',
}

const TONE_DOT: Record<NonNullable<PdcaNodeData['tone']>, { dot: string; label: string; pulse?: boolean }> = {
  ok: { dot: 'bg-ok', label: 'Healthy' },
  warn: { dot: 'bg-warn', label: 'Watch' },
  urgent: { dot: 'bg-danger', label: 'Bottleneck', pulse: true },
}

function PdcaStepNodeInner({ data }: NodeProps) {
  const node = data as PdcaNodeData
  const meta = PDCA_STAGES[node.stageId]
  const tone = node.tone ?? 'ok'
  const numberTone = TONE_NUMBER[tone]
  const dot = TONE_DOT[tone]
  const isLive = typeof node.count === 'number'
  const flow = usePdcaFlow()
  const interactive = flow.variant === 'live'

  const prevCount = usePrevious(node.count)
  const prevTone = usePrevious(tone)
  const [countPulse, setCountPulse] = useState(false)
  const [celebrate, setCelebrate] = useState(false)
  const countKeyRef = useRef(0)

  useEffect(() => {
    if (typeof node.count !== 'number' || typeof prevCount !== 'number') return
    if (node.count === prevCount) return
    countKeyRef.current += 1
    setCountPulse(true)
    const t = setTimeout(() => setCountPulse(false), 480)
    return () => clearTimeout(t)
  }, [node.count, prevCount])

  useEffect(() => {
    if (!prevTone) return
    if (prevTone === 'urgent' && tone !== 'urgent') {
      setCelebrate(true)
      const t = setTimeout(() => setCelebrate(false), 950)
      return () => clearTimeout(t)
    }
  }, [tone, prevTone])

  const openDrawer = () => {
    if (!interactive) return
    flow.onOpenStage(node.stageId)
  }

  const hasHealth = typeof node.health === 'number' && Number.isFinite(node.health)

  return (
    <div
      className={[
        'group/pdca relative w-56 rounded-md border bg-surface-raised text-xs shadow-sm pointer-events-auto',
        node.isFocus ? `ring-2 ring-offset-1 ring-offset-surface ${meta.ring} ${meta.tintBg}` : 'border-edge/70',
        node.isRunning ? 'mushi-running-glow' : '',
      ].join(' ')}
      data-stage={node.stageId}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="in"
        className="!bg-transparent !border-none !w-1.5 !h-1.5"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="out"
        className="!bg-transparent !border-none !w-1.5 !h-1.5"
      />

      {celebrate && <span className="mushi-celebrate-ring" aria-hidden="true" />}

      {interactive && (
        <StageHoverToolbar
          actions={[
            {
              key: 'inspect',
              label: `Inspect ${meta.label} stage`,
              onClick: openDrawer,
              icon: (
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                  <circle cx="7" cy="7" r="4" />
                  <line x1="10" y1="10" x2="13" y2="13" strokeLinecap="round" />
                </svg>
              ),
            },
          ]}
        />
      )}

      {interactive ? (
        <button
          type="button"
          onClick={openDrawer}
          className="nodrag w-full text-left block p-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 rounded-md cursor-pointer"
          aria-label={`Open ${meta.label} stage details`}
        >
          <NodeBody
            node={node}
            meta={meta}
            numberTone={numberTone}
            toneDot={dot}
            isLive={isLive}
            countPulse={countPulse}
            countKey={countKeyRef.current}
            hasHealth={hasHealth}
          />
          <span className="sr-only">
            <Link to={node.href}>{node.ctaLabel} full page</Link>
          </span>
        </button>
      ) : (
        <Link
          to={node.href}
          className="block p-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 rounded-md"
        >
          <NodeBody
            node={node}
            meta={meta}
            numberTone={numberTone}
            toneDot={dot}
            isLive={isLive}
            countPulse={countPulse}
            countKey={countKeyRef.current}
            hasHealth={hasHealth}
          />
        </Link>
      )}
    </div>
  )
}

interface NodeBodyProps {
  node: PdcaNodeData
  meta: typeof PDCA_STAGES[keyof typeof PDCA_STAGES]
  numberTone: string
  toneDot: { dot: string; label: string; pulse?: boolean }
  isLive: boolean
  countPulse: boolean
  countKey: number
  hasHealth: boolean
}

function NodeBody({
  node,
  meta,
  numberTone,
  toneDot,
  isLive,
  countPulse,
  countKey,
  hasHealth,
}: NodeBodyProps) {
  return (
    <>
      <header className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={`inline-flex items-center justify-center w-6 h-6 rounded-sm font-bold text-[0.7rem] leading-none shrink-0 ${meta.badgeBg} ${meta.badgeFg}`}
        >
          {node.letter}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-fg leading-tight truncate">{node.title}</div>
          {node.isFocus && isLive && (
            <div className={`text-3xs font-mono uppercase tracking-wider ${meta.text}`}>Current focus</div>
          )}
        </div>
        {hasHealth && (
          <StageHealthRing
            value={node.health ?? 0}
            color={STAGE_HEX[node.stageId]}
            size={18}
            title={`${meta.label} health: ${Math.round((node.health ?? 0) * 100)}%`}
          />
        )}
        {isLive && !hasHealth && (
          <span
            className="inline-flex items-center gap-1 text-3xs text-fg-muted shrink-0"
            title={`${toneDot.label} · ${node.bottleneck ?? 'No action needed'}`}
          >
            <span className={`relative w-1.5 h-1.5 rounded-full ${toneDot.dot}`} aria-hidden="true">
              {toneDot.pulse && (
                <span
                  className={`absolute inset-0 rounded-full ${toneDot.dot} opacity-60 motion-safe:animate-ping`}
                  style={{ backgroundColor: TONE_HEX.urgent }}
                />
              )}
            </span>
          </span>
        )}
      </header>

      <p className="text-3xs text-fg-faint mt-1.5 leading-snug line-clamp-2">{node.subtitle}</p>

      {isLive && (
        <div className="mt-2 flex items-baseline gap-1.5">
          <span
            key={countKey}
            className={`text-xl font-semibold font-mono leading-none ${numberTone} inline-block ${
              countPulse ? 'motion-safe:animate-mushi-count-pop' : ''
            }`}
          >
            {node.count}
          </span>
          <span className="text-3xs text-fg-muted truncate">{node.countLabel}</span>
        </div>
      )}

      {isLive && (
        <p className="mt-1.5 text-3xs text-fg-secondary leading-snug line-clamp-2 min-h-[2rem]">
          {node.bottleneck ?? (
            <span className="text-fg-faint">Clean &mdash; nothing waiting here.</span>
          )}
        </p>
      )}

      <div className="mt-2 text-3xs text-brand inline-flex items-center gap-1 group-hover/pdca:underline">
        {node.ctaLabel}
        <span aria-hidden="true">→</span>
      </div>
    </>
  )
}

export const PdcaStepNode = memo(PdcaStepNodeInner)
