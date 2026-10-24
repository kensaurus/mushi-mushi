/**
 * FILE: apps/admin/src/lib/dogfoodNarrative.test.ts
 * PURPOSE: The reports banner's drafted-fix count is the area's open PRs,
 *          not a remainder of a project-wide total.
 */
import { describe, expect, it } from 'vitest'
import { renderDogfoodNarrative } from './copy'

describe('renderDogfoodNarrative', () => {
  it('states the area drafted count beside merged fixes', () => {
    expect(
      renderDogfoodNarrative({
        projectName: 'glot.it',
        component: 'Checkout',
        componentReports: 6,
        draftedFixes: 2,
        mergedFixes: 1,
      }),
    ).toBe(
      'Checkout is your most fragile area — 6 reports in the last 14 days. 1 fix already merged and 2 more drafted.',
    )
  })

  it('does not invent drafted fixes from the report count', () => {
    const sentence = renderDogfoodNarrative({
      projectName: 'glot.it',
      component: 'Checkout',
      componentReports: 95,
      draftedFixes: 0,
      mergedFixes: 0,
    })
    expect(sentence).toBe(
      'Checkout is your most fragile area — 95 reports in the last 14 days. No fixes drafted yet — open one and let Mushi try.',
    )
    expect(sentence).not.toContain('more drafted')
  })
})
