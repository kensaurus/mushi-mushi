/**
 * FILE: apps/admin/src/components/motion/NavSectionStagger.tsx
 * PURPOSE: Stagger nav links when a sidebar section expands.
 */

import { motion } from 'framer-motion'
import { Children, isValidElement, type ReactNode } from 'react'
import { navItemStaggerStep, sectionExpandSpring } from '../../lib/motion-tokens'
import { useMotionTransition, useNavItemVariants } from '../../lib/useMotionTransition'

const MAX_STAGGER_ITEMS = 12

export interface NavSectionStaggerProps {
  children: ReactNode
  /** When false, render children without motion wrappers. */
  animate?: boolean
  className?: string
}

export function NavSectionStagger({
  children,
  animate = true,
  className = '',
}: NavSectionStaggerProps) {
  const itemVariants = useNavItemVariants()
  const transition = useMotionTransition(sectionExpandSpring)

  if (!animate) {
    return <div className={className}>{children}</div>
  }

  const items = Children.toArray(children).slice(0, MAX_STAGGER_ITEMS)

  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="visible"
      variants={{
        visible: {
          transition: {
            staggerChildren: navItemStaggerStep,
            delayChildren: 0.02,
          },
        },
        hidden: {},
      }}
    >
      {items.map((child, i) => {
        if (!isValidElement(child)) return child
        return (
          <motion.div key={child.key ?? `nav-stagger-${i}`} variants={itemVariants} transition={transition}>
            {child}
          </motion.div>
        )
      })}
    </motion.div>
  )
}
