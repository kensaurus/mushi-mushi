/**
 * FILE: apps/admin/src/components/charts/FunnelBars.tsx
 * PURPOSE: Horizontal step bars for a product funnel — one row per step,
 *          bar width relative to the first step, with conversion from the
 *          previous step, drop-off, and median time-to-step.
 *
 *          Hand-rolled with theme tokens (bg-brand / bg-edge / text-fg-*),
 *          same approach as `charts.tsx` — no charting dependency.
 */

export interface FunnelBarStep {
  name: string
  /** People who reached this step (in order, within the window). */
  entered: number
  /** People who went on to the next step (server-computed). */
  converted: number
  /** Server-computed conversion to the next step, 0–100. */
  pct: number
  /** Median seconds from the previous step, or null on the first step. */
  median_secs: number | null
}

interface FunnelBarsProps {
  steps: FunnelBarStep[]
  /** Optional label prefix (e.g. a breakdown value) rendered above the bars. */
  caption?: string
  className?: string
}

function formatMedianSecs(secs: number | null | undefined): string {
  if (secs == null || !Number.isFinite(secs)) return '—'
  if (secs < 60) return `${Math.round(secs)}s`
  const mins = secs / 60
  if (mins < 60) return `${mins.toFixed(mins < 10 ? 1 : 0)}m`
  const hours = mins / 60
  if (hours < 48) return `${hours.toFixed(1)}h`
  return `${(hours / 24).toFixed(1)}d`
}

function pctOf(part: number, whole: number): number {
  if (whole <= 0) return 0
  return Math.max(0, Math.min(100, (part / whole) * 100))
}

export function FunnelBars({ steps, caption, className = '' }: FunnelBarsProps) {
  if (steps.length === 0) return null
  const start = steps[0].entered
  const finish = steps[steps.length - 1].entered
  const overall = pctOf(finish, start)

  return (
    <figure className={className} aria-label={caption ? `Funnel — ${caption}` : 'Funnel'}>
      {caption && (
        <figcaption className="mb-2 flex items-baseline justify-between gap-2">
          <span className="text-xs font-medium text-fg-secondary">{caption}</span>
          <span className="text-2xs tabular-nums text-fg-muted">{overall.toFixed(1)}% end to end</span>
        </figcaption>
      )}
      <ol className="space-y-2">
        {steps.map((step, i) => {
          const prev = i > 0 ? steps[i - 1].entered : null
          const widthPct = pctOf(step.entered, start)
          const fromPrev = prev == null ? 100 : pctOf(step.entered, prev)
          const dropped = prev == null ? 0 : Math.max(0, prev - step.entered)
          return (
            <li key={`${i}-${step.name}`} className="text-xs">
              <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="w-4 shrink-0 text-right tabular-nums text-fg-faint">{i + 1}</span>
                  <span className="truncate font-mono text-fg" title={step.name}>{step.name}</span>
                </span>
                <span className="flex shrink-0 items-baseline gap-3 tabular-nums text-fg-muted">
                  <span className="text-fg">{step.entered.toLocaleString()}</span>
                  {prev != null && (
                    <>
                      <span title="Conversion from the previous step">{fromPrev.toFixed(1)}%</span>
                      <span className={dropped > 0 ? 'text-warning-foreground' : 'text-fg-faint'} title="Dropped since the previous step">
                        −{dropped.toLocaleString()}
                      </span>
                      <span title="Median time from the previous step">{formatMedianSecs(step.median_secs)}</span>
                    </>
                  )}
                </span>
              </div>
              <div className="ml-6 h-2.5 overflow-hidden rounded-full bg-edge" role="presentation">
                <div
                  className="h-full rounded-full bg-brand motion-safe:transition-[width]"
                  style={{ width: `${widthPct}%` }}
                />
              </div>
            </li>
          )
        })}
      </ol>
      {!caption && (
        <p className="mt-2 text-2xs tabular-nums text-fg-muted">
          {overall.toFixed(1)}% of people who did <span className="font-mono">{steps[0].name}</span> reached{' '}
          <span className="font-mono">{steps[steps.length - 1].name}</span>.
        </p>
      )}
    </figure>
  )
}
