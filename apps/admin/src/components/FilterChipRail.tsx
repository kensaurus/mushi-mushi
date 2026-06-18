/**
 * FILE: apps/admin/src/components/FilterChipRail.tsx
 * PURPOSE: Horizontal filter chip row with sliding active indicator (Framer layoutId).
 */

import { LayoutGroup, motion } from 'framer-motion'
import {
  createContext,
  useContext,
  type ReactElement,
  type ReactNode,
} from 'react'
import { useMotionTransition } from '../lib/useMotionTransition'
import { microTapScale } from '../lib/motion-tokens'
import { useReducedMotion } from 'framer-motion'

const FilterRailContext = createContext<string>('')

export function FilterChipRail({
  trackId,
  className = '',
  children,
  'aria-label': ariaLabel,
}: {
  trackId: string
  className?: string
  children: ReactNode
  'aria-label'?: string
}) {
  return (
    <LayoutGroup id={trackId}>
      <div
        className={`inline-flex flex-wrap items-center gap-1 ${className}`}
        role="group"
        aria-label={ariaLabel}
      >
        <FilterRailContext.Provider value={trackId}>{children}</FilterRailContext.Provider>
      </div>
    </LayoutGroup>
  )
}

/**
 * Wrap each `FilterChip` so the active chip gets a shared sliding pill.
 * Child must be a single `FilterChip` element.
 */
export function FilterChipCell({
  active,
  children,
}: {
  active: boolean
  children: ReactElement
}) {
  const trackId = useContext(FilterRailContext)
  const layoutTransition = useMotionTransition()
  const reduceMotion = useReducedMotion()

  return (
    <div className="relative pb-0.5">
      {active && trackId ? (
        <motion.div
          layoutId={`filter-ind-${trackId}`}
          className="pointer-events-none absolute bottom-0 left-1 right-1 h-0.5 rounded-full bg-brand"
          transition={layoutTransition}
          initial={false}
          aria-hidden
        />
      ) : null}
      <motion.div
        className="relative"
        whileTap={reduceMotion ? undefined : { scale: microTapScale }}
      >
        {children}
      </motion.div>
    </div>
  )
}
