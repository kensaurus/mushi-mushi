/**
 * FILE: apps/admin/src/components/dashboard/PdcaCockpit.tsx
 * PURPOSE: Top-of-dashboard PDCA strip — four stage tiles (Plan / Do / Check
 *          / Act) with a single living number, the current bottleneck, and a
 *          deep-link into the stage. The "current focus" stage gets a brand
 *          ring so the user always sees `→ where do I act now?` without
 *          parsing the rest of the dashboard.
 *
 *          This component is the answer to two pain points captured in the
 *          UX audit: (1) "what do I do first?" and (2) "how does mushi-mushi
 *          fit the PDCA loop my team actually runs?".
 */

import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Card } from '../ui'
import type { PdcaStage, PdcaStageId, PdcaStageTone } from './types'

interface Props {
  stages: PdcaStage[]
  focusStage: PdcaStageId | null | undefined
}

const STAGE_ACCENT: Record<PdcaStageId, { letter: string; ring: string; iconBg: string; iconFg: string }> = {
  plan:  { letter: 'P', ring: 'ring-info/50',  iconBg: 'bg-info-muted',  iconFg: 'text-info' },
  do:    { letter: 'D', ring: 'ring-brand/60', iconBg: 'bg-brand/15',    iconFg: 'text-brand' },
  check: { letter: 'C', ring: 'ring-warn/50',  iconBg: 'bg-warn-muted',  iconFg: 'text-warn' },
  act:   { letter: 'A', ring: 'ring-ok/50',    iconBg: 'bg-ok-muted',    iconFg: 'text-ok' },
}

const TONE_NUMBER: Record<PdcaStageTone, string> = {
  ok: 'text-fg',
  warn: 'text-warn',
  urgent: 'text-danger',
}

const TONE_BADGE: Record<PdcaStageTone, { dot: string; label: string }> = {
  ok:     { dot: 'bg-ok',     label: 'Healthy' },
  warn:   { dot: 'bg-warn',   label: 'Watch' },
  urgent: { dot: 'bg-danger', label: 'Bottleneck' },
}

export function PdcaCockpit({ stages, focusStage }: Props) {
  if (stages.length === 0) return null

  const bottleneckStage = stages.find(s => s.tone === 'urgent') ?? null

  return (
    <section aria-label="PDCA cockpit" className="mb-4">
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="text-2xs font-semibold text-fg-muted uppercase tracking-wider">
          PDCA cockpit
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

      {bottleneckStage && (
        <BottleneckCallout stage={bottleneckStage} />
      )}
    </section>
  )
}

interface TileProps {
  stage: PdcaStage
  isFocus: boolean
  /** Whether to render the right-edge connector arrow on lg+ screens. */
  connector: boolean
}

function StageTile({ stage, isFocus, connector }: TileProps) {
  const accent = STAGE_ACCENT[stage.id]
  const numberTone = TONE_NUMBER[stage.tone]
  const badge = TONE_BADGE[stage.tone]
  return (
    <div className="relative">
      <Card
        elevated
        interactive
        className={`h-full ${isFocus ? `ring-2 ring-offset-1 ring-offset-surface ${accent.ring}` : ''}`}
      >
        <Link
          to={stage.cta.to}
          className="block p-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 rounded-md"
        >
          <div className="flex items-start gap-2.5">
            <span
              className={`inline-flex items-center justify-center w-6 h-6 rounded-md font-bold text-xs leading-none shrink-0 ${accent.iconBg} ${accent.iconFg}`}
              aria-hidden="true"
            >
              {accent.letter}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-fg">{stage.label}</span>
                <span
                  className="inline-flex items-center gap-1 text-3xs text-fg-muted"
                  title={`${badge.label} · ${stage.bottleneck ?? 'No action needed'}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                  {badge.label}
                </span>
              </div>
              <p className="text-2xs text-fg-faint mt-0.5">{stage.description}</p>

              <div className="mt-2 flex items-baseline gap-1.5">
                <span className={`text-2xl font-semibold font-mono leading-none ${numberTone}`}>
                  {stage.count}
                </span>
                <span className="text-2xs text-fg-muted truncate">{stage.countLabel}</span>
              </div>

              <p className="mt-2 text-2xs text-fg-secondary line-clamp-2 min-h-[2rem]">
                {stage.bottleneck ?? <span className="text-fg-faint">Nothing blocking — pipeline is clean.</span>}
              </p>

              <div className="mt-2 flex items-center justify-between">
                <span className="text-2xs text-brand group-hover:underline inline-flex items-center gap-1">
                  {stage.cta.label}
                  <span aria-hidden="true">→</span>
                </span>
                {isFocus && (
                  <span className="text-3xs text-fg-muted uppercase tracking-wide">
                    Current focus
                  </span>
                )}
              </div>
            </div>
          </div>
        </Link>
      </Card>

      {connector && (
        <ArrowConnector />
      )}
    </div>
  )
}

function ArrowConnector(): ReactNode {
  return (
    <span
      aria-hidden="true"
      className="hidden lg:flex absolute top-1/2 -right-2 -translate-y-1/2 z-10 w-4 h-4 items-center justify-center text-fg-faint"
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M3 7h7m0 0L7 4m3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

function BottleneckCallout({ stage }: { stage: PdcaStage }) {
  return (
    <Link
      to={stage.cta.to}
      className="mt-2 group flex items-center gap-2 px-3 py-2 rounded-md bg-danger-muted border border-danger/30 text-2xs text-fg hover:bg-danger-muted/80 motion-safe:transition-colors"
    >
      <span className="inline-flex w-4 h-4 items-center justify-center rounded-full bg-danger text-2xs text-white font-semibold shrink-0">
        !
      </span>
      <span className="min-w-0 flex-1">
        <span className="font-medium">{stage.label} stage is the bottleneck:</span>{' '}
        <span className="text-fg-secondary">{stage.bottleneck ?? `${stage.count} ${stage.countLabel}`}</span>
      </span>
      <span className="text-brand group-hover:underline inline-flex items-center gap-1 shrink-0">
        Resolve <span aria-hidden="true">→</span>
      </span>
    </Link>
  )
}
