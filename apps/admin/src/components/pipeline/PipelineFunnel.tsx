/**
 * FILE: apps/admin/src/components/pipeline/PipelineFunnel.tsx
 * PURPOSE: The pipeline as a row of stages, Reported → … → Deployed. Each
 *          stage shows how many items are in it now, how many are stuck, the
 *          oldest one's age, and a bar split stuck / moving / done, sized
 *          against the busiest stage. A stage is a button: it filters the
 *          stuck groups below to that stage.
 */

import { IconAlertTriangle, IconChevronRight } from '../icons'
import { ageLabel, type PipelineStage } from '../../lib/pipeline'

interface Props {
  stages: PipelineStage[]
  selected: string | null
  onSelect: (stageId: string | null) => void
  now: number
}

function split(stage: PipelineStage) {
  let moving = 0
  let done = 0
  for (const g of stage.groups) {
    if (g.tone === 'moving') moving += g.count
    else if (g.tone === 'done') done += g.count
  }
  return { stuck: stage.stuck, moving, done }
}

export function PipelineFunnel({ stages, selected, onSelect, now }: Props) {
  const max = Math.max(1, ...stages.map((s) => s.count))
  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8" aria-label="Pipeline stages" data-testid="pipeline-funnel">
      {stages.map((s, i) => {
        const parts = split(s)
        const active = selected === s.id
        const pct = (n: number) => `${(n / max) * 100}%`
        return (
          <li key={s.id} className="relative min-w-0">
            <button
              type="button"
              onClick={() => onSelect(active ? null : s.id)}
              aria-pressed={active}
              data-testid={`pipeline-stage-${s.id}`}
              className={`flex h-full w-full flex-col gap-1.5 rounded-md border p-2.5 text-left motion-safe:transition-colors ${
                active ? 'border-brand bg-brand/8' : s.stuck > 0 ? 'border-danger/40 bg-danger-muted/30 hover:border-danger/60' : 'border-edge-subtle bg-surface-raised hover:border-edge'
              }`}
            >
              <span className="flex items-center justify-between gap-1 text-2xs font-medium uppercase tracking-wide text-fg-muted">
                <span className="truncate">
                  <span className="tabular-nums text-fg-faint">{i + 1}</span> {s.label}
                </span>
              </span>
              <span className="text-2xl font-semibold leading-none tabular-nums text-fg" data-testid={`pipeline-stage-${s.id}-count`}>
                {s.count}
              </span>
              <span className="flex min-h-5 flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs">
                {s.stuck > 0 ? (
                  <span className="inline-flex items-center gap-0.5 font-medium text-danger-foreground" data-testid={`pipeline-stage-${s.id}-stuck`}>
                    <IconAlertTriangle size={12} />
                    {s.stuck} stuck
                  </span>
                ) : s.count > 0 ? (
                  <span className="text-ok-foreground">flowing</span>
                ) : (
                  <span className="text-fg-faint">empty</span>
                )}
                {s.oldestAt && <span className="text-fg-muted tabular-nums" title={`Oldest since ${new Date(s.oldestAt).toLocaleString()}`}>oldest {ageLabel(s.oldestAt, now)}</span>}
              </span>
              <span className="flex h-1.5 w-full overflow-hidden rounded-full bg-surface-overlay" aria-hidden="true">
                <span className="h-full bg-danger" style={{ width: pct(parts.stuck) }} />
                <span className="h-full bg-info" style={{ width: pct(parts.moving) }} />
                <span className="h-full bg-ok" style={{ width: pct(parts.done) }} />
              </span>
            </button>
            {i < stages.length - 1 && (
              <span className="pointer-events-none absolute -right-2 top-1/2 hidden -translate-y-1/2 text-fg-faint xl:block"><IconChevronRight size={12} /></span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

/** The bar's key, once under the stages. */
export function FunnelLegend() {
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-fg-muted">
      <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-danger" aria-hidden="true" />stuck</span>
      <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-info" aria-hidden="true" />moving</span>
      <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-ok" aria-hidden="true" />done (7 days)</span>
      <span>Click a stage to see only its groups.</span>
    </p>
  )
}
