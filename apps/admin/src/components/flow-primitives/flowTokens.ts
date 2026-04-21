/**
 * FILE: apps/admin/src/components/flow-primitives/flowTokens.ts
 * PURPOSE: Central source of truth for per-stage colours used inside React
 *          Flow canvases (PDCA loop + FixAttemptFlow). SVG `stop-color`
 *          attributes and inline `style.stroke` need concrete hex/hsl values
 *          — CSS custom properties don't always resolve inside SVG `defs`
 *          across browsers. We keep the hex table here so a theme tweak only
 *          touches one file and every flow-related node/edge stays in lock-
 *          step with the design tokens in `index.css`.
 */

import type { PdcaStageId } from '../../lib/pdca'

export const STAGE_HEX: Record<PdcaStageId, string> = {
  plan: '#60a5fa',   // info / blue
  do: '#f5b544',     // brand / amber
  check: '#fbbf24',  // warn / gold
  act: '#34d399',    // ok / emerald
}

export const STAGE_SOFT_HEX: Record<PdcaStageId, string> = {
  plan: 'rgba(96, 165, 250, 0.28)',
  do: 'rgba(245, 181, 68, 0.28)',
  check: 'rgba(251, 191, 36, 0.28)',
  act: 'rgba(52, 211, 153, 0.28)',
}

export const TONE_HEX = {
  ok: '#34d399',
  warn: '#fbbf24',
  urgent: '#ef4444',
} as const

export type FlowStageTone = keyof typeof TONE_HEX
