/**
 * FILE: apps/admin/src/components/recipe/RecipeElementList.tsx
 * PURPOSE: Ordered-list fallback for the Recipe canvas — used below 768 px,
 *          under prefers-reduced-motion, on request, and as the screen-reader
 *          path. Same cards, same order (lane by lane), grouped under lane
 *          headings so the Sources → Build → Deploy → Runtime story survives.
 */

import type { RecipeElementKey, RecipeElementSummary } from '../../lib/recipeTypes'
import { RecipeElementCard } from './RecipeElementCard'
import { ELEMENT_LANE, RECIPE_LANES } from './recipeState'

interface RecipeElementListProps {
  /** Already in canonical order (see `orderedRecipeElements`). */
  elements: RecipeElementSummary[]
  selectedKey: RecipeElementKey | null
  onSelect: (key: RecipeElementKey) => void
}

export function RecipeElementList({ elements, selectedKey, onSelect }: RecipeElementListProps) {
  return (
    <div className="flex flex-col gap-4">
      {RECIPE_LANES.map((lane) => {
        const inLane = elements.filter((e) => ELEMENT_LANE[e.key] === lane.id)
        if (inLane.length === 0) return null
        return (
          <section key={lane.id} aria-labelledby={`recipe-lane-${lane.id}`} className="flex flex-col gap-2">
            <h2 id={`recipe-lane-${lane.id}`} className="text-2xs font-semibold uppercase tracking-wider text-fg-muted">
              {lane.label}
              <span className="ml-2 font-normal normal-case tracking-normal text-fg-faint">{lane.hint}</span>
            </h2>
            <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-testid={`recipe-lane-${lane.id}`}>
              {inLane.map((el) => (
                <li key={el.key}>
                  <RecipeElementCard
                    element={el}
                    selected={selectedKey === el.key}
                    onSelect={onSelect}
                    layout="list"
                  />
                </li>
              ))}
            </ol>
          </section>
        )
      })}
    </div>
  )
}
