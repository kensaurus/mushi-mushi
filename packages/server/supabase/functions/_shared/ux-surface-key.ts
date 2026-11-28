/**
 * FILE: packages/server/supabase/functions/_shared/ux-surface-key.ts
 * PURPOSE: The ux_surfaces.surface_key of a scorecard page (ADR 0067), with no
 *          imports. Its own file so the Timeline helpers (ux-timeline.ts),
 *          which release publish reaches from the `api` function, do not pull
 *          the scorecard rubric and zod into api's upload (deploy size budget,
 *          scripts/deploy-edge-function.test.mjs). ux-scorecard-io.ts
 *          re-exports it.
 */

/** Pure: a ux_surfaces.surface_key for a page key: lower-case slug, at most 120 characters, unique enough per run. */
export function scorecardSurfaceKey(pageKey: string): string {
  const slug = pageKey.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).join('-') || 'root'
  if (slug.length <= 110) return slug
  let h = 0
  for (const ch of pageKey) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return `${slug.slice(0, 100)}-${h.toString(36)}`
}
