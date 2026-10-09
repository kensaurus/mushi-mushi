'use client'

/**
 * Light Motion enter for landing sections — opacity/y only.
 * Does not animate the same transforms GSAP pin chapters own.
 */
import { type ReactNode } from 'react'
import { motion } from 'motion/react'

import { usePrefersReducedMotion } from './use-prefers-reduced-motion'

interface ScrollRevealProps {
  children: ReactNode
  className?: string
}

export function ScrollReveal({ children, className }: ScrollRevealProps) {
  // Motion's own `useReducedMotion` reads matchMedia synchronously during
  // render, so it returns false on the server and true in the client's
  // hydration render for a reduce-motion user — and this component branches
  // its tree on it, which is React hydration error #418 on the landing page.
  // The local hook is `true` until mounted, so both sides agree.
  const reduced = usePrefersReducedMotion()

  if (reduced) {
    return <div className={className}>{children}</div>
  }

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -8% 0px' }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  )
}
