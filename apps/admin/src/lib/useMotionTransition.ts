/**
 * FILE: apps/admin/src/lib/useMotionTransition.ts
 * PURPOSE: Reduced-motion-aware Framer transition presets for micro-interactions.
 */

import { useReducedMotion } from 'framer-motion'
import type { Transition, Variants } from 'framer-motion'
import {
  microLayoutTransition,
  microLayoutTransitionReduced,
  instantDisclosureVariants,
  instantNavItemVariants,
  instantOverlayPanelVariants,
  instantOverlayVariants,
  drawerPanelVariants,
  instantDrawerPanelVariants,
  disclosureVariants,
  navItemVariants,
  overlayPanelVariants,
  overlayVariants,
} from './motion-tokens'

/** Sliding pill / layout animations — instant when user prefers reduced motion. */
export function useMotionTransition(preset: Transition = microLayoutTransition) {
  const reduceMotion = useReducedMotion()
  return reduceMotion ? microLayoutTransitionReduced : preset
}

/** Whether the user prefers reduced motion (Framer hook). */
export function usePrefersReducedMotion() {
  return useReducedMotion() ?? false
}

/** Disclosure accordion variants — instant open/close when reduced motion. */
export function useDisclosureVariants(): Variants {
  const reduceMotion = useReducedMotion()
  return reduceMotion ? instantDisclosureVariants : disclosureVariants
}

/** Staggered nav-link reveal variants. */
export function useNavItemVariants(): Variants {
  const reduceMotion = useReducedMotion()
  return reduceMotion ? instantNavItemVariants : navItemVariants
}

/** Modal / palette overlay variants. */
export function useOverlayVariants(): {
  backdrop: Variants
  panel: Variants
} {
  const reduceMotion = useReducedMotion()
  if (reduceMotion) {
    return { backdrop: instantOverlayVariants, panel: instantOverlayPanelVariants }
  }
  return { backdrop: overlayVariants, panel: overlayPanelVariants }
}

/** Drawer panel slide variants (right-anchored). */
export function useDrawerVariants(): Variants {
  const reduceMotion = useReducedMotion()
  return reduceMotion ? instantDrawerPanelVariants : drawerPanelVariants
}
