/**
 * FILE: apps/admin/src/pages/TesterSubmissionsReviewPage.test.ts
 * PURPOSE: Group K entry 222 — the review queue pages through every
 *          submission instead of stopping at the server's first 20.
 */

import { describe, expect, it } from 'vitest'
import { REVIEW_PAGE_SIZE, reviewPageCount } from './TesterSubmissionsReviewPage'

describe('reviewPageCount', () => {
  it('matches the server page size', () => {
    expect(REVIEW_PAGE_SIZE).toBe(20)
  })

  it('needs a second page past 20 submissions', () => {
    expect(reviewPageCount(20)).toBe(1)
    expect(reviewPageCount(21)).toBe(2)
    expect(reviewPageCount(35)).toBe(2)
    expect(reviewPageCount(41)).toBe(3)
  })

  it('never reports zero pages', () => {
    expect(reviewPageCount(0)).toBe(1)
    expect(reviewPageCount(-3)).toBe(1)
  })
})
