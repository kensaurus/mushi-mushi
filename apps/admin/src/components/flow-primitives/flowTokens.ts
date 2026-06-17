/**
 * FILE: apps/admin/src/components/flow-primitives/flowTokens.ts
 * PURPOSE: Central source of truth for per-stage colours used inside React
 *          Flow canvases (PDCA loop + FixAttemptFlow). SVG `stop-color`
 *          attributes and inline `style.stroke` need concrete values —
 *          CSS custom properties don't always resolve inside SVG `defs`
 *          across browsers. Values are read from @theme viz-* tokens via
 *          `readVizToken()` so theme tweaks stay in index.css.
 */

import type { PdcaStageId } from '../../lib/pdca'
import { readVizToken } from '../../lib/vizTokens'

const STAGE_TOKEN: Record<PdcaStageId, string> = {
  plan: 'viz-flow-info',
  do: 'viz-flow-brand',
  check: 'viz-score-warn',
  act: 'viz-score-ok',
}

function softMix(token: string): string {
  return `color-mix(in oklch, ${readVizToken(token)} 28%, transparent)`
}

export const STAGE_HEX: Record<PdcaStageId, string> = {
  plan: readVizToken('viz-flow-info'),
  do: readVizToken('viz-flow-brand'),
  check: readVizToken('viz-score-warn'),
  act: readVizToken('viz-score-ok'),
}

export const STAGE_SOFT_HEX: Record<PdcaStageId, string> = {
  plan: softMix(STAGE_TOKEN.plan),
  do: softMix(STAGE_TOKEN.do),
  check: softMix(STAGE_TOKEN.check),
  act: softMix(STAGE_TOKEN.act),
}

export const TONE_HEX = {
  ok: readVizToken('viz-score-ok'),
  warn: readVizToken('viz-score-warn'),
  urgent: readVizToken('viz-flow-danger'),
} as const

export type FlowStageTone = keyof typeof TONE_HEX
