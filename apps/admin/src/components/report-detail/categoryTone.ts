/**
 * FILE: apps/admin/src/components/report-detail/categoryTone.ts
 * PURPOSE: Neutral chips for the bug page. The bug page draws a report's category (Bug, Slow, Visual…) as a
 *          neutral chip. lib/tokens CATEGORY_BADGE paints "bug" red, and the
 *          bug page showed that red "Bug" in four places although nothing
 *          had failed (R2 sweep 2026-11-18). Red stays for failures.
 */

import { CHIP_TONE } from '../../lib/chipTone'

export const CATEGORY_NEUTRAL = CHIP_TONE.neutral

/**
 * Classifier confidence as a chip: ink when it is high enough to act on,
 * amber (a warning: read the evidence first) when low, never red or green;
 * lib/tokens confidenceBadgeClass painted 55% red (R2 sweep 2026-11-18).
 * Same 0.65 line as the Bugs list (components/reports/reportMetricViz.ts).
 */
export function confidenceChipTone(confidence: number | null | undefined): string {
  if (confidence == null || confidence >= 0.65) return CHIP_TONE.neutral
  return CHIP_TONE.warn
}
