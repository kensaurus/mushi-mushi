// mushi-ui: intentional overlay — not Modal/Drawer (reason: low-level Framer Motion backdrop shell consumed by Modal and CommandPalette)
/**
 * FILE: apps/admin/src/components/motion/MotionOverlay.tsx
 * PURPOSE: AnimatePresence overlay shell for modals and command palette.
 */

import { AnimatePresence, motion } from 'framer-motion'
import type { MouseEvent, ReactNode } from 'react'
import { overlayTween } from '../../lib/motion-tokens'
import { useMotionTransition, useOverlayVariants } from '../../lib/useMotionTransition'

export interface MotionOverlayProps {
  open: boolean
  children: ReactNode
  className?: string
  onBackdropClick?: (e: MouseEvent<HTMLDivElement>) => void
  role?: string
  'aria-modal'?: boolean | 'true' | 'false'
  'aria-label'?: string
}

export function MotionOverlay({
  open,
  children,
  className = '',
  onBackdropClick,
  role,
  'aria-modal': ariaModal,
  'aria-label': ariaLabel,
}: MotionOverlayProps) {
  const { backdrop } = useOverlayVariants()
  const transition = useMotionTransition(overlayTween)

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="motion-overlay"
          role={role}
          aria-modal={ariaModal}
          aria-label={ariaLabel}
          className={className}
          onClick={onBackdropClick}
          initial="hidden"
          animate="visible"
          exit="hidden"
          variants={backdrop}
          transition={transition}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

export interface MotionOverlayPanelProps {
  children: ReactNode
  className?: string
  onClick?: (e: MouseEvent<HTMLDivElement>) => void
  tabIndex?: number
}

export const MotionOverlayPanel = motion.div

/** Hook returning panel motion props for overlay children. */
export function useOverlayPanelMotion() {
  const { panel } = useOverlayVariants()
  const transition = useMotionTransition(overlayTween)
  return {
    variants: panel,
    transition,
    initial: 'hidden' as const,
    animate: 'visible' as const,
    exit: 'hidden' as const,
  }
}
