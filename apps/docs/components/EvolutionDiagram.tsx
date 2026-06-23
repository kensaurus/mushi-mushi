/**
 * FILE: apps/docs/components/EvolutionDiagram.tsx
 * PURPOSE: Closed-loop pipeline diagram — HTML/CSS, same visual language as
 *   LoopComparison.tsx so theme tokens resolve correctly in light + dark mode.
 */
'use client'

import { VIZ } from '../lib/viz-tokens'
import {
  DiagramFigure,
  DiagramHArrow,
  DiagramNode,
  DiagramVArrow,
} from './diagram-primitives'

const ARIA =
  'Mushi closed loop: user reports friction, SDK captures, Mistake DB clusters, Learning rule encoded, PR review inherits genome, Reward loop credits reporter, cycles back to user. Drift and PDCA agents feed findings into Mistake DB.'

export function EvolutionDiagram() {
  return (
    <DiagramFigure ariaLabel={ARIA}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 0,
          overflowX: 'auto',
          paddingBottom: 4,
        }}
      >
        <DiagramNode label="End user" sub="feels friction" />
        <DiagramHArrow label="report" />
        <DiagramNode label="Mushi SDK" sub="shake to report" />
        <DiagramHArrow label="embed" accent />
        <DiagramNode label="Mistake DB" sub="vector cluster" accent />
        <DiagramHArrow label="promote" accent />
        <DiagramNode label="Learning rule" sub="named + encoded" accent />
        <DiagramHArrow label="inject" />
        <DiagramNode label="PR review" sub="rule injected" />
        <DiagramHArrow label="merge" />
        <DiagramNode label="Reward loop" sub="credits reporter" />
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          gap: 16,
          marginTop: 8,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <DiagramVArrow label="findings" />
          <DiagramNode label="Drift agent" sub="walks live app" compact />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <DiagramVArrow label="regressions" />
          <DiagramNode label="PDCA agent" sub="N iterations" compact />
        </div>
      </div>

      <div
        style={{
          textAlign: 'center',
          marginTop: 14,
          fontSize: 11,
          color: VIZ.accent,
          fontFamily: 'var(--mushi-font-mono, monospace)',
          letterSpacing: '0.05em',
          opacity: 0.85,
        }}
      >
        ↻ thank — reporter credited → next session starts the loop again
      </div>

      <p
        className="not-prose mt-3 flex items-center justify-center gap-1.5 text-center text-xs"
        style={{ color: VIZ.muted }}
      >
        The Mushi closed loop —
        <span
          aria-hidden
          style={{
            display: 'inline-block',
            width: 10,
            height: 10,
            borderRadius: 2,
            border: `1.5px solid ${VIZ.accent}`,
            background: VIZ.accentWash,
            verticalAlign: 'middle',
          }}
        />
        selection nodes (Mistake DB + Learning rule)
      </p>
    </DiagramFigure>
  )
}
