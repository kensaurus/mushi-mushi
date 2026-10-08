/**
 * Where the global Workspace pipeline ribbon (P→D→C→A) should appear.
 *
 * It belongs on the PDCA cockpit and loop hubs — not on every admin surface.
 * Configuration, billing, and workspace pages already carry their own
 * page-level heroes and KPI strips; stacking the workspace timeline there
 * reads as noise (NN/g #8 Minimalist Design).
 *
 * Only the two hubs keep it (owner review, 2026-10-08): on a single stage's
 * page (Reports, Fixes, Pull requests, Fix grading, Releases, Improvement
 * runs) it repeated the sidebar's stage badges above the page's own header.
 */

/** Exact paths where the workspace pipeline ribbon is meaningful. */
export const PIPELINE_RIBBON_ROUTES = new Set([
  '/dashboard',
  '/inbox',
])

export function shouldShowPipelineRibbon(pathname: string): boolean {
  return PIPELINE_RIBBON_ROUTES.has(pathname)
}
