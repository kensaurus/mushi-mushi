/**
 * FILE: apps/admin/src/components/charts/ChartAnnotations.tsx
 * PURPOSE: Wave T.5.8b — absolute-positioned overlay that renders a
 *          1 px dashed vertical line per event over any time-series
 *          chart. Hover reveals a Tooltip with the event label, relative
 *          time, and `View` link when `href` is present.
 *
 * DATA SHAPE:
 *   Consumers pass `events` already filtered to the chart's window, plus
 *   the `fromIso` / `toIso` bounds of the chart's x-axis. We map each
 *   event to an x-percent within that window so the overlay tracks any
 *   chart shape (bars, lines, stacked).
 *
 * TONES:
 *   deploy → brand · cron → info · byok → warn
 *   Dots are always drawn; the dashed line is optional (`variant = 'full'`)
 *   so Dashboard KpiRow small charts stay minimal.
 */

import { Tooltip } from '../ui'
import type { ChartEvent } from '../../lib/apiSchemas'

function formatTooltip(e: ChartEvent): string {
  const parts = [e.label, formatRelative(e.occurred_at)]
  if (e.href) parts.push(e.href)
  return parts.join(' · ')
}

type Variant = 'dot' | 'full'

const TONE_BG: Record<ChartEvent['kind'], string> = {
  deploy: 'bg-brand',
  cron: 'bg-info',
  byok: 'bg-warn',
}

const TONE_BORDER: Record<ChartEvent['kind'], string> = {
  deploy: 'border-brand/60',
  cron: 'border-info/60',
  byok: 'border-warn/60',
}

interface ChartAnnotationsProps {
  events: ChartEvent[]
  /** Chart window lower bound (ISO). Events before this are hidden. */
  fromIso: string
  /** Chart window upper bound (ISO). Events after this are hidden. */
  toIso: string
  /** `'full'` renders a dashed vertical line + top dot; `'dot'` is just
   *  the dot, used on small KPI sparklines where a line would dominate. */
  variant?: Variant
  className?: string
  /** Optional aria-label on the overlay region (screen-reader summary). */
  ariaLabel?: string
}

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diffMs / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

export function ChartAnnotations({
  events,
  fromIso,
  toIso,
  variant = 'full',
  className = '',
  ariaLabel = 'Chart annotations',
}: ChartAnnotationsProps) {
  const from = new Date(fromIso).getTime()
  const to = new Date(toIso).getTime()
  const span = to - from
  if (!Number.isFinite(span) || span <= 0) return null
  const visible = events
    .map((e) => {
      const t = new Date(e.occurred_at).getTime()
      const pct = ((t - from) / span) * 100
      return { e, pct }
    })
    .filter(({ pct }) => pct >= 0 && pct <= 100)

  if (visible.length === 0) return null

  return (
    <div
      aria-label={ariaLabel}
      role="group"
      className={`pointer-events-none absolute inset-0 ${className}`}
      data-testid="chart-annotations"
    >
      {visible.map(({ e, pct }, i) => {
        const dotCls = `inline-block h-1.5 w-1.5 rounded-full ${TONE_BG[e.kind]} ring-1 ring-surface`
        return (
          <div
            key={`${e.occurred_at}-${i}`}
            className="absolute inset-y-0"
            style={{ left: `${pct}%`, transform: 'translateX(-50%)' }}
            data-kind={e.kind}
          >
            {variant === 'full' && (
              <div
                aria-hidden="true"
                className={`absolute top-0 bottom-0 left-1/2 -translate-x-1/2 border-l border-dashed ${TONE_BORDER[e.kind]} opacity-70`}
              />
            )}
            <Tooltip content={formatTooltip(e)}>
              {e.href ? (
                <a
                  href={e.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${e.kind} · ${e.label}`}
                  className={`pointer-events-auto absolute -translate-x-1/2 cursor-pointer ${
                    variant === 'full' ? 'top-[-3px]' : 'top-1/2 -translate-y-1/2'
                  } ${dotCls}`}
                />
              ) : (
                <span
                  role="img"
                  aria-label={`${e.kind} · ${e.label}`}
                  className={`pointer-events-auto absolute -translate-x-1/2 cursor-help ${
                    variant === 'full' ? 'top-[-3px]' : 'top-1/2 -translate-y-1/2'
                  } ${dotCls}`}
                />
              )}
            </Tooltip>
          </div>
        )
      })}
    </div>
  )
}
