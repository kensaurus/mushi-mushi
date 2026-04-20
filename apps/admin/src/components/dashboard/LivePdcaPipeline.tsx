/**
 * FILE: apps/admin/src/components/dashboard/LivePdcaPipeline.tsx
 * PURPOSE: Beginner-mode dashboard centerpiece — a horizontal Plan→Do→Check→Act
 *          storyboard that turns the abstract PDCA loop into something the user
 *          can *watch happen*. Solves the audit's #1 finding: new users couldn't
 *          tell what Mushi actually does.
 *
 *          Two modes:
 *            (1) Static narrative — four nodes with plain-language outcome copy
 *                pulled from PDCA_STAGE_OUTCOMES. Each node deep-links to the
 *                page that owns that stage so the loop doubles as navigation.
 *            (2) Demo run — clicking "Watch a bug travel through Mushi" fires
 *                a real synthetic test report against the active project and
 *                visually pulses each stage in sequence so the user sees the
 *                loop in motion. The real report shows up in /reports
 *                immediately afterwards so the demo is anchored in real data.
 *
 *          Hidden in advanced mode (the PdcaCockpit covers power-user needs).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Btn, Card } from '../ui'
import { apiFetch } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { useAdminMode } from '../../lib/mode'
import { PDCA_ORDER, PDCA_STAGES, PDCA_STAGE_OUTCOMES, type PdcaStageId } from '../../lib/pdca'

interface Props {
  /** Active project id — required to fire the demo test report. */
  projectId?: string | null
  /** Called after a demo report lands so the dashboard can refresh. */
  onDemoReportSent?: () => void
}

type DemoState = 'idle' | 'running' | 'done' | 'error'

const STAGE_CTA: Record<PdcaStageId, { to: string; label: string }> = {
  plan: { to: '/reports', label: 'See your bugs' },
  do: { to: '/fixes', label: 'See draft fixes' },
  check: { to: '/judge', label: 'See judge scores' },
  act: { to: '/integrations', label: 'See where fixes ship' },
}

// Per-stage demo dwell time. ~1s per stage feels alive without dragging on;
// the whole animation finishes in ~5s which matches the perceived round-trip
// of the real synthetic report.
const STAGE_MS = 1100

export function LivePdcaPipeline({ projectId, onDemoReportSent }: Props) {
  const { isBeginner } = useAdminMode()
  const toast = useToast()
  const navigate = useNavigate()
  const [demoState, setDemoState] = useState<DemoState>('idle')
  const [activeStage, setActiveStage] = useState<PdcaStageId | null>(null)
  const [doneStages, setDoneStages] = useState<Set<PdcaStageId>>(new Set())
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const animate = useCallback(
    (index: number) => {
      if (index >= PDCA_ORDER.length) {
        setActiveStage(null)
        setDemoState('done')
        return
      }
      const stage = PDCA_ORDER[index]
      setActiveStage(stage)
      timerRef.current = setTimeout(() => {
        setDoneStages((prev) => new Set(prev).add(stage))
        animate(index + 1)
      }, STAGE_MS)
    },
    [],
  )

  const runDemo = useCallback(async () => {
    if (demoState === 'running') return
    setDemoState('running')
    setDoneStages(new Set())
    setActiveStage(null)

    // Kick the visual sequence immediately so the UI feels responsive even
    // before the network round-trip completes.
    animate(0)

    if (!projectId) {
      // Pure-visual mode (no project yet) — still narrate the loop.
      return
    }

    const res = await apiFetch<{ reportId: string; projectName: string }>(
      `/v1/admin/projects/${projectId}/test-report`,
      { method: 'POST' },
    )
    if (!res.ok || !res.data) {
      if (timerRef.current) clearTimeout(timerRef.current)
      setActiveStage(null)
      setDemoState('error')
      toast.error('Demo failed', res.error?.message ?? 'Could not send the test bug. Try again.')
      return
    }
    const reportId = res.data.reportId
    toast.success(
      'Demo bug sent',
      'Watch the loop above, then open Reports to see the real entry.',
      {
        label: 'Open report',
        onClick: () => navigate(`/reports/${reportId}`),
      },
    )
    onDemoReportSent?.()
  }, [animate, demoState, navigate, onDemoReportSent, projectId, toast])

  if (!isBeginner) return null

  return (
    <section
      aria-labelledby="live-pdca-pipeline-title"
      className="mb-4 overflow-hidden rounded-lg border border-edge-subtle bg-gradient-to-br from-brand/5 via-surface-raised/40 to-surface-raised/10"
    >
      <header className="flex flex-wrap items-start justify-between gap-3 px-4 pt-3.5">
        <div className="min-w-0">
          <p className="text-2xs font-semibold uppercase tracking-wider text-brand/80">
            How Mushi works
          </p>
          <h2 id="live-pdca-pipeline-title" className="mt-0.5 text-base font-semibold text-fg leading-snug">
            Every bug travels this loop. You watch, you approve, you ship.
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <Btn
            size="sm"
            variant={demoState === 'done' ? 'ghost' : 'primary'}
            onClick={runDemo}
            disabled={demoState === 'running'}
            loading={demoState === 'running'}
          >
            {demoState === 'running'
              ? 'Bug is travelling…'
              : demoState === 'done'
                ? '✓ Watch again'
                : 'Watch a bug travel through Mushi'}
          </Btn>
          {demoState === 'done' && (
            <Link to="/reports" className="text-2xs text-brand hover:underline">
              Open Reports →
            </Link>
          )}
        </div>
      </header>

      <ol className="grid grid-cols-1 gap-2.5 px-4 pb-4 pt-3 lg:grid-cols-4">
        {PDCA_ORDER.map((stage, i) => (
          <PipelineNode
            key={stage}
            stage={stage}
            isActive={activeStage === stage}
            isDone={doneStages.has(stage)}
            isLast={i === PDCA_ORDER.length - 1}
          />
        ))}
      </ol>

      <footer className="border-t border-edge-subtle px-4 py-2">
        <p className="text-3xs text-fg-faint leading-relaxed">
          Click any stage to jump straight in. The loop is dogfooded against{' '}
          <span className="font-mono text-fg-secondary">glot-it</span> — every bug your users feel runs
          through the same four steps.
        </p>
      </footer>
    </section>
  )
}

