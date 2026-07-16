/**
 * FILE: apps/admin/src/components/cost/DailySpendChart.tsx
 * PURPOSE: LLM daily spend chart — headline stat + activity strip + framed bars.
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-2xs uppercase tracking-wider text-fg-muted">Today (UTC)</p>
          <p className="mt-0.5 text-2xl font-semibold tabular-nums text-brand">
            {fmtSpend(series.todayUsd)}
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
                {fmtSpend(series.totalUsd)} total
              </>
            )}
          </p>
        </div>

        <div className="min-w-0 sm:max-w-[55%]">
          <p className="mb-1.5 text-3xs uppercase tracking-wider text-fg-faint">
            Activity · last {series.days.length} days
          </p>
          <div
            className="flex items-center gap-1"
            role="img"
            aria-label={`${series.activeDays} days with LLM spend in the last ${series.days.length} days`}
          >
            {series.values.map((v, i) => {
              const isToday = i === series.values.length - 1
              const active = v > 0
              return (
                <span
                  key={series.days[i]}
                  title={`${xLabels[i]}: ${active ? fmtSpend(v) : 'no spend'}`}
                  className={`h-2 flex-1 max-w-[14px] rounded-sm motion-safe:transition-opacity ${
                    active
                      ? 'bg-brand/90'
                      : 'bg-fg-faint/15'
                  } ${isToday ? 'ring-1 ring-brand/50' : ''}`}
                />
              )
            })}
          </div>
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
