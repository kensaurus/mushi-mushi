/**
 * FILE: apps/admin/src/components/charts/ChartFrame.tsx
 * PURPOSE: Y-axis, horizontal grid, and sparse X-axis labels for admin charts.
 */

import type { ReactNode } from 'react'
import { CHART_LOCALE, sparseXLabels } from './chartAxis'
import { InlineProof } from '../report-detail/ReportSurface'

export interface ChartFrameProps {
  children: ReactNode
  height: number
  /** Top → bottom tick labels (aligned to grid lines). */
  yTickLabels: string[]
  /** One label per data point (ISO or bucket name). Sparse rendering on X-axis. */
  xLabels?: string[]
  yAxisCaption?: string
  xAxisCaption?: string
  className?: string
}

export function ChartFrame({
  children,
  height,
  yTickLabels,
  xLabels,
  yAxisCaption,
  xAxisCaption,
  className = '',
}: ChartFrameProps) {
  const ticks = yTickLabels.length > 0 ? yTickLabels : ['0']
  const xSparse = xLabels?.length ? sparseXLabels(xLabels.map(shortenX)) : []

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {yAxisCaption && (
        <span className="text-3xs font-medium uppercase tracking-wider text-fg-muted">
          {yAxisCaption}
        </span>
      )}
      <div className="flex gap-2">
        <div className="flex shrink-0 flex-col border-r border-edge-subtle/80 pr-1.5" style={{ minWidth: '3rem' }}>
          <div
            className="flex flex-1 flex-col justify-between py-0.5 text-3xs font-mono tabular-nums text-fg-muted select-none"
            style={{ height: `${height}px` }}
            aria-hidden="true"
          >
            {ticks.map((label, i) => (
              <span key={`${label}-${i}`} className="leading-none text-right">
                {label}
              </span>
            ))}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div
            className="relative border-b border-edge-subtle/80 bg-surface-overlay/30 rounded-sm"
            style={{ height: `${height}px` }}
          >
            <div
              className="pointer-events-none absolute inset-0 flex flex-col justify-between px-0.5"
              aria-hidden="true"
            >
              {ticks.map((label, i) => (
                <div
                  key={`grid-${label}-${i}`}
                  className="border-t border-edge-subtle/70 w-full first:border-t-0"
                />
              ))}
            </div>
            <div className="relative z-[1] h-full px-0.5 pb-px">{children}</div>
          </div>

          {xLabels && xLabels.length > 0 && (
            <div className="relative mt-1.5 h-5 border-t border-transparent">
              {xSparse.map(({ text, index }) => {
                const pct =
                  xLabels.length <= 1 ? 0 : (index / (xLabels.length - 1)) * 100
                return (
                  <span
                    key={`${text}-${index}`}
                    className="absolute flex flex-col items-center -translate-x-1/2"
                    style={{ left: `${pct}%` }}
                  >
                    <span
                      className="mb-0.5 h-1.5 w-px bg-edge-subtle"
                      aria-hidden="true"
                    />
                    <span className="text-3xs font-mono text-fg-muted tabular-nums whitespace-nowrap">
                      {text}
                    </span>
                  </span>
                )
              })}
            </div>
          )}

          {xAxisCaption && (
            <InlineProof className="mt-1 text-center border-0 bg-transparent px-0 py-0 text-3xs">
              {xAxisCaption}
            </InlineProof>
          )}
        </div>
      </div>
    </div>
  )
}

function shortenX(label: string): string {
  if (/^\d{4}-\d{2}-\d{2}/.test(label)) {
    const d = new Date(`${label.slice(0, 10)}T00:00:00Z`)
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString(CHART_LOCALE, {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      })
    }
  }
  return label
}