interface NodeProps {
  stage: PdcaStageId
  isActive: boolean
  isDone: boolean
  isLast: boolean
}

function PipelineNode({ stage, isActive, isDone, isLast }: NodeProps) {
  const meta = PDCA_STAGES[stage]
  const outcome = PDCA_STAGE_OUTCOMES[stage]
  const cta = STAGE_CTA[stage]

  // Visual state: pending (dim), active (pulse + ring), done (solid + check).
  const ringClass = isActive
    ? `ring-2 ring-offset-1 ring-offset-surface ${meta.ring} ${meta.tintBg}`
    : isDone
      ? `${meta.tintBg} ${meta.tintBorder}`
      : 'opacity-90'

  return (
    <li className="relative">
      <Card elevated interactive className={`h-full motion-safe:transition-all motion-safe:duration-300 ${ringClass}`}>
        <Link
          to={cta.to}
          className="group block rounded-md p-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
        >
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={`relative inline-flex h-7 w-7 items-center justify-center rounded-md text-sm font-bold leading-none shrink-0 ${meta.badgeBg} ${meta.badgeFg}`}
            >
              {isDone ? <CheckIcon /> : meta.letter}
              {isActive && (
                <span
                  className={`absolute inset-0 rounded-md ${meta.badgeBg} opacity-70 motion-safe:animate-ping`}
                />
              )}
            </span>
            <div className="min-w-0">
              <p className={`text-3xs font-mono uppercase tracking-wider ${meta.text}`}>
                {meta.label} · {outcome.pipelineLabel}
              </p>
              <h3 className="text-xs font-semibold text-fg leading-tight">
                {outcome.headline}
              </h3>
            </div>
          </div>

          <p className="mt-2 text-2xs text-fg-secondary leading-snug line-clamp-3 min-h-[3rem]">
            {outcome.outcome}
          </p>

          <p className="mt-2 inline-flex items-center gap-1 text-2xs text-brand group-hover:underline">
            {cta.label}
            <span aria-hidden="true">→</span>
          </p>
        </Link>
      </Card>

      {!isLast && <Connector active={isActive || isDone} />}
    </li>
  )
}

function Connector({ active }: { active: boolean }) {
  return (
    <span aria-hidden="true" className="pointer-events-none">
      <span
        className={`hidden lg:flex absolute top-1/2 -right-2 -translate-y-1/2 z-10 h-4 w-4 items-center justify-center motion-safe:transition-colors ${active ? 'text-brand' : 'text-fg-faint'}`}
      >
        <ArrowSvg direction="right" />
      </span>
      <span
        className={`lg:hidden flex absolute -bottom-2 left-1/2 -translate-x-1/2 z-10 h-4 w-4 items-center justify-center motion-safe:transition-colors ${active ? 'text-brand' : 'text-fg-faint'}`}
      >
        <ArrowSvg direction="down" />
      </span>
    </span>
  )
}

function ArrowSvg({ direction }: { direction: 'right' | 'down' }) {
  const path = direction === 'right'
    ? 'M3 7h7m0 0L7 4m3 3-3 3'
    : 'M7 3v7m0 0L4 7m3 3 3-3'
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d={path} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M2.5 6.5L5 9l4.5-5.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
