/**
 * FILE: apps/admin/src/components/signal/scale.ts
 * PURPOSE: Map a number to a validated colour step (2026-11-18, moved from lib/ciWeek.ts so
 *          every page grades cells the same way). The classes (`ci-heat-*`, `ci-fail-*`,
 *          `ci-divr-*`/`ci-divb-*`, `ci-mid`, `ci-cell-0`, `ci-nodata`) live in
 *          styles/components.css and take their colours from the ramps in theme-tokens.css,
 *          with black text on the light steps and white on the dark ones (all ≥ 4.5:1).
 *
 * Ramps: teal = volume / time (darker = more), red = failure / badness (darker = worse),
 * diverging = against a target (red below, blue above, grey on target).
 */

export type HeatScale = 'heat' | 'fail'

/** The heat class for a count on a 0..max scale: `ci-cell-0` for none, `ci-heat-1..6` above. */
export function heatClass(value: number | null, max: number, steps = 6, prefix = 'ci-heat'): string {
  if (value == null) return 'ci-nodata'
  if (value <= 0 || max <= 0) return 'ci-cell-0'
  return `${prefix}-${Math.min(steps, Math.max(1, Math.ceil((value / max) * steps)))}`
}

/** The diverging class for a rate against `target`: grey within 1.5 points, then 5-point steps. */
export function divergeClass(rate: number | null, target: number): string {
  if (rate == null) return 'ci-nodata'
  const d = (rate - target) * 100
  if (Math.abs(d) < 1.5) return 'ci-mid'
  const step = Math.min(4, Math.floor(Math.abs(d) / 5) + 1)
  return `${d > 0 ? 'ci-divb' : 'ci-divr'}-${step}`
}

/** The failure-rate class: none for 0, then five steps up to `top` (default 40%). */
export function failClass(rate: number | null, top = 0.4): string {
  if (rate == null) return ''
  if (rate <= 0) return 'ci-cell-0'
  return `ci-fail-${Math.min(5, Math.max(1, Math.ceil((rate / top) * 5)))}`
}

/**
 * A "badness" class on the red ramp for any count against a ceiling: 0 → neutral, then five
 * steps up to `top`. Use it for open bugs, stale days, behind-by counts: anything where more
 * is worse and the colour should say so.
 */
export function badnessClass(value: number | null, top: number): string {
  if (value == null) return 'ci-nodata'
  if (value <= 0 || top <= 0) return 'ci-cell-0'
  return `ci-fail-${Math.min(5, Math.max(1, Math.ceil((value / top) * 5)))}`
}
