/**
 * FILE: local-followup.test.ts
 * PURPOSE: The gate for a review follow-up on a pull request a local agent
 *          opened (`mushi work`, ADR 0032 amendment 2026-10-24).
 */
import { describe, expect, it } from 'vitest'
import {
  localCiRepairRequestDedupe,
  localFollowupDedupe,
  localFollowupGate,
  localFollowupSkipDedupe,
  localHandoff,
  type LocalFollowupInput,
  type LocalHandoffInput,
} from '../../supabase/functions/_shared/local-followup.ts'

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
    expect(localFollowupGate(input())).toEqual({ ok: true, headSha: HEAD, branch: 'bugfix/x', round: 1, kind: 'findings' })
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

describe('local CI repair (handed over from the console)', () => {
  const merge = { status: 'completed', verdict: 'merge', head_sha: HEAD }

  it('opens a ci_repair round on a merge review only when a person asked and CI fails on the code', () => {
    expect(localFollowupGate(input({ review: merge, ciRepairRequested: true, ciCodeRed: true }))).toEqual({ ok: true, headSha: HEAD, branch: 'bugfix/x', round: 1, kind: 'ci_repair' })
    // Not asked for: a merge review is still nothing to follow up.
    expect(localFollowupGate(input({ review: merge, ciCodeRed: true }))).toMatchObject({ ok: false, code: 'NOT_FIX_FIRST' })
    // Asked for, but CI went green since.
    expect(localFollowupGate(input({ review: merge, ciRepairRequested: true, ciCodeRed: false }))).toMatchObject({ ok: false, code: 'CI_NOT_FAILING' })
    // Same per-head and per-PR limits as a findings round.
    expect(localFollowupGate(input({ review: merge, ciRepairRequested: true, ciCodeRed: true, roundHeads: [HEAD] }))).toMatchObject({ ok: false, code: 'ALREADY_FOLLOWED_UP' })
  })

  it('the request key never matches the round keys (local-followup:%)', () => {
    expect(localCiRepairRequestDedupe('f1', HEAD)).toBe(`local-ci-repair-request:f1:${HEAD}`)
    expect(localCiRepairRequestDedupe('f1', HEAD).startsWith('local-followup:')).toBe(false)
  })
})

describe('localHandoff (the console hands a PR to the local lanes)', () => {
  const h = (over: Partial<LocalHandoffInput> = {}): LocalHandoffInput => ({
    kind: 'ci_repair',
    attempt: { agent: 'cursor_cloud', pr_url: 'https://github.com/o/r/pull/1', merged_at: null, pr_state: 'open', commit_sha: HEAD },
    review: { status: 'completed', verdict: 'merge', head_sha: HEAD, findings: 0 },
    roundHeads: [],
    cloudFollowupsOn: false,
    ciCodeRed: true,
    ...over,
  })

  it('takes a red merge-approved cloud PR while cloud follow-ups are off', () => {
    expect(localHandoff(h())).toEqual({ ok: true, headSha: HEAD })
  })

  it('says why not: green CI, wrong verdict, newer commit, rounds used, cloud PR with cloud on', () => {
    expect(localHandoff(h({ ciCodeRed: false }))).toMatchObject({ ok: false, message: expect.stringContaining('not failing on the code') })
    expect(localHandoff(h({ review: { status: 'completed', verdict: 'hold', head_sha: HEAD, findings: 2 } }))).toMatchObject({ ok: false, message: expect.stringContaining('"hold"') })
    expect(localHandoff(h({ attempt: { ...h().attempt, commit_sha: 'b'.repeat(40) } }))).toMatchObject({ ok: false, message: expect.stringContaining('newer commit') })
    expect(localHandoff(h({ roundHeads: ['c'.repeat(40), 'd'.repeat(40)] }))).toMatchObject({ ok: false, message: expect.stringContaining('Both follow-up rounds') })
    expect(localHandoff(h({ cloudFollowupsOn: true }))).toMatchObject({ ok: false, message: expect.stringContaining('cursor_cloud') })
  })

  it('a fix-first hand-off needs findings', () => {
    const fixFirst = { status: 'completed', verdict: 'fix_first', head_sha: HEAD, findings: 3 }
    expect(localHandoff(h({ kind: 'findings', review: fixFirst }))).toEqual({ ok: true, headSha: HEAD })
    expect(localHandoff(h({ kind: 'findings', review: { ...fixFirst, findings: 0 } }))).toMatchObject({ ok: false, message: expect.stringContaining('no findings') })
  })
})
