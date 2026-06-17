/**
 * FILE: apps/admin/src/lib/motion-tokens.ts
 * PURPOSE: Shared Framer Motion transition presets for micro-interactions.
 */

import type { Transition } from 'framer-motion'

/** Sliding segmented-control pill — snappy, no overshoot. */
export const microLayoutTransition: Transition = {
  type: 'spring',
  stiffness: 520,
  damping: 38,
  mass: 0.85,
}

/** Instant snap when reduced motion is preferred. */
export const microLayoutTransitionReduced: Transition = {
  duration: 0,
}

/** Segment press feedback (paired with CSS :active fallback). */
export const microTapScale = 0.96
