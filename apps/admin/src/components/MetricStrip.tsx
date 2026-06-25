/**
 * FILE: MetricStrip.tsx
 * PURPOSE: Unified KPI strip wrapper — grid layout, max 7 tiles, group semantics.
 */

import { Children, isValidElement, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { bannerEnterSpring } from '../lib/motion-tokens'
import { useMotionTransition } from '../lib/useMotionTransition'

const COLS_CLASS: Record<3 | 4 | 5 | 6 | 7, string> = {
  3: 'grid-cols-2 sm:grid-cols-3',
  /** Equal quarters from md+ so four KPI sparklines stay on one row. */
  4: 'grid-cols-2 md:grid-cols-4',
  5: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5',
  6: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6',
  7: 'grid-cols-2 sm:grid-cols-4 lg:grid-cols-7',
}

export interface MetricStripProps {
  children: ReactNode
  /** Grid column count at lg breakpoint. Capped at 7 per dashboard IA guidance. */
  cols?: 3 | 4 | 5 | 6 | 7
  /** Accessible name for the KPI group. */
  ariaLabel?: string
  className?: string
  /** Staggered spring entrance for child tiles (dashboard / reports KPI rows). */
  stagger?: boolean
  /** Wrap metrics in a single bordered panel (Supabase diet dashboard). */
  panel?: boolean
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
  panel = false,
}: MetricStripProps) {
  const safeCols = Math.min(7, Math.max(3, cols)) as 3 | 4 | 5 | 6 | 7
  const tileTransition = useMotionTransition(bannerEnterSpring)
  const body = stagger
    ? Children.map(children, (child, i) => {
        if (!isValidElement(child)) return child
        const idx = Math.max(0, Math.min(i, 7))
        return (
          <motion.div
            key={child.key ?? `metric-${i}`}
            className="min-w-0 w-full h-full"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...tileTransition, delay: idx * 0.04 }}
          >
            {child}
          </motion.div>
        )
      })
    : children

  return (
    <div className={panel ? `panel panel--metrics ${className}`.trim() : className}>
      <div
        role="group"
        aria-label={ariaLabel}
        className={`grid ${COLS_CLASS[safeCols]} ${panel ? 'gap-0' : 'gap-2 sm:gap-2.5'} [&>*]:min-w-0`}
      >
        {body}
      </div>
    </div>
  )
}
