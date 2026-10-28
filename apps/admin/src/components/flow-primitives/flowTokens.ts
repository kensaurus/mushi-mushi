/**
 * FILE: apps/admin/src/components/flow-primitives/flowTokens.ts
 * PURPOSE: Central source of truth for per-stage colours used inside React
 *          Flow canvases (PDCA loop + FixAttemptFlow). SVG `stop-color`
 *          attributes and inline `style.stroke` need concrete values —
 *          CSS custom properties don't always resolve inside SVG `defs`
 *          across browsers. Values are read from @theme static viz tokens
 *          on access, because this module loads before index.css.
 */

import type { PdcaStageId } from '../../lib/pdca'
import { vizColorMap } from '../../lib/vizTokens'

export const STAGE_HEX: Record<PdcaStageId, string> = vizColorMap<PdcaStageId>({
  plan: 'viz-flow-info',
  do: 'viz-flow-brand',
  check: 'viz-score-warn',
  act: 'viz-score-ok',
})

export const TONE_HEX = vizColorMap({
  ok: 'viz-score-ok',
  warn: 'viz-score-warn',
  urgent: 'viz-flow-danger',
})
