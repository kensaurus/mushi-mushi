/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/recipe/RecipeHeaderSummary.test.tsx
 * PURPOSE: The App blueprint names one next step: the first box in the worst
 *          state, its reason, a button to the page that fixes it and one to
 *          open its side panel (console journeys 2026-10-27). Nothing to do
 *          means no next step, never a made-up one.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecipeElementSummary, RecipeResponse } from '../../lib/recipeTypes'
import { RecipeHeaderSummary } from './RecipeHeaderSummary'
import { elementStateMeta } from './recipeState'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function el(key: RecipeElementSummary['key'], state: RecipeElementSummary['state'], extra: Partial<RecipeElementSummary> = {}): RecipeElementSummary {
  return { key, label: key, lane: 'build', state, reason: `${key} reason`, lastCheckedAt: null, facts: {}, findingsCount: 0, links: [], ...extra }
}

function recipe(elements: RecipeElementSummary[]): RecipeResponse {
  return {
    projectId: 'p1',
    organizationId: null,
    generatedAt: new Date().toISOString(),
    worst: 'ok',
    elements: Object.fromEntries(elements.map((e) => [e.key, e])) as RecipeResponse['elements'],
    manifest: { present: true, path: 'mushi.recipe.json', commitSha: null, capturedAt: null, validationErrors: [] },
    snapshotHash: null,
  }
}

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function render(elements: RecipeElementSummary[], onSelect = vi.fn()) {
  act(() => root.render(createElement(MemoryRouter, null, createElement(RecipeHeaderSummary, { recipe: recipe(elements), elements, onSelect }))))
  return onSelect
}

describe('RecipeHeaderSummary next step', () => {
  it('names the first box in the worst state with its fix and its side panel', () => {
    const elements = [
      el('ci', 'ok'),
      el('gates', 'drift', { label: 'Automated checks', reason: '1 problem to fix.', links: [{ label: 'Open Full-stack audit', to: '/fullstack-audit' }] }),
      el('env', 'drift'),
    ]
    const onSelect = render(elements)
    const step = host.querySelector('[data-testid="recipe-next-step"]')!
    expect(step.textContent).toContain('Next step, Automated checks: 1 problem to fix.')
    expect(step.querySelector('a[href="/fullstack-audit"]')?.textContent).toBe('Open Full-stack audit')
    const show = [...step.querySelectorAll('button')].find((b) => b.textContent === 'Show how to fix')!
    act(() => show.click())
    expect(onSelect).toHaveBeenCalledWith('gates')
  })

  it('offers no next step when every box is OK or optional', () => {
    render([el('ci', 'ok'), el('deploy', 'not_connected')])
    expect(host.querySelector('[data-testid="recipe-next-step"]')).toBeNull()
  })
})

describe('box edges', () => {
  it('read red, amber or green at a glance', () => {
    expect(elementStateMeta('error').cardEdge).toContain('border-danger')
    expect(elementStateMeta('drift').cardEdge).toContain('border-warn')
    expect(elementStateMeta('ok').cardEdge).toContain('border-ok')
    // Not checked is never green.
    expect(elementStateMeta('unknown').cardEdge).not.toContain('border-ok')
  })
})
