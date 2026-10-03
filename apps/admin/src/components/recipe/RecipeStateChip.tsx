/**
 * FILE: apps/admin/src/components/recipe/RecipeStateChip.tsx
 * PURPOSE: State chip for an App Recipe element. Every state has its own
 *          shape (check, triangle, question, open ring, cross) so the state
 *          never relies on colour alone. Tone + glyph come from
 *          `elementStateMeta()`, whose default is `unknown`.
 */

import { Badge } from '../ui'
import { elementStateMeta, type StateGlyph } from './recipeState'

export function RecipeStateGlyph({ glyph, className = 'h-3 w-3' }: { glyph: StateGlyph; className?: string }) {
  const common = {
    className: `shrink-0 ${className}`,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    'data-glyph': glyph,
  }
  switch (glyph) {
    case 'check':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6.5" />
          <path d="M5 8.2l2 2 4-4.4" />
        </svg>
      )
    case 'triangle':
      return (
        <svg {...common}>
          <path d="M8 1.8l6.4 11.4H1.6z" />
          <path d="M8 6.2v3.2M8 11.3v.2" />
        </svg>
      )
    case 'cross':
      return (
        <svg {...common}>
          <path d="M5.2 1.5h5.6l3.7 3.7v5.6l-3.7 3.7H5.2l-3.7-3.7V5.2z" />
          <path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4" />
        </svg>
      )
    case 'ring':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6" strokeDasharray="2.4 2.2" />
        </svg>
      )
    case 'question':
    default:
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6.5" strokeDasharray="3 2" />
          <path d="M6.3 6.2a1.8 1.8 0 1 1 2.6 1.6c-.6.3-.9.7-.9 1.3M8 11.2v.2" />
        </svg>
      )
  }
}

export function RecipeStateChip({ state, className = '' }: { state: unknown; className?: string }) {
  const meta = elementStateMeta(state)
  return (
    <Badge tone={meta.tone} title={meta.description} className={`gap-1 ${className}`}>
      <RecipeStateGlyph glyph={meta.glyph} />
      <span data-state={meta.state}>{meta.label}</span>
    </Badge>
  )
}
