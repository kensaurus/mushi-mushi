/**
 * FILE: MetricStrip.tsx
 * PURPOSE: Unified KPI strip wrapper — grid layout, max 7 tiles, group semantics.
 */

import { Children, cloneElement, isValidElement, type CSSProperties, type ReactNode } from 'react'
import { useStaggeredAppear } from '../lib/useStaggeredAppear'

const COLS_CLASS: Record<3 | 4 | 5 | 6 | 7, string> = {
  3: 'grid-cols-2 md:grid-cols-3',
  4: 'grid-cols-2 md:grid-cols-4',
  5: 'grid-cols-2 md:grid-cols-3 lg:grid-cols-5',
  6: 'grid-cols-2 md:grid-cols-3 lg:grid-cols-6',
  7: 'grid-cols-2 md:grid-cols-4 lg:grid-cols-7',
}

export interface MetricStripProps {
  children: ReactNode
  /** Grid column count at lg breakpoint. Capped at 7 per dashboard IA guidance. */
  cols?: 3 | 4 | 5 | 6 | 7
  /** Accessible name for the KPI group. */
  ariaLabel?: string
  className?: string
  /** Staggered fade-in for child tiles (dashboard / reports KPI rows). */
  stagger?: boolean
}

/**
 * Canonical wrapper for KPI / metric tile rows. Replaces ad-hoc grid divs
 * across Dashboard, Reports, DLQ, and Fixes snapshot surfaces.
 */
export function MetricStrip({
  children,
  cols = 4,
  ariaLabel = 'Key metrics',
  className = '',
  stagger = false,
}: MetricStripProps) {
  const safeCols = Math.min(7, Math.max(3, cols)) as 3 | 4 | 5 | 6 | 7
  const staggerStyle = useStaggeredAppear({ stepMs: 40, max: 8 })
  const body = stagger
    ? Children.map(children, (child, i) => {
        if (!isValidElement(child)) return child
        const prev = (child.props as { className?: string }).className ?? ''
        return cloneElement(child, {
          style: { ...staggerStyle(i), ...(child.props as { style?: CSSProperties }).style },
          className: `${prev} motion-safe:animate-mushi-fade-in`.trim(),
        } as Record<string, unknown>)
      })
    : children

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={`grid ${COLS_CLASS[safeCols]} gap-2 ${className}`}
    >
      {body}
    </div>
  )
}
