/**
 * FILE: apps/admin/src/lib/useMotionTransition.ts
 * PURPOSE: Reduced-motion-aware Framer transition presets for micro-interactions.
 */

import { useReducedMotion } from 'framer-motion'
import {
  microLayoutTransition,
  microLayoutTransitionReduced,
} from './motion-tokens'

/** Sliding pill / layout animations — instant when user prefers reduced motion. */
export function useMotionTransition() {
  const reduceMotion = useReducedMotion()
  return reduceMotion ? microLayoutTransitionReduced : microLayoutTransition
}
