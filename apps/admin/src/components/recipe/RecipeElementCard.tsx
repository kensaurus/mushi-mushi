/**
 * FILE: apps/admin/src/components/recipe/RecipeElementCard.tsx
 * PURPOSE: One App Recipe element as a selectable card: state chip (shape +
 *          colour), the one-line reason (which says what to do next), when it
 *          was last checked, the open problem count and up to three facts.
 *          Shared by the canvas node and the ordered-list fallback so both
 *          paths say the same thing. The chip and the "Checked ..." line read
 *          the same `lastCheckedAt`, so they cannot contradict each other.
 */

import { formatRelative } from '../ui'
import type { RecipeElementKey, RecipeElementSummary } from '../../lib/recipeTypes'
import { RecipeStateChip } from './RecipeStateChip'
import { describeLastChecked, elementStateMeta, factLabel, formatFactValue, problemCountText } from './recipeState'

const MAX_FACTS = 3

interface RecipeElementCardProps {
  element: RecipeElementSummary
  selected?: boolean
  onSelect?: (key: RecipeElementKey) => void
  /** Canvas cards are fixed-width; list cards stretch. */
  layout?: 'canvas' | 'list'
}

export function RecipeElementCard({ element, selected = false, onSelect, layout = 'list' }: RecipeElementCardProps) {
  const meta = elementStateMeta(element.state, element.lastCheckedAt)
  const checked = describeLastChecked(element.lastCheckedAt, formatRelative, element.state)
  const facts = Object.entries(element.facts ?? {}).slice(0, MAX_FACTS)

  return (
    <button
      type="button"
      onClick={() => onSelect?.(element.key)}
      aria-pressed={selected}
      data-element={element.key}
      data-state={meta.state}
      className={`nodrag flex w-full flex-col gap-2 rounded-md bg-surface-raised p-3 text-left shadow-card motion-safe:transition-colors hover:bg-surface-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 ${meta.cardEdge} ${selected ? 'ring-2 ring-brand/70' : ''} ${layout === 'canvas' ? 'min-h-40' : ''}`}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="text-sm font-semibold text-fg">{element.label}</span>
        <RecipeStateChip state={element.state} lastCheckedAt={element.lastCheckedAt} className="shrink-0" />
      </span>
      <span className="text-xs leading-snug text-fg-secondary">{element.reason}</span>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
        <span title={checked.title}>{checked.text}</span>
        <span>{problemCountText(meta.state, element.findingsCount)}</span>
      </span>
      {facts.length > 0 && (
        <span className="flex flex-col gap-0.5 border-t border-edge-subtle pt-2">
          {facts.map(([k, v]) => (
            <span key={k} className="flex items-baseline justify-between gap-2 text-2xs">
              <span className="text-fg-faint">{factLabel(k)}</span>
              <span className="min-w-0 truncate font-mono text-fg-secondary">{formatFactValue(v)}</span>
            </span>
          ))}
        </span>
      )}
    </button>
  )
}
