/**
 * FILE: apps/admin/src/components/report-detail/ReportClassification.test.ts
 * PURPOSE: The classification callout must not repeat the heading/summary.
 */

import { describe, expect, it } from 'vitest'
import { classificationNarrative } from './ReportClassification'

const base = {
  title: null as string | null,
  summary: 'Checkout button does nothing — No request is sent',
  description: 'I clicked checkout and nothing happened',
  stage1_classification: {
    symptom: 'Checkout button does nothing',
    actual: 'No request is sent',
  },
  stage2_analysis: { rootCause: 'The click handler is never bound.' },
}

describe('classificationNarrative', () => {
  it('hides the stage-1 line when it is the summary the heading already shows', () => {
    expect(classificationNarrative(base)).toBeNull()
  })

  it('shows the stage-1 extraction when the summary was rewritten', () => {
    expect(
      classificationNarrative({
        ...base,
        title: 'Checkout is stuck',
        summary: 'The pay button never starts a request.',
      }),
    ).toEqual({
      label: 'What happened',
      text: 'Checkout button does nothing — No request is sent',
    })
  })

  it('shows the root cause only when stage 1 left nothing distinct', () => {
    expect(
      classificationNarrative({
        ...base,
        summary: 'Checkout is stuck',
        stage1_classification: null,
      }),
    ).toEqual({ label: 'Root cause', text: 'The click handler is never bound.' })
  })

  it('hides a root cause that repeats the summary', () => {
    expect(
      classificationNarrative({
        ...base,
        summary: 'The click handler is never bound.',
        stage1_classification: null,
      }),
    ).toBeNull()
  })
})
