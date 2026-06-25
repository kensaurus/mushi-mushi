/**
 * FILE: apps/admin/src/components/motion/AnimatedDisclosure.tsx
 * PURPOSE: Accessible expand/collapse using grid 0fr→1fr (avoids height:auto spring clipping).
 */

import { AnimatePresence, motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { sectionExpandSpring } from '../../lib/motion-tokens'
import { useDisclosureVariants, useMotionTransition } from '../../lib/useMotionTransition'

export interface AnimatedDisclosureProps {
  open: boolean
  children: ReactNode
  /** Stable key for AnimatePresence when swapping sections. */
  contentKey?: string
  className?: string
}

export function AnimatedDisclosure({
  open,
  children,
  contentKey = 'disclosure',
  className = '',
}: AnimatedDisclosureProps) {
  const transition = useMotionTransition(sectionExpandSpring)
  const variants = useDisclosureVariants()

  return (
    <AnimatePresence initial={false} mode="sync">
      {open ? (
        <motion.div
          key={contentKey}
          initial={false}
          animate="expanded"
          exit="collapsed"
          variants={variants}
          transition={transition}
          style={{ display: 'grid', overflow: 'hidden' }}
          className={className}
        >
          <div className="min-h-0 overflow-hidden">{children}</div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
