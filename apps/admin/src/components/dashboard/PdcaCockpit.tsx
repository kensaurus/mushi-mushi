/**
 * FILE: apps/admin/src/components/dashboard/PdcaCockpit.tsx
 * PURPOSE: Four-stage PDCA navigator that pairs with the dashboard <HeroIntro/>.
 *          Hero answers "what do I do next?"; this answers "what's the state
 *          of the whole pipeline?".
 *
 *          Each tile shows: stage letter, label, single living count, the
 *          current bottleneck for that stage (or a "clean" line), and a
 *          deep-link CTA. The current focus stage gets a tinted background
 *          + ring; arrows connect stages at every breakpoint so the loop is
 *          visible whether you're on mobile or wide.
 */

import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { PDCA_STAGES } from '../../lib/pdca'
import { Card } from '../ui'
import { LineSparkline } from '../charts'
import type { PdcaStage, PdcaStageId, PdcaStageTone } from './types'

interface Props {
  stages: PdcaStage[]
  focusStage: PdcaStageId | null | undefined
}

const TONE_NUMBER: Record<PdcaStageTone, string> = {
  ok: 'text-fg',
  warn: 'text-warn',
  urgent: 'text-danger',
}

const TONE_DOT: Record<PdcaStageTone, { dot: string; label: string; pulse?: boolean }> = {
  ok:     { dot: 'bg-ok',     label: 'Healthy' },
  warn:   { dot: 'bg-warn',   label: 'Watch' },
  urgent: { dot: 'bg-danger', label: 'Bottleneck', pulse: true },
}

export function PdcaCockpit({ stages, focusStage }: Props) {
  if (stages.length === 0) return null
  return (
    <section aria-label="Loop status" className="mb-4">
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="text-2xs font-semibold text-fg-muted uppercase tracking-wider">
          Loop status &mdash; Plan, Do, Check, Act
        </h2>
        <span className="text-2xs text-fg-faint">
          One loop · Plan → Do → Check → Act
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        {stages.map((stage, i) => (
          <StageTile
            key={stage.id}
            stage={stage}
            isFocus={focusStage === stage.id}
            connector={i < stages.length - 1}
          />
        ))}
      </div>
    </section>
  )
}

interface TileProps {
  stage: PdcaStage
  isFocus: boolean
  connector: boolean
}

function StageTile({ stage, isFocus, connector }: TileProps) {
  const meta = PDCA_STAGES[stage.id]
  const numberTone = TONE_NUMBER[stage.tone]
  const dot = TONE_DOT[stage.tone]
  return (
    <div className="relative" data-tour-id={`pdca-${stage.id}`}>
      <Card
        elevated
        interactive
        className={`h-full ${isFocus ? `ring-2 ring-offset-1 ring-offset-surface ${meta.ring} ${meta.tintBg}` : ''}`}
      >
        <Link
          to={stage.cta.to}
          className="block p-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 rounded-md group"
        >
          <header className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span
                aria-hidden="true"
                className={`inline-flex items-center justify-center w-7 h-7 rounded-md font-bold text-sm leading-none shrink-0 ${meta.badgeBg} ${meta.badgeFg}`}
              >
                {meta.letter}
              </span>
              <div className="min-w-0">
                <span className="text-xs font-semibold text-fg block leading-tight">{meta.label}</span>
                {isFocus && (
                  <span className={`text-3xs font-mono uppercase tracking-wider ${meta.text}`}>
                    Current focus
                  </span>
                )}
              </div>
            </div>
            <span
              className="inline-flex items-center gap-1 text-3xs text-fg-muted shrink-0"
              title={`${dot.label} · ${stage.bottleneck ?? 'No action needed'}`}
            >
              <span
                className={`relative w-1.5 h-1.5 rounded-full ${dot.dot}`}
                aria-hidden="true"
              >
                {dot.pulse && (
                  <span className={`absolute inset-0 rounded-full ${dot.dot} opacity-60 motion-safe:animate-ping`} />
                )}
              </span>
              {dot.label}
            </span>
          </header>

          <p className="text-2xs text-fg-faint mt-1.5 leading-snug line-clamp-2">{stage.description}</p>

          <div className="mt-2.5 flex items-baseline gap-1.5">
            <span className={`text-2xl font-semibold font-mono leading-none ${numberTone}`}>
              {stage.count}
            </span>
            <span className="text-2xs text-fg-muted truncate">{stage.countLabel}</span>
          </div>

          {stage.series && stage.series.length >= 2 && stage.series.some((v) => v > 0) && (
            <div className="mt-1.5 -mx-1" aria-hidden="true">
              <LineSparkline
                values={stage.series}
                accent={
                  stage.tone === 'urgent'
                    ? 'text-danger/70'
                    : stage.tone === 'warn'
                      ? 'text-warn/70'
                      : 'text-fg-faint'
                }
                ariaLabel={`${meta.label} trend, last ${stage.series.length} days`}
                height={16}
              />
            </div>
          )}

          <p className="mt-2 text-2xs text-fg-secondary leading-snug min-h-[2.25rem] line-clamp-2">
            {stage.bottleneck ?? <span className="text-fg-faint">Clean — nothing waiting in this stage.</span>}
          </p>

          <div className="mt-2.5 flex items-center justify-between">
            <span className="text-2xs text-brand inline-flex items-center gap-1 group-hover:underline">
              {stage.cta.label}
              <span aria-hidden="true">→</span>
            </span>
          </div>
        </Link>
      </Card>

      {connector && <ArrowConnector />}
    </div>
  )
}

function ArrowConnector(): ReactNode {
  // Arrow renders to the right on lg+ (between cards), and to the bottom on
  // smaller breakpoints where tiles stack into a column. Either way the
  // user sees the loop visually rather than inferring it from labels.
  return (
    <span aria-hidden="true" className="text-fg-faint pointer-events-none">
      <span className="hidden lg:flex absolute top-1/2 -right-2 -translate-y-1/2 z-10 w-4 h-4 items-center justify-center">
        <ArrowSvg direction="right" />
      </span>
      <span className="lg:hidden flex absolute -bottom-2 left-1/2 -translate-x-1/2 z-10 w-4 h-4 items-center justify-center">
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
