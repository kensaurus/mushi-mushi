/**
 * FILE: apps/admin/src/components/cost/DailySpendChart.tsx
 * PURPOSE: LLM daily spend chart — headline stat + framed bars.
 *          Tuned for sparse projects (one active day in a 14d window).
 */

import { BarSparkline, LegendDot } from '../charts'
import type { DailySpendSeries } from './dailySpendSeries'
import { formatShortDay } from './dailySpendSeries'

interface Props {
  series: DailySpendSeries
  barTitles: string[]
  fmtSpend: (n: number) => string
}

export function DailySpendChart({ series, barTitles, fmtSpend }: Props) {
  const idleDays = series.days.length - series.activeDays
  const xLabels = series.days.map((d) => formatShortDay(d) ?? d)

  return (
    <div className="space-y-4">
      {/* The "Activity · last 14 days" dot strip is gone: it drew the bars
          below a second time, and at 390 the peak label sat on it
          (review 2026-11-18). Each bar has its day and amount as a title. */}
      <div>
        {/* Today's spend is the summary's "24h spend": the chart heads with its own window's
            total, labelled, so it never reads as a second "total logged" (2026-11-19). */}
        <div className="min-w-0">
          <p className="text-2xs text-fg-secondary font-semibold">{series.days.length}-day total</p>
          <p className="mt-0.5 text-2xl font-semibold tabular-nums text-brand">
            {fmtSpend(series.totalUsd)}
          </p>
          <p className="mt-1 text-2xs text-fg-muted">
            {series.activeDays === 1 ? (
              <>
                <span className="text-fg-secondary">1 active day</span>
                <span aria-hidden="true" className="mx-1">·</span>
                {idleDays} idle in this window
              </>
            ) : (
              <>
                <span className="text-fg-secondary">
                  {series.activeDays} active days
                </span>
                <span aria-hidden="true" className="mx-1">·</span>
                {idleDays} idle
              </>
            )}
          </p>
        </div>
      </div>

      <BarSparkline
        values={series.values}
        xLabels={xLabels}
        barTitles={barTitles}
        height={88}
        accent="bg-brand"
        scaleToData
        showAxes
        valueFormat="usd"
        showBarLabels={series.activeDays <= 3}
        showPeakLabel={series.activeDays > 1}
        ariaLabel={`LLM spend per day, last ${series.days.length} days`}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-edge-subtle/60 pt-3">
        <div className="flex flex-wrap gap-3 text-3xs text-fg-muted">
          <LegendDot color="bg-brand/90" label="Spend" />
          <LegendDot color="bg-fg-faint/30" label="No spend" />
        </div>
        {series.activeDays === 1 && (
          <p className="text-2xs text-fg-muted">
            Run classify, fix, or release agents to fill earlier days.
          </p>
        )}
      </div>
    </div>
  )
}
