/**
 * FILE: apps/admin/src/components/design/DesignAtAGlance.tsx
 * PURPOSE: The top of a set-up design page (console journeys 2026-10-27):
 *          your colours as swatches, and how far the code has drifted from
 *          your design over time (the deviance score, lower is better).
 *          The full catalogue, rules and findings stay below.
 */

import { Section } from '../ui'
import { MetricTimeline } from '../charts/MetricTimeline'
import type { DesignPlaneResponse, DesignToken } from '../../lib/recipeTypes'
import { swatchColor } from './designTokens'

const MAX_SWATCHES = 24

/** @internal Exported for tests only. Colour tokens with a drawable colour, up to the cap. */
export function swatchTokens(tokens: readonly DesignToken[], max = MAX_SWATCHES): Array<{ path: string; color: string }> {
  const out: Array<{ path: string; color: string }> = []
  for (const t of tokens) {
    if (t.type !== 'color') continue
    const color = swatchColor(t)
    if (!color) continue
    out.push({ path: t.path, color })
    if (out.length >= max) break
  }
  return out
}

export function DesignAtAGlance({ design }: { design: DesignPlaneResponse }) {
  const swatches = swatchTokens(design.tokens)
  const colorCount = design.tokens.filter((t) => t.type === 'color').length
  const points = design.deviance.trend
    .filter((t): t is typeof t & { score: number } => typeof t.score === 'number')
    .map((t) => ({ ts: t.at, value: t.score }))
  return (
    <div className="grid min-w-0 gap-3 lg:grid-cols-2" data-testid="design-at-a-glance">
      <Section
        title="Your colours"
        action={<span className="text-2xs text-fg-faint">{colorCount.toLocaleString()} colour tokens</span>}
      >
        {swatches.length > 0 ? (
          <ul className="grid list-none grid-cols-6 gap-1.5 p-0 sm:grid-cols-8" aria-label="Colour tokens">
            {swatches.map((s) => (
              <li key={s.path} className="min-w-0" title={`${s.path} ${s.color}`}>
                <span
                  aria-hidden="true"
                  className="block aspect-square w-full rounded-sm border border-edge-subtle"
                  style={{ background: s.color }}
                />
                <span className="sr-only">
                  {s.path} {s.color}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-fg-muted">This set has no colour tokens.</p>
        )}
        {colorCount > swatches.length ? (
          <p className="mt-2 text-2xs text-fg-faint">The token catalogue below lists all of them.</p>
        ) : null}
      </Section>
      <Section title="Drift from your design">
        {points.length > 0 ? (
          <>
            <MetricTimeline
              title="Drift score per check (lower is better)"
              points={points}
              formatValue={(v) => String(Math.round(v))}
              height={110}
            />
            <p className="mt-1 text-2xs text-fg-faint">
              How much of your code uses colours, spacing or fonts that are not in your design. Run a drift check to add a point.
            </p>
          </>
        ) : (
          <p className="text-xs text-fg-muted">No drift check has been scored yet. Run one below to see how closely the code follows your design.</p>
        )}
      </Section>
    </div>
  )
}
