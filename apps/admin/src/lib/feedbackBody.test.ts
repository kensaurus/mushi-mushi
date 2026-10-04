/**
 * FILE: apps/admin/src/lib/feedbackBody.test.ts
 * PURPOSE: A Feedback body typed up to the counter limit must fit the
 *          server's 5,000-character cap after wrapping (QA bug 198).
 */

import { describe, expect, it } from 'vitest'
import { composeFeedbackBody, feedbackBodyBudget, feedbackPageContextLine } from './feedbackBody'

describe('feedbackBodyBudget', () => {
  for (const type of ['bug', 'feature'] as const) {
    it(`a ${type} body at the budget is exactly within the server cap`, () => {
      const ctx = feedbackPageContextLine('/reports', '?status=new&sort=age')
      const budget = feedbackBodyBudget(type, ctx)
      const composed = composeFeedbackBody(type, 'a'.repeat(budget), ctx)
      expect(composed.length).toBeLessThanOrEqual(5000)
      expect(composeFeedbackBody(type, 'a'.repeat(budget + 1), ctx).length).toBeGreaterThan(5000)
    })
  }

  it('caps a very long page context so it cannot eat the body', () => {
    const ctx = feedbackPageContextLine('/reports', `?q=${'x'.repeat(5000)}`)
    expect(ctx.length).toBeLessThanOrEqual(300)
    expect(feedbackBodyBudget('bug', ctx)).toBeGreaterThan(4600)
  })
})
