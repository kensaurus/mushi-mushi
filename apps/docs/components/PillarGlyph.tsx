/**
 * Stage glyphs for the four "what happens after a user reports something"
 * cards, drawn inline rather than pulled from an icon CDN.
 *
 * These cards explain the entire product loop and previously carried no
 * graphic at all — four identical walls of text under four identical labels,
 * which reads as a wireframe someone forgot to finish. Inline SVG keeps them
 * crisp at any DPI, themeable through `currentColor`, and off the landing
 * page's network critical path.
 *
 * Each mark is drawn to a shared 24×24 box on the same 1.5 stroke so the row
 * reads as one set: a speech bubble (a person tells you), a magnifier over
 * lines of prose (it gets explained in English), many rows collapsing into one
 * (dedup), and a branch merging (the draft PR).
 *
 * Shared by `Pillars` (docs sub-pages) and `DiagnosisScrollStage` (landing) so
 * the two surfaces can never drift apart.
 */

import type { LandingPillar } from '@/lib/landing-copy'

export function PillarGlyph({ glyph }: { glyph: LandingPillar['glyph'] }) {
  const common = {
    width: 24,
    height: 24,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }

  switch (glyph) {
    // A user speaks up: a report bubble with the note they left.
    case 'report':
      return (
        <svg {...common}>
          <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-4 3.5V16H6.5A2.5 2.5 0 0 1 4 13.5Z" />
          <path d="M12 8v3" />
          <path d="M12 13.4h.01" />
        </svg>
      )
    // Plain-English diagnosis: a lens reading prose, not a stack trace.
    case 'diagnose':
      return (
        <svg {...common}>
          <path d="M4 5h9M4 9h6" />
          <circle cx="14.5" cy="13.5" r="4.5" />
          <path d="m17.8 16.8 2.7 2.7" />
        </svg>
      )
    // Dedup: many separate reports collapse into a single row.
    case 'group':
      return (
        <svg {...common}>
          <path d="M4 5h5M4 9h5M4 13h5" />
          <path d="M11 9h3.5" />
          <path d="m13 7 2 2-2 2" />
          <rect x="16" y="6.5" width="4.5" height="5" rx="1.2" />
        </svg>
      )
    // Draft PR: a branch merging back into the trunk.
    case 'ship':
      return (
        <svg {...common}>
          <circle cx="7" cy="6" r="2" />
          <circle cx="7" cy="18" r="2" />
          <circle cx="17" cy="12" r="2" />
          <path d="M7 8v8" />
          <path d="M15 12H9.5a2.5 2.5 0 0 0-2.5 2.5" />
        </svg>
      )
  }
}
