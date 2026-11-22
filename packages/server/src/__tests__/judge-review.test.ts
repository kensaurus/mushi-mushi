/**
 * FILE: judge-review.test.ts
 * PURPOSE: The review step on /judge (2026-11-19): "Accept grader's view" may only send what
 *          PATCH /v1/admin/reports/:id accepts, and a disagreement counts as reviewed once a
 *          person set the category at or after the grade.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { graderPatch, reviewedAfterGrade } from '../../supabase/functions/_shared/judge-review.ts'

const now = { category: 'bug', severity: 'low', component: 'Checkout' }

describe('graderPatch', () => {
  it('keeps only valid changes: a classifier category, one of four severities, a component', () => {
    expect(graderPatch({ category: 'Visual', severity: 'HIGH', component: 'Cart' }, now)).toEqual({
      category: 'visual',
      severity: 'high',
      component: 'Cart',
    })
  })

  it('drops free text PATCH would refuse and values equal to the current ones', () => {
    expect(graderPatch({ category: 'ui-glitch', severity: 'p1', component: 'Checkout' }, now)).toBeNull()
    expect(graderPatch({ category: 'bug', severity: 'low', component: '  ' }, now)).toBeNull()
    expect(graderPatch({ category: null, severity: 'critical', component: null }, now)).toEqual({ severity: 'critical' })
  })

  it('is null for a missing or malformed suggestion', () => {
    expect(graderPatch(null, now)).toBeNull()
    expect(graderPatch('wrong', now)).toBeNull()
    expect(graderPatch({ component: 'x'.repeat(201) }, now)).toBeNull()
  })
})

describe('reviewedAfterGrade', () => {
  it('is true only when the category was confirmed at or after the grade', () => {
    expect(reviewedAfterGrade('2026-11-19T10:00:00Z', '2026-11-19T09:00:00Z')).toBe(true)
    expect(reviewedAfterGrade('2026-11-19T09:00:00Z', '2026-11-19T09:00:00Z')).toBe(true)
    expect(reviewedAfterGrade('2026-11-18T09:00:00Z', '2026-11-19T09:00:00Z')).toBe(false)
    expect(reviewedAfterGrade(null, '2026-11-19T09:00:00Z')).toBe(false)
    expect(reviewedAfterGrade('garbage', '2026-11-19T09:00:00Z')).toBe(false)
  })
})

describe('judge routes use the review helper', () => {
  const src = readFileSync(resolve(__dirname, '../../supabase/functions/api/routes/judge.ts'), 'utf8')
  it('returns the PATCH body and the reviewed flag, never the raw suggestion', () => {
    expect(src).toContain('grader_patch: row.classification_agreed === false && meta ? graderPatch(suggested, now) : null')
    expect(src).toContain('reviewed: meta ? reviewedAfterGrade(')
    expect(src).toContain('suggested_correction: suggested, ...row')
    // A reporter category (feature, question…) can't be PATCHed back, so it is never offered to Keep.
    expect(src).toContain('report_category: isClassifierCategory(now.category) ? now.category : null')
  })
  it('counts the recent disagreements nobody reviewed for the stats', () => {
    expect(src).toContain('recentToReview,')
  })
})
