/**
 * FILE: apps/admin/src/components/providers/MotionProvider.tsx
 * PURPOSE: App-wide Framer MotionConfig — respects prefers-reduced-motion.
 */

import { MotionConfig } from 'framer-motion'
import type { ReactNode } from 'react'

export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      {children}
    </MotionConfig>
  )
}
