import { describe, expect, it } from 'vitest'
import { classificationNarrative } from './classificationNarrative'

const SUMMARY = 'Checkout button does nothing — the click is ignored'

describe('classificationNarrative', () => {
  it('hides the callout when the root cause and the extraction repeat the summary', () => {
    expect(
      classificationNarrative({
        summary: SUMMARY,
        stage2_analysis: { rootCause: SUMMARY },
        stage1_classification: {
          symptom: 'Checkout button does nothing',
          actual: 'the click is ignored',
        },
      }),
    ).toBeNull()
  })

  it('shows a root cause that is not the summary', () => {
    expect(
      classificationNarrative({
        summary: SUMMARY,
        title: 'Checkout does nothing',
        stage2_analysis: { rootCause: 'The click handler is not bound on the button.' },
      }),
    ).toEqual({
      label: 'Root cause',
      text: 'The click handler is not bound on the button.',
    })
  })

  it('shows the Stage-1 extraction when the root cause repeats the summary but expected behavior does not', () => {
    expect(
      classificationNarrative({
        summary: SUMMARY,
        stage2_analysis: { rootCause: `  ${SUMMARY}  ` },
        stage1_classification: {
          symptom: 'Checkout button does nothing',
          actual: 'the click is ignored',
          expected: 'the order is placed',
        },
      }),
    ).toEqual({
      label: 'Stage-1 extraction',
      text: 'Expected the order is placed. Got the click is ignored.',
    })
  })

  it('does not fall back to the summary when nothing else was extracted', () => {
    expect(classificationNarrative({ summary: SUMMARY, description: 'raw words from the reporter' })).toBeNull()
  })
})
