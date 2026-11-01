/**
 * FILE: apps/admin/src/components/flow-primitives/flowTokens.ts
 * PURPOSE: Central source of truth for per-stage colours used inside React
 *          Flow canvases (PDCA loop + FixAttemptFlow). SVG `stop-color`
 *          attributes and inline `style.stroke` need concrete values —
 *          CSS custom properties don't always resolve inside SVG `defs`
 *          across browsers. Getters read @theme viz-* tokens on access:
 *          this module is evaluated before main.tsx imports index.css, so a
 *          top-level read would freeze the stand-in colour.
 */

import type { PdcaStageId } from '../../lib/pdca'
import { readVizToken } from '../../lib/vizTokens'

export const STAGE_HEX: Record<PdcaStageId, string> = {
  get plan() { return readVizToken('viz-flow-info') },
  get do() { return readVizToken('viz-flow-brand') },
  get check() { return readVizToken('viz-score-warn') },
  get act() { return readVizToken('viz-score-ok') },
}

export const TONE_HEX = {
  get ok() { return readVizToken('viz-score-ok') },
  get warn() { return readVizToken('viz-score-warn') },
  get urgent() { return readVizToken('viz-flow-danger') },
}
