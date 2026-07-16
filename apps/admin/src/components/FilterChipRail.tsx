/**
 * FILE: apps/admin/src/components/FilterChipRail.tsx
 * PURPOSE: Horizontal filter chip row with sliding active indicator (Framer layoutId)
 *          + Auto-Animate for chip add/remove/reorder.
 */

import { useAutoAnimate } from '@formkit/auto-animate/react'
import { LayoutGroup, motion } from 'framer-motion'
import {
  createContext,
  useContext,
  type ReactElement,
  type ReactNode,
} from 'react'
import { useMotionTransition, usePrefersReducedMotion } from '../lib/useMotionTransition'
import { microTapScale } from '../lib/motion-tokens'

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
  const [animateParent] = useAutoAnimate({
    duration: 220,
    easing: 'ease-out',
  })

  return (
    <LayoutGroup id={trackId}>
      <FilterRailContext.Provider value={trackId}>
        <div
          ref={animateParent}
          className={`inline-flex flex-wrap items-center gap-1 ${className}`}
          role="group"
          aria-label={ariaLabel}
        >
          {children}
        </div>
      </FilterRailContext.Provider>
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
  const reduceMotion = usePrefersReducedMotion()

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
