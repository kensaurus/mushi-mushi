/**
 * Global posture strip visibility — NextBestAction (beginner) and
 * PipelineStatusRibbon (advanced) are mutually exclusive by admin mode.
 * Import these in Layout so the contract stays explicit.
 */

import { shouldShowPipelineRibbon } from './pipelineRibbonVisibility'

/** Beginner/quickstart: single "what next" strip — never stack with workspace ribbon. */
export function shouldShowNextBestActionChrome(isBeginner: boolean, pathname: string): boolean {
  if (!isBeginner) return false
  if (pathname.startsWith('/login') || pathname.startsWith('/reset-password')) return false
  return true
}

/** Advanced: workspace P→D→C→A ribbon on hub routes only. */
export function shouldShowPipelineRibbonChrome(isAdvanced: boolean, pathname: string): boolean {
  return isAdvanced && shouldShowPipelineRibbon(pathname)
}

/** Documented invariant: the two posture strips never render together. */
export function postureStripsAreMutuallyExclusive(isBeginner: boolean, isAdvanced: boolean): boolean {
  return !(isBeginner && isAdvanced)
}
