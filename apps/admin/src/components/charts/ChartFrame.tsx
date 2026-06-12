/**
 * FILE: apps/admin/src/components/charts/ChartFrame.tsx
 * PURPOSE: Y-axis, horizontal grid, and sparse X-axis labels for admin charts.
 */

import type { ReactNode } from 'react'
import { sparseXLabels } from './chartAxis'
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
  const xSparse = xLabels?.length ? sparseXLabels(xLabels) : []
  const xLast = xLabels ? xLabels.length - 1 : 0

  return (
    <div className={`flex w-full min-w-0 flex-col gap-1.5 ${className}`}>
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
            className="relative overflow-visible border-b border-edge-subtle/80 bg-surface-overlay/30 rounded-sm"
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
            <div className="relative z-[1] h-full w-full overflow-visible pb-px">{children}</div>
          </div>

          {xLabels && xLabels.length > 0 && (
            <div className="relative mt-1.5 h-6 border-t border-transparent">
              {xSparse.map(({ text, index, isToday }) => {
                const isFirst = index === 0
                const isEnd = index === xLast
                const pct =
                  xLabels.length <= 1 ? 0 : (index / (xLabels.length - 1)) * 100
                const alignClass = isFirst
                  ? 'left-0 items-start translate-x-0'
                  : isEnd
                    ? 'right-0 left-auto items-end translate-x-0'
                    : 'items-center -translate-x-1/2'
                return (
                  <span
                    key={`${text}-${index}`}
                    className={`absolute flex flex-col ${alignClass}`}
                    style={isEnd ? undefined : { left: `${pct}%` }}
                  >
                    <span
                      className="mb-0.5 h-1.5 w-px bg-edge-subtle"
                      aria-hidden="true"
                    />
                    <span
                      className={`text-3xs tabular-nums whitespace-nowrap ${
                        isToday
                          ? 'font-semibold text-brand'
                          : 'font-mono text-fg-muted'
                      }`}
                    >
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

