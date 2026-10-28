/**
 * The last step of "How Mushi reached this diagnosis": a closed report ends on
 * the close decision and a "needs a person" stop never says "retry"
 * (report f5575c9e: bee1a206 was dismissed as an ops task, yet read "Check the
 * weak spots, then retry · your move").
 */

import { describe, expect, it } from 'vitest'
import type { ReportDetail, ReportFixAttempt } from '../components/report-detail/types'
import { fixNodes } from './reportDiagnosisNodes'

const failedAttempt = (over: Partial<ReportFixAttempt> = {}) =>
  ({
    id: 'a1',
    status: 'failed',
    agent: 'cursor_cloud',
    pr_url: null,
    pr_number: null,
    pr_state: null,
    merged_at: null,
    files_changed: null,
    llm_model: null,
    error: 'Mushi verdict: needs_human. An owner or ops task.',
    failure_category: null,
    ...over,
  }) as unknown as ReportFixAttempt

const report = (status: string, attempt: ReportFixAttempt, closed_reason: string | null = null) =>
  ({ id: 'r1', status, closed_reason, fix_attempts: [attempt] }) as unknown as ReportDetail

const nextStep = (r: ReportDetail) => fixNodes(r, true).find((n) => n.id === 'next')

describe('fixNodes: the next step', () => {
  it('a dismissed report ends on its close decision, not on retry', () => {
    const step = nextStep(report('dismissed', failedAttempt({ failure_category: 'needs_human' }), 'wont_fix'))
    expect(step?.title).toBe("Closed: Won't fix")
    expect(step?.state).toBe('done')
    expect(`${step?.title} ${step?.why}`).not.toMatch(/retry/i)
  })

  it('an open report the agent handed to a person says a person decides', () => {
    const step = nextStep(report('classified', failedAttempt({ failure_category: 'needs_human' })))
    expect(step?.title).toBe('A person decides this one')
    expect(step?.title).not.toMatch(/retry/i)
  })

  it('an agent error on an open report still points at the weak spots', () => {
    const step = nextStep(report('classified', failedAttempt({ failure_category: 'sandbox_timeout', error: 'timed out' })))
    expect(step?.title).toBe('Check the weak spots, then retry')
  })
})
