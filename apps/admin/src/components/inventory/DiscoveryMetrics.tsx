import type { ReactNode } from 'react'

/**
 * Hero metric tiles for the Discovery tab.
 *
 * Replaces the row of monochromatic info-tinted badges with a 4-up
 * grid of large, semantically-coloured tiles. Each tile is a
 * "category" in the squint-test sense — the user should be able to
 * tell `events` from `routes` from `users` from `freshness` by hue
 * alone.
 *
 * Domain tier note: mushi-mushi is a Tier C product (productive
 * dev-tool, like Linear / Vercel). We stay in `/15–/25` tints — not
 * the `/30+` saturation a learning app would use — and we *only*
 * colour the value + the icon chip. The tile body stays neutral.
 */
export type MetricTone = 'brand' | 'info' | 'ok' | 'warn' | 'neutral'

export interface DiscoveryMetric {
  id: string
  /** Short capitalised label e.g. "Routes seen". */
  label: string
  /** The headline number / short value (e.g. "12", "2m ago"). */
  value: string | number
  /** Optional secondary text under the value (e.g. "+3 today"). */
  detail?: string
  tone: MetricTone
  icon: ReactNode
}

interface Props {
  metrics: DiscoveryMetric[]
}

const TONES: Record<
  MetricTone,
  { wrap: string; iconWrap: string; value: string; chip: string }
> = {
  brand: {
    wrap: 'ring-1 ring-brand/25 bg-brand/[0.04]',
    iconWrap: 'bg-brand/15 text-brand ring-1 ring-brand/30',
    value: 'text-brand',
    chip: 'text-brand',
  },
  info: {
    wrap: 'ring-1 ring-info/25 bg-info-muted/12',
    iconWrap: 'bg-info-muted/40 text-info ring-1 ring-info/30',
    value: 'text-info',
    chip: 'text-info',
  },
  ok: {
    wrap: 'ring-1 ring-ok/25 bg-ok-muted/10',
    iconWrap: 'bg-ok-muted/40 text-ok ring-1 ring-ok/30',
    value: 'text-ok',
    chip: 'text-ok',
  },
  warn: {
    wrap: 'ring-1 ring-warn/25 bg-warn-muted/12',
    iconWrap: 'bg-warn-muted/40 text-warn ring-1 ring-warn/30',
    value: 'text-warn',
    chip: 'text-warn',
  },
  neutral: {
    wrap: 'ring-1 ring-edge-subtle bg-surface-overlay/40',
    iconWrap: 'bg-surface-overlay text-fg-faint ring-1 ring-edge-subtle',
    value: 'text-fg',
    chip: 'text-fg-muted',
  },
}

export function DiscoveryMetrics({ metrics }: Props) {
  return (
    <div
      role="list"
      aria-label="Discovery metrics"
      className="grid grid-cols-2 lg:grid-cols-4 gap-2"
    >
      {metrics.map((m) => {
        const t = TONES[m.tone]
        return (
          <article
            key={m.id}
            role="listitem"
            className={`flex items-start gap-3 p-3 rounded-lg ${t.wrap}`}
          >
            <div
              className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${t.iconWrap}`}
              aria-hidden
            >
              {m.icon}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-2xs uppercase tracking-wider text-fg-faint">
                {m.label}
              </p>
              <p
                className={`mt-0.5 text-2xl font-semibold tabular-nums leading-none ${t.value}`}
              >
                {m.value}
              </p>
              {m.detail && (
                <p className={`mt-1 text-2xs ${t.chip} truncate`}>{m.detail}</p>
              )}
            </div>
          </article>
        )
      })}
    </div>
  )
}
