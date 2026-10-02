/**
 * FILE: apps/admin/src/components/design/ContrastTiles.tsx
 * PURPOSE: Declared foreground/background pairs as sample tiles: "Aa" in the
 *          fg colour on the bg colour (both from token data), the computed
 *          ratio, the required minimum and a pass/fail badge whose result is
 *          carried by shape and text as well as colour. `pass: null` shows the
 *          server's `problem` instead of a verdict.
 */

import { Badge } from '../ui'
import type { ContrastPairResult } from '../../lib/recipeTypes'
import { RecipeStateGlyph } from '../recipe/RecipeStateChip'
import { formatRatio } from './designTokens'

function Verdict({ pair }: { pair: ContrastPairResult }) {
  if (pair.pass === true) {
    return (
      <Badge tone="okSubtle" className="gap-1">
        <RecipeStateGlyph glyph="check" />
        <span data-verdict="pass">Pass</span>
      </Badge>
    )
  }
  if (pair.pass === false) {
    return (
      <Badge tone="dangerSubtle" className="gap-1">
        <RecipeStateGlyph glyph="cross" />
        <span data-verdict="fail">Fail</span>
      </Badge>
    )
  }
  return (
    <Badge tone="neutral" className="gap-1">
      <RecipeStateGlyph glyph="question" />
      <span data-verdict="unknown">Not judged</span>
    </Badge>
  )
}

export function ContrastTiles({ pairs }: { pairs: ContrastPairResult[] }) {
  if (pairs.length === 0) {
    return (
      <p className="text-xs text-fg-muted">
        No contrast pairs declared. Add fg/bg pairs to mushi.recipe.json to have Mushi check them.
      </p>
    )
  }
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {pairs.map((p, i) => (
        <li
          key={`${p.fg}|${p.bg}|${i}`}
          className="flex flex-col gap-2 rounded-md border border-edge-subtle p-2"
          data-testid="contrast-tile"
        >
          {p.fgHex && p.bgHex ? (
            <span
              className="flex h-16 items-center justify-center rounded-sm border border-edge-subtle text-2xl font-semibold"
              style={{ color: p.fgHex, background: p.bgHex }}
              role="img"
              aria-label={`Sample: ${p.fg} on ${p.bg}`}
            >
              Aa
            </span>
          ) : (
            <span className="flex h-16 items-center justify-center rounded-sm border border-dashed border-edge text-2xs text-fg-faint">
              No sample — a colour did not resolve
            </span>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-sm font-semibold tabular-nums text-fg" data-testid="contrast-ratio">
              {formatRatio(p.ratio)}
            </span>
            <Verdict pair={p} />
          </div>
          <span className="text-2xs text-fg-muted">Needs at least {p.min}:1{p.use ? ` · ${p.use}` : ''}</span>
          <span className="flex flex-col gap-0.5 font-mono text-2xs text-fg-secondary">
            <span className="wrap-break-word">fg {p.fg}{p.fgHex ? ` (${p.fgHex})` : ''}</span>
            <span className="wrap-break-word">bg {p.bg}{p.bgHex ? ` (${p.bgHex})` : ''}</span>
          </span>
          {p.pass === null && p.problem && <span className="text-2xs text-fg-secondary">Why: {p.problem}</span>}
        </li>
      ))}
    </ul>
  )
}
