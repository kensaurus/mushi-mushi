/**
 * FILE: apps/admin/src/lib/motion-tokens.ts
 * PURPOSE: Shared Framer Motion transition presets for micro-interactions.
 */

import type { Transition, Variants } from 'framer-motion'

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

/** Banner / KPI tile entrance — quick settle. */
export const bannerEnterSpring: Transition = {
  type: 'spring',
  stiffness: 500,
  damping: 38,
  mass: 0.75,
}

/** Alias — PagePosture rows, status banners, chrome enter. */
export const chromeEnterSpring = bannerEnterSpring

/** Sidebar category accordion — grid 0fr→1fr disclosure. */
export const sectionExpandSpring: Transition = {
  type: 'spring',
  stiffness: 480,
  damping: 40,
  mass: 0.85,
}

/** Optional shell width rail ↔ expanded (Layout aside). */
export const shellWidthSpring: Transition = {
  type: 'spring',
  stiffness: 400,
  damping: 42,
  mass: 0.9,
}

/** Modal / command palette scrim + panel. */
export const overlayTween: Transition = {
  type: 'tween',
  duration: 0.22,
  ease: [0.16, 1, 0.3, 1],
}

/** Per-item delay inside expanded nav sections (cap at 12 in consumers). */
export const navItemStaggerStep = 0.03

/** Grid-row disclosure variants (pair with AnimatedDisclosure). */
export const disclosureVariants: Variants = {
  collapsed: {
    gridTemplateRows: '0fr',
    opacity: 0,
  },
  expanded: {
    gridTemplateRows: '1fr',
    opacity: 1,
  },
}

/** Nav link reveal inside an expanded section. */
export const navItemVariants: Variants = {
  hidden: { opacity: 0, x: 4 },
  visible: { opacity: 1, x: 0 },
}

/** Overlay enter/exit for modals and drawers. */
export const overlayVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
}

export const overlayPanelVariants: Variants = {
  hidden: { opacity: 0, scale: 0.97, y: 8 },
  visible: { opacity: 1, scale: 1, y: 0 },
}

/** Instant variants when reduced motion is preferred. */
export const instantDisclosureVariants: Variants = {
  collapsed: { gridTemplateRows: '1fr', opacity: 1 },
  expanded: { gridTemplateRows: '1fr', opacity: 1 },
}

export const instantNavItemVariants: Variants = {
  hidden: { opacity: 1, x: 0 },
  visible: { opacity: 1, x: 0 },
}

export const instantOverlayVariants: Variants = {
  hidden: { opacity: 1 },
  visible: { opacity: 1 },
}

export const instantOverlayPanelVariants: Variants = {
  hidden: { opacity: 1, scale: 1, y: 0 },
  visible: { opacity: 1, scale: 1, y: 0 },
}

/** Right-anchored drawer panel slide. */
export const drawerPanelVariants: Variants = {
  hidden: { x: '100%' },
  visible: { x: 0 },
}

export const instantDrawerPanelVariants: Variants = {
  hidden: { x: 0 },
  visible: { x: 0 },
}
