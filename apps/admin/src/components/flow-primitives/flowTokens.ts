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

export const STAGE_HEX: Record<PdcaStageId, string> = {
  plan: readVizToken('viz-flow-info'),
  do: readVizToken('viz-flow-brand'),
  check: readVizToken('viz-score-warn'),
  act: readVizToken('viz-score-ok'),
}

export const TONE_HEX = {
  ok: readVizToken('viz-score-ok'),
  warn: readVizToken('viz-score-warn'),
  urgent: readVizToken('viz-flow-danger'),
} as const
