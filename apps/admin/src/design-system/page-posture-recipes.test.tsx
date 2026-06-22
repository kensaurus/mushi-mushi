/**
 * FILE: page-posture-recipes.test.tsx
 * PURPOSE: Vitest catalog for PagePosture slot recipes (Storybook-equivalent guardrails).
 */

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import {
  PagePosture,
  POSTURE_PRIORITY,
  postureBudgetForMode,
} from '../components/PagePosture'
import { PAGE_POSTURE_RECIPES } from './page-posture-recipes'

describe('page-posture-recipes', () => {
  it('defines three canonical recipes with ascending priorities', () => {
    expect(PAGE_POSTURE_RECIPES).toHaveLength(3)
    for (const recipe of PAGE_POSTURE_RECIPES) {
      const priorities = recipe.slots.map((s) => s.priority)
      const sorted = [...priorities].sort((a, b) => a - b)
      expect(priorities).toEqual(sorted)
      expect(recipe.slots[0]?.priority).toBe(POSTURE_PRIORITY.status)
    }
  })

  it('beginner budget caps full-stack recipe at two visible rows', () => {
    const full = PAGE_POSTURE_RECIPES.find((r) => r.id === 'status-snapshot-guide')!
    expect(full.slots.length).toBe(3)
    expect(postureBudgetForMode('beginner')).toBe(2)
    expect(full.maxRowsBeginner).toBeLessThanOrEqual(postureBudgetForMode('beginner'))
  })

  it('renders status-snapshot recipe with data-page-posture and row cap', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)

    await act(async () => {
      root.render(
        createElement(PagePosture, {
          slots: [
            { priority: POSTURE_PRIORITY.status, id: 'status', children: createElement('div', { 'data-testid': 'banner' }, 'Banner') },
            {
              priority: POSTURE_PRIORITY.heroOrSnapshot,
              id: 'snapshot',
              children: createElement('div', { 'data-testid': 'snapshot' }, 'Snapshot'),
            },
            {
              priority: POSTURE_PRIORITY.guide,
              id: 'guide',
              children: createElement('div', { 'data-testid': 'guide' }, 'Guide'),
            },
          ],
        }),
      )
    })

    const posture = host.querySelector('[data-page-posture]')
    expect(posture).not.toBeNull()
    const visibleRows = posture?.querySelectorAll(':scope > *').length ?? 0
    expect(visibleRows).toBeLessThanOrEqual(postureBudgetForMode('quickstart'))

    root.unmount()
    host.remove()
  })
})
