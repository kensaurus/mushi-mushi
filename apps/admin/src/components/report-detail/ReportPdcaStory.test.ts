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
    // The summary shows once, higher on the page (sweep 2026-11-18): step 1 says what was decided.
    expect(nodes.plan.headline).toBe('Sorted as bug')
    expect(nodes.plan.headline).not.toContain('Login button')
  })

  // Re-audit 2026-11-11: "precomputed", "0ms" and "No judge or CI signal yet" on a builder's sample report.
  it('keeps the judge wording for operator accounts and never repeats the model on the story', () => {
    const r = report({ status: 'classified', stage1_classification: { category: 'bug' }, stage1_model: 'precomputed', stage1_latency_ms: 0 })
    const outside = buildStoryNodes(r, idle)
    expect(outside.plan.details).toContain('Sample explanation (written in advance)')
    expect(outside.plan.details?.join(' ')).not.toMatch(/precomputed|0ms/)
    expect(outside.check.headline).toBe('Not checked yet. The checks run once a fix is dispatched.')
    const real = report({ status: 'classified', stage1_classification: { category: 'bug' }, stage1_model: 'claude-haiku-5-5', stage1_latency_ms: 812 })
    expect(buildStoryNodes(real, idle).plan.details?.join(' ')).not.toMatch(/claude-haiku|812ms/)
    const operator = buildStoryNodes(real, idle, true)
    // Round-3 sweep 2026-11-19: the model and latency are in the classification card only.
    expect(operator.plan.details?.join(' ')).not.toMatch(/claude-haiku|812ms|severity|conf/)
    expect(operator.check.headline).toContain('No judge or CI signal yet')
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

// A new user's first report said "click Dispatch fix" over two disabled Dispatch fix buttons (feedback 2026-11-22).
describe('ReportPdcaStory fix step while the dispatch setup is unfinished', () => {
  const withCode = report({ status: 'classified', component: 'src/pages/Login.tsx' } as Partial<ReportDetail>)
  const setup = {
    steps: [
      { key: 'github', label: 'Connect GitHub', href: '/integrations/config#platform-card-github' },
      { key: 'autofix', label: 'Turn on Autofix', href: '/integrations/config#integrations-codebase' },
    ],
    done: 2,
    total: 4,
  }

  it('says what to set up first instead of "click Dispatch fix", and shows it inline', () => {
    const doNode = buildStoryNodes(withCode, idle, false, setup).do
    expect(doNode.state).toBe('idle')
    expect(doNode.headline).toBe('No fix yet. To dispatch one: Connect GitHub · Turn on Autofix (2 of 4 done)')
    expect(doNode.headline).not.toContain('click')
    expect(doNode.setup).toBe(setup)
  })

  it('keeps "click Dispatch fix" when nothing is missing, and the no-code reason when there is no code', () => {
    expect(buildStoryNodes(withCode, idle).do.headline).toBe('No fix dispatched yet — click "Dispatch fix" to start')
    expect(buildStoryNodes(withCode, idle).do.setup).toBeUndefined()
    const noCode = buildStoryNodes(report({ status: 'classified' }), idle, false, setup).do
    expect(noCode.headline).toBe('No fix dispatched yet — no stack trace or file for an agent to change')
    expect(noCode.setup).toBeUndefined()
  })
})
