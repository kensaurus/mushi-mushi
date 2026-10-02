/**
 * Central registry for layout chrome layers — avoids stacking duplicate
 * loop surfaces (Snapshot + PdcaFlow + guides) on the same route.
 */

import { hasPageOwnedHero, shouldSkipLayoutHero } from './pageHeroOwnership'
import { shouldShowPipelineRibbon } from './pipelineRibbonVisibility'

/** Layout-injected PageHero fallback — off when the page owns loop chrome. */
export function shouldShowLayoutPageHero(pathname: string, postureHasStatusBanner = false): boolean {
  if (postureHasStatusBanner) return false
  return !shouldSkipLayoutHero(pathname)
}

/** Workspace pipeline ribbon starts collapsed so page-level loop UI wins. */
export function shouldDefaultCollapsePipelineRibbon(pathname: string): boolean {
  return pathname === '/dashboard'
}

/**
 * Coachmark explains Workspace pipeline vs page hero, so it only makes sense
 * where the pipeline ribbon actually renders (advanced mode, ribbon routes)
 * next to a page-owned hero. Obsolete on Dashboard, where PdcaFlow is the
 * primary loop surface.
 */
export function shouldShowDavCoachmark(pathname: string, ribbonVisible = shouldShowPipelineRibbon(pathname)): boolean {
  if (pathname === '/dashboard') return false
  if (!ribbonVisible) return false
  return hasPageOwnedHero(pathname)
}
