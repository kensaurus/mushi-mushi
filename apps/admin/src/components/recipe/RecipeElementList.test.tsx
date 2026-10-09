/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/recipe/RecipeElementList.test.tsx
 * PURPOSE: The list fallback (narrow screens, reduced motion, screen readers)
 *          shows all 8 recipe cards in lane order, and a state value the
 *          console does not know renders as "Not checked yet" — never OK.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RECIPE_ELEMENT_KEYS, type RecipeElementSummary } from '../../lib/recipeTypes'
import { RecipeElementList } from './RecipeElementList'
import { RecipeElementCard } from './RecipeElementCard'
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
      root.render(createElement(MemoryRouter, null, createElement(RecipeElementList, { elements, selectedKey: null, onSelect })))
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

  it('shows an unrecognised state as "Not checked yet", never OK', () => {
    render(
      orderedRecipeElements({
        schema: summary('schema', 'totally_fine'),
      }),
    )
    const schema = container.querySelector<HTMLButtonElement>('button[data-element="schema"]')
    expect(schema?.dataset.state).toBe('unknown')
    expect(schema?.textContent).toContain('Not checked yet')
    expect(schema?.textContent).not.toContain('OK')
  })

  it('says "Not checked yet" when lastCheckedAt is null', () => {
    render(orderedRecipeElements({ ci: summary('ci', 'unknown') }))
    const ci = container.querySelector('button[data-element="ci"]')
    expect(ci?.textContent).toContain('Not checked yet')
  })

  it('a card never shows OK next to "Not checked yet": an unchecked OK renders as not checked', () => {
    render(orderedRecipeElements({ env: summary('env', 'ok') }))
    const env = container.querySelector<HTMLButtonElement>('button[data-element="env"]')
    expect(env?.dataset.state).toBe('unknown')
    expect(env?.textContent).not.toContain('OK')
    expect(env?.textContent).toContain('Not checked yet')
  })

  it('a failed or problem card with no check time never says "Not checked yet" next to its chip', () => {
    render(orderedRecipeElements({ env: summary('env', 'error'), routes: summary('routes', 'drift') }))
    const env = container.querySelector<HTMLButtonElement>('button[data-element="env"]')
    expect(env?.textContent).toContain('Check failed')
    expect(env?.textContent).toContain('Last check did not finish')
    expect(env?.textContent).not.toContain('Not checked yet')
    const routes = container.querySelector<HTMLButtonElement>('button[data-element="routes"]')
    expect(routes?.textContent).toContain('Needs attention')
    expect(routes?.textContent).not.toContain('Not checked yet')
  })

  it('says what checks each card and links to the page that owns it, outside the select button', () => {
    render(orderedRecipeElements({ design: summary('design', 'drift', { links: [{ label: 'Design system', to: '/design' }] }) }))
    const card = container.querySelector<HTMLButtonElement>('button[data-element="design"]')!
    expect(card.textContent).toContain('How it is checked: The design scan reads your repo daily')
    const link = [...container.querySelectorAll('a')].find((a) => a.textContent === 'Design system')
    expect(link?.getAttribute('href')).toBe('/design')
    expect(link?.closest('button')).toBeNull()
  })

  it('a canvas card is trimmed to fit its row: no "How it is checked", no facts, capped height', () => {
    const element = summary('design', 'drift', { facts: { tokens: 12 }, links: [{ label: 'Design system', to: '/design' }] })
    act(() => {
      root.render(createElement(MemoryRouter, null, createElement(RecipeElementCard, { element, layout: 'canvas' })))
    })
    const card = container.querySelector<HTMLButtonElement>('button[data-element="design"]')!
    expect(card.textContent).toContain('design reason')
    expect(card.textContent).not.toContain('How it is checked')
    expect(card.textContent).not.toContain('12')
    expect(card.parentElement?.className).toContain('max-h-65')
    expect([...container.querySelectorAll('a')].some((a) => a.getAttribute('href') === '/design')).toBe(true)
  })

  it('no rendered card ever pairs "Not checked yet" with a "Checked ..." time', () => {
    const at = new Date(Date.now() - 60_000).toISOString()
    const states = ['ok', 'drift', 'unknown', 'not_connected', 'error']
    render(orderedRecipeElements(Object.fromEntries(
      RECIPE_ELEMENT_KEYS.map((k, i) => [k, summary(k, states[i % 5], { lastCheckedAt: i % 2 ? at : null })]),
    )))
    for (const card of container.querySelectorAll<HTMLButtonElement>('button[data-element]')) {
      const t = card.textContent ?? ''
      expect(t.includes('Not checked yet') && /Checked \S/.test(t)).toBe(false)
      expect(t.includes('Check failed') && t.includes('Not checked yet')).toBe(false)
    }
  })

  it('a checked-but-unconfirmed card says "Not confirmed" beside its check time, never "Not checked yet"', () => {
    render(orderedRecipeElements({ integrations: summary('integrations', 'unknown', { lastCheckedAt: new Date(Date.now() - 13 * 60_000).toISOString() }) }))
    const card = container.querySelector<HTMLButtonElement>('button[data-element="integrations"]')
    expect(card?.textContent).toContain('Not confirmed')
    expect(card?.textContent).toContain('Checked')
    expect(card?.textContent).not.toContain('Not checked yet')
  })

  it('selects a card on click', () => {
    const onSelect = vi.fn()
    render(orderedRecipeElements({}), onSelect)
    const gates = container.querySelector<HTMLButtonElement>('button[data-element="gates"]')
    act(() => gates?.click())
    expect(onSelect).toHaveBeenCalledWith('gates')
  })
})
