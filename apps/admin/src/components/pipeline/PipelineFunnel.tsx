/**
 * FILE: apps/admin/src/components/pipeline/PipelineFunnel.tsx
 * PURPOSE: The pipeline as one segmented bar, Reported → … → Deployed (2026-11-18; it was
 *          eight tall cards, six of them pink, so the colour said nothing). Each segment: its
 *          name, how many items sit in it (big mono number), a bar sized against the busiest
 *          stage with the stuck part darker, the stuck count or "flowing", and the oldest age.
 *          Only the jam takes a colour and a shape (lib/pipelineSignals.ts `stageTones`):
 *          ▲ the bottleneck, ◆ a stage nearly as stuck. A segment is a button: it filters the
 *          stuck groups below to that stage.
 */

import { ageLabel, STAGE_PLAIN, type PipelineStage } from '../../lib/pipeline'
import { stageTones } from '../../lib/pipelineSignals'
import { StatusGlyph, TONE_INK, type SignalTone } from '../signal/StatusGlyph'

interface Props {
  stages: PipelineStage[]
  /** Apps by who opened a fix in 24 h, shown on the Fix PR stage. */
  openers?: { server: number; local: number; nobody: number; total: number } | null
  selected: string | null
  onSelect: (stageId: string | null) => void
  now: number
}

const CELL: Partial<Record<SignalTone, string>> = {
  danger: 'bg-danger-muted',
  warn: 'bg-warn-muted',
}
const STUCK_BAR: Partial<Record<SignalTone, string>> = {
  danger: 'bg-danger',
  warn: 'bg-warn',
}

export function PipelineFunnel({ stages, openers, selected, onSelect, now }: Props) {
  const max = Math.max(1, ...stages.map((s) => s.count))
  const tones = stageTones(stages)
  return (
    <div className="@container">
      <ol
        className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-edge bg-edge @md:grid-cols-4 @4xl:grid-cols-8"
        aria-label="Pipeline stages, left to right"
        data-testid="pipeline-funnel"
      >
        {stages.map((s, i) => {
          const tone = tones[s.id]
          const active = selected === s.id
          // Square-root width: one busy stage (the backlog) must not shrink every other bar to nothing.
          const width = s.count > 0 ? Math.max(4, Math.sqrt(s.count / max) * 100) : 0
          const stuckShare = s.count > 0 ? Math.min(100, (s.stuck / s.count) * 100) : 0
          return (
            <li key={s.id} className="min-w-0" data-tone={tone ?? 'neutral'}>
              <button
                type="button"
                onClick={() => onSelect(active ? null : s.id)}
                aria-pressed={active}
                data-testid={`pipeline-stage-${s.id}`}
                title={STAGE_PLAIN[s.id]}
                className={`ci-rise flex h-full w-full flex-col gap-0.5 px-2 py-1.5 text-left motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset ${
                  active ? 'bg-accent-muted ring-2 ring-accent ring-inset' : `${(tone && CELL[tone]) || 'bg-surface-raised'} hover:bg-surface-overlay`
                }`}
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <span className="flex min-w-0 items-center gap-1">
                  {tone && <StatusGlyph tone={tone} className="h-2.5 w-2.5" />}
                  <span className={`truncate text-3xs font-bold tracking-wider uppercase ${tone ? TONE_INK[tone] : 'text-fg-secondary'}`}>
                    <span className="tabular-nums text-fg-faint">{i + 1}</span> {s.label}
                  </span>
                </span>
                <span className="truncate text-3xs text-fg-secondary" data-testid={`pipeline-stage-${s.id}-plain`}>
                  {STAGE_PLAIN[s.id]}
                </span>
                <span className={`font-mono text-lg leading-none font-extrabold tabular-nums ${s.count === 0 ? 'text-fg-faint' : 'text-fg'}`} data-testid={`pipeline-stage-${s.id}-count`}>
                  {s.count}
                </span>
                <span className="block h-1.5 w-full overflow-hidden rounded-full bg-surface-overlay" aria-hidden="true">
                  <span className="ci-grow-x flex h-full overflow-hidden rounded-full bg-fg-faint" style={{ width: `${width}%`, animationDelay: `${i * 40}ms` }}>
                    <span className={`h-full ${(tone && STUCK_BAR[tone]) || 'bg-fg-secondary'}`} style={{ width: `${stuckShare}%` }} />
                  </span>
                </span>
                <span className="flex min-h-4 flex-wrap items-center gap-x-1.5 text-3xs">
                  {s.stuck > 0 && s.id === 'triaged' ? (
                    // The backlog: bugs no fix has started on. Waiting, not a person's to-do: never coloured.
                    <span className="font-semibold text-fg-secondary" data-testid={`pipeline-stage-${s.id}-stuck`}>
                      {s.stuck} waiting over 3 days
                    </span>
                  ) : s.stuck > 0 ? (
                    <span className={`font-bold ${tone ? TONE_INK[tone] : 'text-fg'}`} data-testid={`pipeline-stage-${s.id}-stuck`}>
                      {s.stuck} stuck
                    </span>
                  ) : s.count > 0 ? (
                    <span className="text-fg-secondary">flowing</span>
                  ) : (
                    <span className="text-fg-faint">empty</span>
                  )}
                  {s.oldestAt && (
                    <span className="font-mono text-fg-secondary tabular-nums" title={`Oldest since ${new Date(s.oldestAt).toLocaleString()}`}>
                      oldest {ageLabel(s.oldestAt, now)}
                    </span>
                  )}
                </span>
                {s.id === 'pr' && openers && (
                  <span className="text-3xs text-fg-secondary" data-testid="pipeline-stage-pr-openers">
                    {/* Apps, not fixes: the pace line counts fixes. "cloud 0 · your worker 8"
                        beside "97 fixes started" read as one count (2026-11-16). */}
                    Apps that started a fix in 24 h:{' '}
                    <span className="font-semibold text-fg">
                      {openers.total - openers.nobody} of {openers.total}
                    </span>{' '}
                    (cloud <span className={openers.server === 0 ? 'font-bold text-danger-foreground' : 'font-semibold text-fg'}>{openers.server}</span>, your worker{' '}
                    <span className="font-semibold text-fg">{openers.local}</span>)
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/** The bar's key, once under the stages. */
export function FunnelLegend() {
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-fg-secondary">
      <span className="inline-flex items-center gap-1">
        <StatusGlyph tone="danger" />
        the bottleneck
      </span>
      <span className="inline-flex items-center gap-1">
        <StatusGlyph tone="warn" />
        nearly as stuck
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="inline-flex h-1.5 w-6 overflow-hidden rounded-full bg-fg-faint" aria-hidden="true">
          <span className="h-full w-1/2 bg-fg-secondary" />
        </span>
        darker part = stuck
      </span>
      <span>Bar width: items in the stage (square-root scale). Click a stage to see only its groups.</span>
    </p>
  )
}
