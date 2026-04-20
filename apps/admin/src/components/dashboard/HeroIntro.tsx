/**
 * FILE: apps/admin/src/components/dashboard/HeroIntro.tsx
 * PURPOSE: Pinned dashboard hero \u2014 the *one* thing the user should look at on
 *          login. Surfaces the "current focus" PDCA stage as a single,
 *          unmissable next-action card with brand glow + a primary CTA.
 *
 *          This is the audit's #1 fix: end-users opening the dashboard had to
 *          read four KPI tiles, four PDCA tiles, and a checklist before
 *          knowing what to do next. The hero answers "what now?" in one read.
 *
 *          Falls back to a "loop is healthy" tile when no stage is in
 *          bottleneck, so the hero never disappears.
 */

import { Link } from 'react-router-dom'
import { PDCA_STAGES } from '../../lib/pdca'
import { pluralize } from '../../lib/format'
import type { PdcaStage, PdcaStageId } from './types'

interface Props {
  stages: PdcaStage[]
  focusStage: PdcaStageId | null | undefined
  /** Active project name shown to anchor the loop in the user's reality. */
  projectName?: string | null
  /** Last-report timestamp (ISO) \u2014 powers the live pulse. */
  lastReportAt?: string | null
}

export function HeroIntro({ stages, focusStage, projectName, lastReportAt }: Props) {
  if (stages.length === 0) return null

  const focus = pickFocus(stages, focusStage)
  const meta = PDCA_STAGES[focus.id]
  const subtle = focus.tone === 'ok'

  return (
    <section
      aria-label="Dashboard hero"
      className={`relative mb-4 overflow-hidden rounded-lg border ${meta.tintBorder} ${meta.tintBg}`}
    >
      <span
        aria-hidden="true"
        className={`absolute -top-12 -right-12 h-40 w-40 rounded-full blur-3xl opacity-30 ${HALO[focus.id]}`}
      />
      <div className="relative grid gap-4 p-4 md:grid-cols-[1fr_auto] md:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-2xs font-medium text-fg-muted uppercase tracking-wider">
            <span
              className={`inline-flex h-5 items-center gap-1.5 rounded-sm border px-1.5 ${meta.tintBorder} ${meta.text}`}
            >
              <span
                aria-hidden="true"
                className={`inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm text-[0.55rem] font-bold leading-none ${meta.badgeBg} ${meta.badgeFg}`}
              >
                {meta.letter}
              </span>
              {subtle ? 'PDCA loop \u2014 healthy' : `${meta.label} \u2014 next action`}
            </span>
            {projectName && (
              <span className="text-3xs text-fg-faint normal-case tracking-normal">
                on <span className="font-mono text-fg-secondary">{projectName}</span>
              </span>
            )}
            {lastReportAt && <PulseChip lastReportAt={lastReportAt} />}
          </div>

          <h1 className="mt-2 text-xl font-semibold text-fg leading-tight">
            {subtle ? 'Loop is clean. Watch for the next inbound bug.' : focus.bottleneck ?? `${focus.count} ${focus.countLabel}`}
          </h1>
          <p className="mt-1.5 text-xs text-fg-secondary leading-relaxed max-w-xl">
            {meta.hint}
          </p>
        </div>

        <div className="flex flex-col items-stretch gap-1.5 md:items-end shrink-0">
          <Link
            to={focus.cta.to}
            className="inline-flex items-center justify-center gap-1.5 rounded-md bg-brand px-3.5 py-2 text-sm font-semibold text-brand-fg shadow-card hover:bg-brand-hover hover:shadow-raised motion-safe:transition-all motion-safe:duration-150 motion-safe:active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            {focus.cta.label}
            <span aria-hidden="true">→</span>
          </Link>
          <span className="text-3xs text-fg-faint text-center md:text-right">
            {countCopy(focus)}
          </span>
        </div>
      </div>
    </section>
  )
}

/** Halos use a colour-matched, brand-leaning glow so the hero feels alive
 *  without breaking the dark theme. */
const HALO: Record<PdcaStageId, string> = {
  plan:  'bg-info',
  do:    'bg-brand',
  check: 'bg-warn',
  act:   'bg-ok',
}

function pickFocus(stages: PdcaStage[], focusStage: PdcaStageId | null | undefined): PdcaStage {
  // Prefer the urgent stage; fall back to focus hint from the API; otherwise
  // anchor to the first stage that has any count to act on; finally Plan.
  const urgent = stages.find(s => s.tone === 'urgent')
  if (urgent) return urgent
  const fromHint = focusStage && stages.find(s => s.id === focusStage)
  if (fromHint) return fromHint
  const withWork = stages.find(s => s.count > 0)
  return withWork ?? stages[0]
}

function countCopy(stage: PdcaStage): string {
  if (stage.tone === 'ok') return 'Pipeline running. Nothing waiting on you.'
  return `${stage.count} ${pluralize(stage.count, 'item')} in this stage`
}

function PulseChip({ lastReportAt }: { lastReportAt: string }) {
  const ageMs = Date.now() - new Date(lastReportAt).getTime()
  const fresh = ageMs < 60_000 * 5 // < 5 min = "live"
  return (
    <span
      className={`inline-flex items-center gap-1 text-3xs font-mono normal-case tracking-normal ${fresh ? 'text-ok' : 'text-fg-faint'}`}
      title={`Last report ${new Date(lastReportAt).toLocaleString()}`}
    >
      <span
        aria-hidden="true"
        className={`relative inline-flex h-1.5 w-1.5 rounded-full ${fresh ? 'bg-ok' : 'bg-fg-faint'}`}
      >
        {fresh && (
          <span className="absolute inline-flex h-full w-full rounded-full bg-ok opacity-60 motion-safe:animate-ping" />
        )}
      </span>
      {humaniseAge(ageMs)}
    </span>
  )
}

function humaniseAge(ms: number): string {
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s ago`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`
  return `${Math.round(ms / 86_400_000)}d ago`
}
