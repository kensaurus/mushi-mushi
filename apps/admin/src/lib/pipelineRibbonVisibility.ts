/**
 * Where the global Workspace pipeline ribbon (P→D→C→A) should appear.
 *
 * It belongs on the PDCA cockpit and loop hubs — not on every admin surface.
 * Configuration, billing, and workspace pages already carry their own
 * page-level heroes and KPI strips; stacking the workspace timeline there
 * reads as noise (NN/g #8 Minimalist Design).
 */

/** Exact paths where the workspace pipeline ribbon is meaningful. */
export const PIPELINE_RIBBON_ROUTES = new Set([
  '/dashboard',
  '/reports',
  '/fixes',
  '/repo',
  '/judge',
  '/inbox',
  '/releases',
  '/iterate',
])

export function shouldShowPipelineRibbon(pathname: string): boolean {
  return PIPELINE_RIBBON_ROUTES.has(pathname)
}
