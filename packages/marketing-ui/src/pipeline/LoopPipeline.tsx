/**
 * FILE: LoopPipeline.tsx
 * PURPOSE: The whole bug loop in one row: reported → triaged → fix PR →
 *          reviewed + CI → merged + deployed → reporter told. Each stage is
 *          an icon, the console's own stage name and one short line.
 *
 * Motion is CSS only (styles.css, `.mushi-loop*`): a dot runs along the rail
 * and each stage lights as it passes, transform and opacity only. Under
 * prefers-reduced-motion the row is static and every stage reads the same.
 *
 * Deliberately not <MushiCanvas />: that scene pulls in React Flow and
 * framer-motion for a five-stage story whose names predate the console's
 * /pipeline page. This one is plain markup and works without JavaScript.
 */

import type { CSSProperties, ReactNode } from 'react'
import { LOOP_STAGES, type LoopGlyph } from './stages'

function Glyph({ glyph }: { glyph: LoopGlyph }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
  switch (glyph) {
    // A user speaks up: a report bubble with an alert mark.
    case 'report':
      return (
        <svg {...common}>
          <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-4 3.5V16H6.5A2.5 2.5 0 0 1 4 13.5Z" />
          <path d="M12 7.5v3.5" />
          <path d="M12 13.4h.01" />
        </svg>
      )
    // Plain-English read: a lens over lines of prose.
    case 'triage':
      return (
        <svg {...common}>
          <path d="M4 5h9M4 9h6" />
          <circle cx="14.5" cy="13.5" r="4.5" />
          <path d="m17.8 16.8 2.7 2.7" />
        </svg>
      )
    // Fix PR: a branch coming off the trunk.
    case 'pr':
      return (
        <svg {...common}>
          <circle cx="7" cy="6" r="2" />
          <circle cx="7" cy="18" r="2" />
          <circle cx="17" cy="9" r="2" />
          <path d="M7 8v8" />
          <path d="M17 11v1a3 3 0 0 1-3 3H9" />
        </svg>
      )
    // Review + CI: a shield with a check.
    case 'review':
      return (
        <svg {...common}>
          <path d="M12 3.5 5 6v5.5c0 4.2 3 7.4 7 9 4-1.6 7-4.8 7-9V6Z" />
          <path d="m9 12 2.2 2.2L15.5 10" />
        </svg>
      )
    // Merged + deployed: an arrow going up and out.
    case 'ship':
      return (
        <svg {...common}>
          <path d="M12 16V4" />
          <path d="m7 9 5-5 5 5" />
          <path d="M5 15v3.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V15" />
        </svg>
      )
    // The reporter is told: a bell.
    case 'told':
      return (
        <svg {...common}>
          <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15Z" />
          <path d="M10 20.5a2 2 0 0 0 4 0" />
        </svg>
      )
  }
}

interface LoopPipelineProps {
  /** Short note under the row, e.g. which steps are optional. */
  caption?: ReactNode
}

export function LoopPipeline({ caption }: LoopPipelineProps) {
  return (
    <figure className="mushi-loop" data-testid="loop-pipeline">
      <ol className="mushi-loop__track" aria-label="What happens to a bug, step by step">
        {LOOP_STAGES.map((stage, i) => (
          <li
            key={stage.id}
            className="mushi-loop__stage"
            style={{ '--mushi-loop-i': i } as CSSProperties}
          >
            <span className="mushi-loop__icon">
              <Glyph glyph={stage.glyph} />
            </span>
            <span className="mushi-loop__num" aria-hidden="true">
              {i + 1}
            </span>
            <span className="mushi-loop__label">{stage.label}</span>
            <span className="mushi-loop__line">{stage.line}</span>
          </li>
        ))}
      </ol>
      <div className="mushi-loop__rail" aria-hidden="true">
        <span className="mushi-loop__runner">
          <span className="mushi-loop__dot" />
        </span>
      </div>
      {caption ? <figcaption className="mushi-loop__caption">{caption}</figcaption> : null}
    </figure>
  )
}
