/**
 * FILE: apps/admin/src/components/ui/page-status.tsx
 * PURPOSE: One "page status" block for the top of a page (pattern P1,
 *          console journeys 2026-10-27). Twenty pages opened on a strip of
 *          4–8 StatCard tiles: zeros, raw ratios, and an "Open page →" that
 *          usually jumped to a tab of the same page. A page now leads with:
 *
 *            - one plain-English sentence saying how things stand, and
 *            - at most three numbers that matter, each a link to the list
 *              it counts.
 *
 *          The metric list is typed to hold at most three. When every number
 *          is empty (0, "—", 0%), the numbers are dropped: with an `empty`
 *          card the page shows its one "do this first" step instead
 *          (PageFirstStep), otherwise just the sentence. A wall of zeros is
 *          never rendered.
 */

import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { statLinkLabel } from '../../lib/statCardLinks'
import { InfoHint } from './fields'
import { FreshnessPill, type SectionFreshness } from './layout'
import { PageFirstStep, type PageFirstStepProps } from './page-first-step'

export type PageStatusTone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral'

/** @public */
export interface PageStatusMetric {
  label: string
  value: number | string
  /** The list this number counts. Same-page tabs read "Show <tab>". */
  to?: string
  /** One plain sentence on what is counted; shown from an (i) beside the label. */
  hint?: string
  tone?: PageStatusTone
}

/** @public At most three numbers: a fourth is a type error, not a style choice. */
export type PageStatusMetrics =
  | readonly []
  | readonly [PageStatusMetric]
  | readonly [PageStatusMetric, PageStatusMetric]
  | readonly [PageStatusMetric, PageStatusMetric, PageStatusMetric]

export interface PageStatusProps {
  /** How things stand, in one plain sentence. */
  sentence: ReactNode
  tone?: PageStatusTone
  metrics?: PageStatusMetrics
  /** One button for the sentence's next step. */
  action?: ReactNode
  freshness?: SectionFreshness
  /** Rendered instead of the status when every number is empty. */
  empty?: PageFirstStepProps
  /** Accessible name for the block. */
  ariaLabel?: string
  'data-testid'?: string
}

const TONE_DOT: Record<PageStatusTone, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  danger: 'bg-danger',
  info: 'bg-info',
  neutral: 'bg-fg-faint',
}

const TONE_VALUE: Record<PageStatusTone, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  danger: 'text-danger',
  info: 'text-info',
  neutral: 'text-fg',
}

/** @internal Exported for tests only. 0, "0", "0%", "—", "-", "" and "n/a" carry no information on their own. */
export function isEmptyMetricValue(value: number | string | null | undefined): boolean {
  if (value == null) return true
  if (typeof value === 'number') return value === 0 || Number.isNaN(value)
  const v = value.trim().toLowerCase()
  return v === '' || v === '—' || v === '-' || v === 'n/a' || /^0+(\.0+)?\s*%?$/.test(v) || /^\$0+(\.0+)?$/.test(v)
}

export function PageStatus({
  sentence,
  tone = 'neutral',
  metrics = [],
  action,
  freshness,
  empty,
  ariaLabel = 'Page status',
  'data-testid': testId = 'page-status',
}: PageStatusProps) {
  const allEmpty = metrics.length > 0 && metrics.every((m) => isEmptyMetricValue(m.value))
  if (allEmpty && empty) return <PageFirstStep {...empty} />
  const shown = allEmpty ? [] : metrics

  return (
    <section
      aria-label={ariaLabel}
      data-testid={testId}
      className="w-full min-w-0 rounded-md border border-edge-subtle bg-surface-raised px-3 py-2.5"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <p className="flex min-w-0 flex-1 basis-64 items-start gap-2 text-sm leading-snug text-fg">
          <span aria-hidden="true" className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TONE_DOT[tone]}`} />
          <span className="min-w-0 text-pretty">{sentence}</span>
        </p>
        {freshness || action ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {freshness ? <FreshnessPill {...freshness} /> : null}
            {action}
          </div>
        ) : null}
      </div>
      {shown.length > 0 ? (
        <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-2 pl-4">
          {shown.map((m) => (
            <MetricItem key={m.label} metric={m} />
          ))}
        </dl>
      ) : null}
    </section>
  )
}

function MetricItem({ metric }: { metric: PageStatusMetric }) {
  const valueClass = `text-base font-semibold leading-tight tabular-nums ${TONE_VALUE[metric.tone ?? 'neutral']}`
  return (
    <div className="flex min-w-0 flex-col-reverse">
      <dt className="flex items-center gap-1 text-2xs text-fg-muted">
        <span className="truncate">{metric.label}</span>
        {metric.hint ? <InfoHint content={metric.hint} /> : null}
      </dt>
      <dd className="m-0">
        {metric.to ? <MetricLink metric={metric} to={metric.to} className={valueClass} /> : <span className={valueClass}>{metric.value}</span>}
      </dd>
    </div>
  )
}

function MetricLink({ metric, to, className }: { metric: PageStatusMetric; to: string; className: string }) {
  const { pathname, search } = useLocation()
  const linkText = statLinkLabel(to, `${pathname}${search}`)
  return (
    <Link
      to={to}
      aria-label={`${metric.value} ${metric.label} — ${linkText}`}
      title={linkText}
      className={`${className} rounded-sm underline decoration-edge decoration-1 underline-offset-4 hover:decoration-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50`}
    >
      {metric.value}
    </Link>
  )
}
