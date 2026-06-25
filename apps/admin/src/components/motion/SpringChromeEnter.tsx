/**
 * FILE: apps/admin/src/components/motion/SpringChromeEnter.tsx
 * PURPOSE: Spring entrance for chrome rows (PagePosture banners, status strips).
 */

import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { chromeEnterSpring } from '../../lib/motion-tokens'
import { useMotionTransition } from '../../lib/useMotionTransition'

export interface SpringChromeEnterProps {
  children: ReactNode
  className?: string
  /** Optional stagger delay in seconds. */
  delay?: number
}

export function SpringChromeEnter({
  children,
  delay = 0,
  className = '',
}: SpringChromeEnterProps) {
  const transition = useMotionTransition(chromeEnterSpring)

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...transition, delay }}
      className={className}
    >
      {children}
    </motion.div>
  )
}
