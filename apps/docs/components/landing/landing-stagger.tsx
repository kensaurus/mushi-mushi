'use client'

/**
 * Shared once-in-view stagger for landing sections — opacity + transform only.
 * No scroll hijacking (see docs/MOTION.md).
 */
import { type ReactNode } from 'react'
import { motion, useReducedMotion, type Variants } from 'motion/react'

const STAMP_EASE = [0.22, 1, 0.36, 1] as const

export const landingRevealContainer: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.07 },
  },
}

export const landingRevealItem: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: STAMP_EASE },
  },
}

export const landingStampVariants: Variants = {
  hidden: { opacity: 0, scale: 1.6, rotate: -12 },
  visible: {
    opacity: 1,
    scale: 1,
    rotate: 0,
    transition: { duration: 0.55, ease: STAMP_EASE },
  },
}

interface LandingStaggerProps {
  children: ReactNode
  className?: string
  as?: 'div' | 'section'
  /** Passed to the root element (e.g. aria-labelledby). */
  rootProps?: Record<string, string | undefined>
}

/** Stagger children that are wrapped in `LandingStaggerItem`. */
export function LandingStagger({
  children,
  className,
  as = 'div',
  rootProps,
}: LandingStaggerProps) {
  const reduced = useReducedMotion()
  const Comp = as === 'section' ? motion.section : motion.div

  if (reduced) {
    const Static = as
    return (
      <Static className={className} {...rootProps}>
        {children}
      </Static>
    )
  }

  return (
    <Comp
      className={className}
      variants={landingRevealContainer}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: '0px 0px -8% 0px' }}
      {...rootProps}
    >
      {children}
    </Comp>
  )
}

export function LandingStaggerItem({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  const reduced = useReducedMotion()
  if (reduced) return <div className={className}>{children}</div>
  return (
    <motion.div className={className} variants={landingRevealItem}>
      {children}
    </motion.div>
  )
}
