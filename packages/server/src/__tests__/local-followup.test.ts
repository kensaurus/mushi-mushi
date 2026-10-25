/**
 * FILE: local-followup.test.ts
 * PURPOSE: The gate for a review follow-up on a pull request a local agent
 *          opened (`mushi work`, ADR 0032 amendment 2026-10-24).
 */
import { describe, expect, it } from 'vitest'
import { localFollowupDedupe, localFollowupGate, localFollowupSkipDedupe, type LocalFollowupInput } from '../../supabase/functions/_shared/local-followup.ts'

const HEAD = 'a'.repeat(40)

function input(over: Partial<LocalFollowupInput> = {}): LocalFollowupInput {
  return {
    attempt: { agent: 'mcp', pr_url: 'https://github.com/o/r/pull/1', merged_at: null, pr_state: 'open' },
    review: { status: 'completed', verdict: 'fix_first', head_sha: HEAD },
    livePr: { open: true, headSha: HEAD, headRef: 'bugfix/x', headRepoId: 7, baseRepoId: 7 },
    roundHeads: [],
    cloudFollowupsOn: false,
    ...over,
  }
}

describe('localFollowupGate', () => {
  it('opens round 1 on a fix_first review of the live head', () => {
    expect(localFollowupGate(input())).toEqual({ ok: true, headSha: HEAD, branch: 'bugfix/x', round: 1 })
  })

  it('leaves cloud-agent PRs to the review-followup worker while cloud follow-ups are on', () => {
    const cloud = { agent: 'cursor_cloud', pr_url: 'https://github.com/o/r/pull/1', merged_at: null, pr_state: 'open' }
    expect(localFollowupGate(input({ attempt: cloud, cloudFollowupsOn: true }))).toMatchObject({ ok: false, code: 'NOT_LOCAL', message: expect.stringContaining('follow-ups are on') })
  })

  it('follows up cloud-agent PRs locally when cloud follow-ups are off, nothing else would', () => {
    const cloud = { agent: 'cursor_cloud', pr_url: 'https://github.com/o/r/pull/1', merged_at: null, pr_state: 'open' }
    expect(localFollowupGate(input({ attempt: cloud, cloudFollowupsOn: false }))).toMatchObject({ ok: true, round: 1 })
    expect(localFollowupGate(input({ attempt: { ...cloud, agent: 'anthropic_managed' } }))).toMatchObject({ ok: false, code: 'NOT_LOCAL' })
  })

  it('refuses other verdicts, a running review and no review, saying which', () => {
    expect(localFollowupGate(input({ review: { status: 'completed', verdict: 'merge', head_sha: HEAD } }))).toMatchObject({ ok: false, code: 'NOT_FIX_FIRST' })
    expect(localFollowupGate(input({ review: { status: 'running', verdict: 'fix_first', head_sha: HEAD } }))).toMatchObject({ ok: false, code: 'REVIEW_PENDING' })
    expect(localFollowupGate(input({ review: null }))).toMatchObject({ ok: false, code: 'REVIEW_PENDING', message: expect.stringContaining('no Opus review') })
  })

  it('waits when the PR moved past the reviewed commit', () => {
    const g = localFollowupGate(input({ livePr: { open: true, headSha: 'b'.repeat(40), headRef: 'bugfix/x', headRepoId: 7, baseRepoId: 7 } }))
    expect(g).toMatchObject({ ok: false, status: 409, code: 'REVIEW_STALE' })
  })

  it('refuses forks, closed PRs and an unreadable PR', () => {
    expect(localFollowupGate(input({ livePr: { open: true, headSha: HEAD, headRef: 'x', headRepoId: 8, baseRepoId: 7 } }))).toMatchObject({ ok: false, code: 'FORK' })
    expect(localFollowupGate(input({ livePr: { open: false, headSha: HEAD, headRef: 'x', headRepoId: 7, baseRepoId: 7 } }))).toMatchObject({ ok: false, code: 'PR_NOT_OPEN' })
    expect(localFollowupGate(input({ livePr: null }))).toMatchObject({ ok: false, status: 503, code: 'PR_UNREADABLE' })
  })

  it('runs once per head and at most two rounds per PR', () => {
    expect(localFollowupGate(input({ roundHeads: [HEAD] }))).toMatchObject({ ok: false, code: 'ALREADY_FOLLOWED_UP' })
    expect(localFollowupGate(input({ roundHeads: ['c'.repeat(40)] }))).toMatchObject({ ok: true, round: 2 })
    expect(localFollowupGate(input({ roundHeads: ['c'.repeat(40), 'd'.repeat(40)] }))).toMatchObject({ ok: false, code: 'ROUNDS_USED' })
  })
})

describe('localFollowupSkipDedupe', () => {
  it('is per fix and head, and never matches the round keys (local-followup:%)', () => {
    const skip = localFollowupSkipDedupe('f1', HEAD)
    expect(skip).toBe(`local-followup-skip:f1:${HEAD}`)
    expect(skip.startsWith('local-followup:')).toBe(false)
    expect(localFollowupDedupe('f1', HEAD).startsWith('local-followup:')).toBe(true)
  })
})
