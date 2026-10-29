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

  it('a local-lane run that said needs_human only in its error line also says a person decides', () => {
    // 87 `mushi work` runs in 30 days (2026-10-29) had no failure_category.
    const step = nextStep(report('classified', failedAttempt({ agent: 'mcp', failure_category: null, error: 'Agent says this needs a person: Mushi verdict: needs_human. Pick a query budget.' })))
    expect(step?.title).toBe('A person decides this one')
  })

  it('an agent error on an open report still points at the weak spots', () => {
    const step = nextStep(report('classified', failedAttempt({ failure_category: 'sandbox_timeout', error: 'timed out' })))
    expect(step?.title).toBe('Check the weak spots, then retry')
  })

  it('a push the repo hook refused says to run those checks, not to look at weak spots', () => {
    const step = nextStep(report('classified', failedAttempt({
      agent: 'mcp',
      error: 'Pre-push checks failed: test. The fix is committed on bugfix/MUSHI-1-local-cursor (abc1234def); nothing was pushed.',
      branch: 'bugfix/MUSHI-1-local-cursor',
      commit_sha: 'abc1234def5678901234567890abcdef12345678',
    })))
    expect(step?.title).toBe("Your repo's own checks failed at push")
    expect(step?.why).toContain('Run them on the branch, or re-run the local lane.')
    expect(step?.why).toContain('bugfix/MUSHI-1-local-cursor')
    expect(`${step?.title} ${step?.why}`).not.toMatch(/weak spot|retry/i)
    const attempt = fixNodes(report('classified', failedAttempt({ agent: 'local-cursor', error: 'git push failed: hook steps failed: test' })), true).find((n) => n.id === 'attempt')
    expect(attempt?.detail).toBe('local Cursor')
    const mcp = fixNodes(report('classified', failedAttempt({ agent: 'mcp', error: 'git push failed: hook steps failed: test' })), true).find((n) => n.id === 'attempt')
    expect(mcp?.detail).toBe('MCP')
    expect(attempt?.needsLook).toBe(false)
  })

  it('a commit hook failure still points at the weak spots', () => {
    const step = nextStep(report('classified', failedAttempt({ error: 'mushi work: git commit failed: hook steps failed: lint' })))
    expect(step?.title).toBe('Check the weak spots, then retry')
  })
})
