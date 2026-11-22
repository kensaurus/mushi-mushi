/**
 * FILE: apps/admin/src/lib/dogfoodNarrative.test.ts
 * PURPOSE: The reports banner's drafted-fix count is the area's open PRs,
 *          not a remainder of a project-wide total; the area name is its own
 *          part, so the banner shows it as a code chip after plain words
 *          ("next is your most fragile area" read as broken, owner 2026-11-18).
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
    ).toEqual({
      lead: 'Most bugs come from',
      component: 'Checkout',
      rest: '6 reports in the last 14 days. 1 fix already merged and 2 more drafted.',
      text: 'Most bugs come from Checkout: 6 reports in the last 14 days. 1 fix already merged and 2 more drafted.',
    })
  })

  it('does not invent drafted fixes from the report count', () => {
    const { text: sentence } = renderDogfoodNarrative({
      projectName: 'glot.it',
      component: 'Checkout',
      componentReports: 95,
      draftedFixes: 0,
      mergedFixes: 0,
    })
    expect(sentence).toBe(
      'Most bugs come from Checkout: 95 reports in the last 14 days. No fixes drafted yet: open one and let Mushi Mushi try.',
    )
    expect(sentence).not.toContain('more drafted')
  })

  it('never calls a package name "your most fragile area"', () => {
    const n = renderDogfoodNarrative({ projectName: 'x', component: 'next', componentReports: 1, draftedFixes: 1, mergedFixes: 0 })
    expect(n.text).not.toContain('fragile')
    expect(n.rest).toBe('1 report in the last 14 days. 1 fix drafted, ready for your review.')
  })
})
