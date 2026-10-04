import { describe, expect, it } from 'vitest'
import { buildStoryNodes } from './ReportPdcaStory'
import type { DispatchState } from '../../lib/dispatchFix'
import type { ReportDetail } from './types'

const idle = { status: 'idle', prUrl: null, error: null } as unknown as DispatchState

function report(overrides: Partial<ReportDetail>): ReportDetail {
  return {
    id: 'r1',
    project_id: 'p1',
    status: 'new',
    category: 'bug',
    severity: 'high',
    summary: 'Login button does nothing on iPad Safari',
    confidence: 0.72,
    created_at: '2026-10-04T00:00:00Z',
    classified_at: null,
    stage1_classification: null,
    processing_error: null,
    fix_attempts: [],
    ...overrides,
  } as ReportDetail
}

describe('ReportPdcaStory plan stage', () => {
  // REPORT A2: the test report showed "Plan ⧗ In flight" next to its 72% diagnosis.
  it('a classified test report with a stage-2 diagnosis and no stage-1 object reads as done', () => {
    const nodes = buildStoryNodes(
      report({ status: 'classified', stage2_analysis: { rootCause: 'Safari drops the session cookie' } }),
      idle,
    )
    expect(nodes.plan.state).toBe('done')
    expect(nodes.plan.headline).toBe('Login button does nothing on iPad Safari')
  })

  it('a report nobody classified yet is pending', () => {
    expect(buildStoryNodes(report({}), idle).plan.state).toBe('pending')
  })

  it('an auto-fix block stamp on a classified report is not a failed plan', () => {
    const nodes = buildStoryNodes(
      report({ status: 'classified', stage1_classification: { category: 'bug' }, processing_error: 'autofix_blocked: x' }),
      idle,
    )
    expect(nodes.plan.state).toBe('done')
  })

  it('a classifier error on an unclassified report is a failed plan', () => {
    expect(buildStoryNodes(report({ processing_error: 'schema mismatch' }), idle).plan.state).toBe('failed')
  })
})
