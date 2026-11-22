import { describe, expect, it } from 'vitest'
import { buildStoryNodes } from './ReportPdcaStory'
import type { DispatchState } from '../../lib/dispatchFix'
import type { ReportDetail, ReportFixAttempt } from './types'

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
    // The judge grades the triage, not a fix: the check step names CI only (2026-11-22).
    expect(operator.check.headline).toBe('No CI signal yet — runs once a fix opens a pull request')
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

// Report 3a5cb64c (2026-11-22): a local worker's commit failed before any PR.
// "Fix live" said "Failed — Loop blocked — <Node stack>", "Fix checked" said
// "Failed" for the judge's grade of the triage, and "Fix checked: 4 days ago"
// sat under "Fix written: 2 days ago".
describe('ReportPdcaStory: a fix attempt that stopped before a pull request', () => {
  const STACK =
    "mushi work: git commit failed: […] at wrapModuleLoad (node:internal/modules/cjs/loader:261:19) / at typescript (file:///C:/x/scripts/viz-token-emit.mjs:28:21) / { / code: 'MODULE_NOT_FOUND', / } / Node.js v26.13.1"
  const attempt: ReportFixAttempt = {
    id: 'a1',
    status: 'failed',
    agent: 'mcp',
    pr_url: null,
    pr_number: null,
    branch: 'bugfix/MUSHI-3a5cb64c-local-claude',
    commit_sha: null,
    files_changed: null,
    lines_changed: null,
    review_passed: false,
    check_run_status: null,
    check_run_conclusion: null,
    pr_state: null,
    llm_model: null,
    failure_category: null,
    error: STACK,
    started_at: '2026-11-20T05:38:11.677Z',
    completed_at: '2026-11-20T05:41:01.003Z',
    created_at: '2026-11-20T05:38:11.677Z',
  }
  const base: Partial<ReportDetail> = {
    status: 'classified',
    source: 'sentry',
    created_at: '2026-11-17T16:38:08.824Z',
    judge_eval: { id: 'j1', judge_score: 0.42, classification_agreed: false, judge_reasoning: 'Component is missing.', created_at: '2026-11-17T16:40:00.000Z' },
    fix_attempts: [attempt],
  }
  const nodes = buildStoryNodes(report(base), idle)

  it('pins the failure on "Fix written" in one plain line, the raw text behind Technical details', () => {
    expect(nodes.do.state).toBe('failed')
    expect(nodes.do.headline).toBe("The local worker couldn't commit: a pre-commit check failed (missing dependency).")
    expect(nodes.do.headline).not.toMatch(/node:internal|MODULE_NOT_FOUND|Node\.js/)
    expect(nodes.do.technical).toBe(STACK)
  })

  it('an unknown error still gets a plain line, never the raw text', () => {
    const odd = buildStoryNodes(report({ ...base, fix_attempts: [{ ...attempt, error: 'TypeError: x is undefined\n    at foo (a.js:1:1)' }] }), idle)
    expect(odd.do.headline).toBe('The last fix attempt stopped without a pull request.')
    expect(odd.do.technical).toContain('TypeError: x is undefined')
  })

  it('"Fix live" is not failed and prints no error: nothing reached it', () => {
    expect(nodes.act.state).toBe('idle')
    expect(nodes.act.headline).toBe('Not yet: no pull request was opened, so nothing can go live')
    expect(nodes.act.technical).toBeUndefined()
  })

  it('the judge grades the diagnosis on "Explained", and "Fix checked" is about the fix only', () => {
    expect(nodes.plan.grade).toEqual({ agreed: false, score: 0.42, reason: 'Component is missing.', at: '2026-11-17T16:40:00.000Z' })
    expect(nodes.check.state).toBe('idle')
    expect(nodes.check.headline).toBe('Nothing to check: the last attempt opened no pull request.')
    expect(nodes.check.details?.join(' ') ?? '').not.toMatch(/judge/)
  })

  it('each step carries its own time, in order', () => {
    expect(nodes.plan.at).toBe('2026-11-17T16:38:08.824Z')
    expect(nodes.do.at).toBe('2026-11-20T05:41:01.003Z')
    expect(nodes.check.at).toBeNull()
    expect(nodes.act.at).toBeNull()
  })

  it('caps a very long raw error', () => {
    const long = buildStoryNodes(report({ ...base, fix_attempts: [{ ...attempt, error: 'x'.repeat(5000) }] }), idle)
    expect(long.do.technical!.length).toBeLessThanOrEqual(1501)
  })

  it('a fixed report shows when it landed, not when the failed attempt ended', () => {
    const fixed = buildStoryNodes(report({ ...base, status: 'fixed', fixed_at: '2026-11-22T01:37:06.177Z' }), idle)
    expect(fixed.act.state).toBe('done')
    expect(fixed.act.at).toBe('2026-11-22T01:37:06.177Z')
  })

  it('CI on a real pull request still drives "Fix checked", with its own time', () => {
    const withPr = buildStoryNodes(
      report({
        ...base,
        fix_attempts: [{ ...attempt, status: 'completed', error: null, pr_url: 'https://github.com/o/r/pull/9', pr_number: 9, check_run_conclusion: 'failure', check_run_updated_at: '2026-11-21T00:00:00.000Z' }],
      }),
      idle,
    )
    expect(withPr.check.state).toBe('failed')
    expect(withPr.check.headline).toBe('Fix CI: failure')
    expect(withPr.check.at).toBe('2026-11-21T00:00:00.000Z')
  })
})
