/**
 * FILE: apps/admin/src/components/recipe/RecipeElementCard.tsx
 * PURPOSE: One App Recipe element as a selectable card: state chip (shape +
 *          colour), the one-line reason (which says what to do next), when it
 *          was last checked, the open problem count and up to three facts.
 *          On the canvas the card is trimmed to status, a two-line reason and
 *          the check line, capped at max-h-65 (260 px, RECIPE_CARD_MAX_HEIGHT in
 *          recipeFlow.data.ts) so stacked cards never overlap; the side panel
 *          carries how it is checked. (Importing the constant would pull
 *          @xyflow/react into the list path.)
 *          Shared by the canvas node and the ordered-list fallback so both
 *          paths say the same thing. The chip and the "Checked ..." line read
 *          the same `lastCheckedAt`, so they cannot contradict each other.
 */

import { formatRelative } from '../ui'
import type { RecipeElementKey, RecipeElementSummary } from '../../lib/recipeTypes'
import { RecipeStateChip } from './RecipeStateChip'
import { RecipeLinkList } from './RecipeLinks'
import { StatusGlyph } from '../signal/StatusGlyph'
import {
  cardReason,
  cardStatusLines,
  describeLastChecked,
  ELEMENT_CHECKED_BY,
  elementStateMeta,
  factLabel,
  formatFactValue,
  problemCountText,
  reasonAfterState,
  uncheckedFact,
} from './recipeState'

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
  const canvas = layout === 'canvas'
  const allFacts = canvas ? [] : Object.entries(element.facts ?? {}).slice(0, MAX_FACTS)
  // A never-judged card's zero facts are not measurements: one muted line names them instead of a
  // hatched "not checked" pill per row (8 on one page, 2026-11-18).
  const facts = allFacts.filter(([, v]) => !uncheckedFact(meta.state, v))
  const notChecked = allFacts.filter(([, v]) => uncheckedFact(meta.state, v)).map(([k]) => factLabel(k))
  // Say the state once: the chip names it; these lines add only what it does not.
  const lines = cardStatusLines(meta.state, element.lastCheckedAt, element.findingsCount)
  const reason = cardReason(reasonAfterState(element.reason, meta.label), element.findingsCount)
  const problemText = problemCountText(meta.state, element.findingsCount)

  return (
    <div
      className={`nodrag flex w-full flex-col rounded-md bg-surface-raised text-left shadow-card ${meta.cardEdge} ${selected ? 'ring-2 ring-brand/70' : ''} ${canvas ? 'min-h-40 max-h-65 overflow-hidden' : ''}`}
    >
      <button
        type="button"
        onClick={() => onSelect?.(element.key)}
        aria-pressed={selected}
        data-element={element.key}
        data-state={meta.state}
        // How it is checked, on hover and in the side panel: the same sentence on every card was noise.
        title={`How it is checked: ${ELEMENT_CHECKED_BY[element.key]}`}
        className={`flex w-full flex-col gap-2 rounded-md p-3 text-left motion-safe:transition-colors hover:bg-surface-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 ${canvas ? 'focus-visible:ring-inset' : ''}`}
      >
        <span className="flex items-start justify-between gap-2">
          <span className="text-sm font-semibold text-fg">{element.label}</span>
          <RecipeStateChip state={element.state} lastCheckedAt={element.lastCheckedAt} className="shrink-0" />
        </span>
        {/* Three lines on the canvas: two cut "Run the checks from…" mid-sentence (2026-11-18). */}
        {reason && (
          <span className={`text-xs leading-snug text-fg-secondary ${canvas ? 'line-clamp-3' : ''}`} title={canvas ? reason : undefined}>{reason}</span>
        )}
        {(lines.checked || lines.problems) && (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
            {lines.checked && <span title={checked.title}>{checked.text}</span>}
            {lines.problems &&
              (element.findingsCount > 0 ? (
                // A mark and the number: the header's next step says it in words (round 3).
                <span className="inline-flex items-center gap-1 font-semibold text-fg tabular-nums" title={problemText} data-testid="recipe-card-problems">
                  <StatusGlyph tone={meta.state === 'error' ? 'danger' : 'warn'} />
                  {element.findingsCount.toLocaleString()}
                  <span className="sr-only"> {element.findingsCount === 1 ? 'problem' : 'problems'} to fix</span>
                </span>
              ) : (
                <span>{problemText}</span>
              ))}
          </span>
        )}
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
        {notChecked.length > 0 && (
          <span className="text-2xs text-fg-faint" data-testid="facts-not-checked">
            Not checked: {notChecked.join(', ')}
          </span>
        )}
      </button>
      {/* The page that owns this part, one click from the card (outside the button: no link inside a button). */}
      {element.links.length > 0 && (
        <div className="border-t border-edge-subtle px-3 py-2">
          <RecipeLinkList links={element.links} layout="row" />
        </div>
      )}
    </div>
  )
}
