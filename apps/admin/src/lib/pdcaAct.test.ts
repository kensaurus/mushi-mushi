import { describe, expect, it } from 'vitest'
import { ACT_BLOCKER_COPY, ACT_BLOCKER_STAMP, actBlocker } from './pdcaAct'
import { STAMP_VISUAL } from './pdcaStamp'
import { getMergeBlockerReason, pickPrimaryFixAttempt } from './mergeFix'

/** Report 469f6962 / PR 424 as the QA run saw it on 2026-10-02. */
const PR_424 = {
  status: 'completed',
  pr_url: 'https://github.com/kensaurus/mushi-mushi/pull/424',
  pr_number: 424,
  pr_state: null as string | null,
  merged_at: null,
  check_run_conclusion: 'failure',
  review_passed: false,
}

describe('actBlocker', () => {
  it('red CI blocks the Act stage instead of "Awaiting merge"', () => {
    expect(actBlocker(PR_424)).toBe('ci_failed')
    expect(ACT_BLOCKER_STAMP.ci_failed).toBe('blocked')
    expect(ACT_BLOCKER_COPY.ci_failed).toMatch(/^Blocked: CI failed/)
  })

  it('a closed PR outranks red CI and reads as failed', () => {
    expect(actBlocker({ ...PR_424, pr_state: 'closed' })).toBe('pr_closed')
    expect(ACT_BLOCKER_STAMP.pr_closed).toBe('failed')
  })

  it('an agent review flag with green CI asks for review', () => {
    expect(actBlocker({ ...PR_424, check_run_conclusion: 'success' })).toBe('needs_review')
    expect(ACT_BLOCKER_COPY.needs_review).toMatch(/^Needs review/)
  })

  it('a clean open PR, a merged PR, or no PR has no blocker', () => {
    expect(actBlocker({ ...PR_424, check_run_conclusion: 'success', review_passed: true })).toBeNull()
    expect(actBlocker({ ...PR_424, merged_at: '2026-10-02T02:00:00Z' })).toBeNull()
    expect(actBlocker({ ...PR_424, pr_url: null })).toBeNull()
  })
})

describe('stamp vocabulary', () => {
  it('a finished stage reads "Done", not "Closed"', () => {
    expect(STAMP_VISUAL.done.label).toBe('Done')
  })

  it('blocked never reads "In flight" and does not pulse', () => {
    expect(STAMP_VISUAL.blocked.label).toBe('Blocked')
    expect(STAMP_VISUAL.blocked.pulse).toBe(false)
  })
})

describe('merge affordances for a closed PR', () => {
  it('refuses to merge a PR closed without merging', () => {
    expect(getMergeBlockerReason({ ...PR_424, pr_state: 'closed' })).toMatch(/closed without merging/)
  })

  it('does not pick a closed PR as the current attempt', () => {
    const closed = { ...PR_424, pr_state: 'closed' }
    const retry = { status: 'running', pr_url: null, pr_state: null }
    expect(pickPrimaryFixAttempt([closed, retry])).toBe(retry)
  })
})
