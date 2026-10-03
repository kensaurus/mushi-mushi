/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/recipe/RecipeElementList.test.tsx
 * PURPOSE: The list fallback (narrow screens, reduced motion, screen readers)
 *          shows all 8 recipe cards in lane order, and a state value the
 *          console does not know renders as Unknown — never OK.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RECIPE_ELEMENT_KEYS, type RecipeElementSummary } from '../../lib/recipeTypes'
import { RecipeElementList } from './RecipeElementList'
import { orderedRecipeElements } from './recipeState'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function summary(key: RecipeElementSummary['key'], state: string, extra: Partial<RecipeElementSummary> = {}): RecipeElementSummary {
  return {
    key,
    label: key,
    lane: 'sources',
    state: state as RecipeElementSummary['state'],
    reason: `${key} reason`,
    lastCheckedAt: null,
    facts: {},
    findingsCount: 0,
    links: [],
    ...extra,
  }
}

describe('RecipeElementList', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function render(elements: RecipeElementSummary[], onSelect = vi.fn()) {
    act(() => {
      root.render(createElement(RecipeElementList, { elements, selectedKey: null, onSelect }))
    })
  }

  it('renders all 8 cards in canonical order inside ordered lists', () => {
    // Server order deliberately scrambled — the page normalises it.
    const scrambled = {
      integrations: summary('integrations', 'ok'),
      schema: summary('schema', 'not_connected'),
      deploy: summary('deploy', 'unknown'),
      design: summary('design', 'not_connected'),
      ci: summary('ci', 'ok'),
      env: summary('env', 'drift'),
      routes: summary('routes', 'ok'),
      gates: summary('gates', 'error'),
    }
    render(orderedRecipeElements(scrambled))

    const cards = Array.from(container.querySelectorAll<HTMLButtonElement>('button[data-element]'))
    expect(cards.map((c) => c.dataset.element)).toEqual([...RECIPE_ELEMENT_KEYS])
    for (const card of cards) {
      expect(card.closest('ol')).not.toBeNull()
    }
  })

  it('shows an unrecognised state as Unknown, never OK', () => {
    render(
      orderedRecipeElements({
        schema: summary('schema', 'totally_fine'),
      }),
    )
    const schema = container.querySelector<HTMLButtonElement>('button[data-element="schema"]')
    expect(schema?.dataset.state).toBe('unknown')
    expect(schema?.textContent).toContain('Unknown')
    expect(schema?.textContent).not.toContain('OK')
  })

  it('says "Never checked" when lastCheckedAt is null', () => {
    render(orderedRecipeElements({ ci: summary('ci', 'unknown') }))
    const ci = container.querySelector('button[data-element="ci"]')
    expect(ci?.textContent).toContain('Never checked')
  })

  it('selects a card on click', () => {
    const onSelect = vi.fn()
    render(orderedRecipeElements({}), onSelect)
    const gates = container.querySelector<HTMLButtonElement>('button[data-element="gates"]')
    act(() => gates?.click())
    expect(onSelect).toHaveBeenCalledWith('gates')
  })
})
