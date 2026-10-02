import { describe, expect, it } from 'vitest'
import { reportDiagnosisView } from './reportDiagnosis'

/** Shape of report c0e99783's stage2_analysis (glot.it, 2026-10-02), trimmed. */
const STAGE2 = {
  category: 'confusing',
  component: 'HomePageStoresReady / FeaturedLessonCard',
  rootCause: 'The minutes prop is out of sync with lesson.estimatedMinutes.',
  suggestedFix: '1. Read minutes from lesson.estimatedMinutes.\n2. Move the promo banner.',
  reproductionSteps: ['Open Home', 'Note the duration', 'Click Start'],
  confidence: 0.82,
  code_context: { status: 'ok', fileCount: 5 },
}

describe('reportDiagnosisView', () => {
  it('reads root cause, fix, repro, component, confidence and model from stage2_analysis', () => {
    const view = reportDiagnosisView({ stage2_analysis: STAGE2, stage2_model: 'claude-sonnet-4-6' })
    expect(view).toEqual({
      kind: 'full',
      diagnosis: {
        rootCause: STAGE2.rootCause,
        suggestedFix: STAGE2.suggestedFix,
        reproductionSteps: STAGE2.reproductionSteps,
        component: STAGE2.component,
        confidence: 0.82,
        model: 'claude-sonnet-4-6',
        groundedFileCount: 5,
      },
    })
  })

  it('tolerates malformed model output', () => {
    const view = reportDiagnosisView({
      stage2_analysis: { root_cause: '  legacy key  ', reproductionSteps: ['ok', 3, '', null], suggestedFix: 42 },
      reproduction_steps: ['column fallback'],
    })
    expect(view.kind).toBe('full')
    if (view.kind !== 'full') return
    expect(view.diagnosis.rootCause).toBe('legacy key')
    expect(view.diagnosis.reproductionSteps).toEqual(['ok'])
    expect(view.diagnosis.suggestedFix).toBeNull()
  })

  it('falls back to the reproduction_steps column when stage 2 has none', () => {
    const view = reportDiagnosisView({ stage2_analysis: { rootCause: 'x' }, reproduction_steps: ['a', 'b'] })
    expect(view.kind === 'full' && view.diagnosis.reproductionSteps).toEqual(['a', 'b'])
  })

  it('shows a streaming diagnosis from stage2_partial', () => {
    expect(reportDiagnosisView({ stage2_partial: { rootCause: 'partial' } }).kind).toBe('streaming')
  })

  it('says stage 1 only when the classifier was confident and stage 2 never ran', () => {
    expect(reportDiagnosisView({ stage1_classification: { category: 'bug' } })).toEqual({ kind: 'stage1_only' })
  })

  it('reports a failure instead of pretending, and pending before anything ran', () => {
    expect(reportDiagnosisView({ processing_error: 'schema mismatch' })).toEqual({
      kind: 'failed',
      message: 'schema mismatch',
    })
    expect(reportDiagnosisView({})).toEqual({ kind: 'pending' })
  })

  it('an auto-fix block stamp is not a diagnosis failure', () => {
    expect(
      reportDiagnosisView({ processing_error: 'autofix_blocked: feature request', stage1_classification: {} }),
    ).toEqual({ kind: 'stage1_only' })
  })

  it('an empty stage 2 object is not a diagnosis', () => {
    expect(reportDiagnosisView({ stage2_analysis: { code_context: { status: 'disabled' } }, stage1_classification: {} }).kind).toBe(
      'stage1_only',
    )
  })
})
