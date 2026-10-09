/**
 * Global posture strip visibility — the NextStep banner (Quick/Beginner) and
 * PipelineStatusRibbon (advanced) are mutually exclusive by admin mode.
 * Import these in Layout so the contract stays explicit.
 */

import { shouldShowPipelineRibbon } from './pipelineRibbonVisibility'

/** Advanced: workspace P→D→C→A ribbon on hub routes only. */
export function shouldShowPipelineRibbonChrome(isAdvanced: boolean, pathname: string): boolean {
  return isAdvanced && shouldShowPipelineRibbon(pathname)
}

/** Documented invariant: the two posture strips never render together. */
export function postureStripsAreMutuallyExclusive(isBeginner: boolean, isAdvanced: boolean): boolean {
  return !(isBeginner && isAdvanced)
}
