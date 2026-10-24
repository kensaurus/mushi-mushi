/**
 * FILE: merge-train.test.ts
 * PURPOSE: Release trains (ADR 0044): who rides the next train, when it
 *          leaves, how a red train is bisected, and what the train PR says.
 */
import { describe, expect, it } from 'vitest'
import { bisectTrain, isExpress, isTrainReady, pickTrainMembers, trainBranchName, trainDue, trainPullRequest, type TrainCandidate } from '../../supabase/functions/_shared/merge-train.ts'

const c = (over: Partial<TrainCandidate> = {}): TrainCandidate => ({
  rowId: 'r1',
  fixAttemptId: 'f1',
  prNumber: 10,
  queuedAt: '2026-10-23T08:00:00Z',
  headSha: 'h1',
  verdict: 'merge',
  verdictHead: 'h1',
  held: false,
  prOpen: true,
  severity: 'medium',
  source: 'widget',
  ...over,
})

describe('who rides', () => {
  it('takes open PRs whose Opus merge verdict is about their current head, never a hold', () => {
    expect(isTrainReady(c())).toBe(true)
    expect(isTrainReady(c({ verdictHead: 'old' }))).toBe(false)
    expect(isTrainReady(c({ verdict: 'fix_first' }))).toBe(false)
    expect(isTrainReady(c({ held: true }))).toBe(false)
    expect(isTrainReady(c({ prOpen: false }))).toBe(false)
  })
  it('keeps security advisories and critical bugs on the express lane', () => {
    expect(isExpress(c({ source: 'security_advisory' }))).toBe(true)
    expect(isExpress(c({ severity: 'critical' }))).toBe(true)
    expect(isExpress(c())).toBe(false)
  })
  it('picks the oldest ready members up to the limit', () => {
    const rows = [
      c({ rowId: 'b', prNumber: 12, queuedAt: '2026-10-23T09:00:00Z' }),
      c({ rowId: 'a', prNumber: 11, queuedAt: '2026-10-23T08:00:00Z' }),
      c({ rowId: 'x', prNumber: 13, verdict: 'hold' }),
      c({ rowId: 'e', prNumber: 14, severity: 'critical' }),
      c({ rowId: 'c', prNumber: 15, queuedAt: '2026-10-23T10:00:00Z' }),
    ]
    expect(pickTrainMembers(rows, 2).map((m) => m.rowId)).toEqual(['a', 'b'])
  })
})

describe('when it leaves', () => {
  const now = new Date('2026-10-24T06:00:00Z')
  const base = { activeTrain: false, lastTrainAt: '2026-10-24T03:00:00Z', now, intervalMinutes: 360, readyCount: 3, maxMembers: 15 }
  it('waits the interval after the last train, unless the batch is full', () => {
    expect(trainDue(base)).toBe(false)
    expect(trainDue({ ...base, lastTrainAt: '2026-10-23T23:59:00Z' })).toBe(true)
    expect(trainDue({ ...base, readyCount: 15 })).toBe(true)
    expect(trainDue({ ...base, lastTrainAt: null })).toBe(true)
  })
  it('never runs two trains in a repo, nor an empty one', () => {
    expect(trainDue({ ...base, lastTrainAt: null, activeTrain: true })).toBe(false)
    expect(trainDue({ ...base, lastTrainAt: null, readyCount: 0 })).toBe(false)
  })
})

describe('a red train', () => {
  it('retries its first half and defers the rest; a train of one is that member failing', () => {
    expect(bisectTrain([1, 2, 3, 4, 5])).toEqual({ retry: [1, 2, 3], deferred: [4, 5], failedAlone: null })
    expect(bisectTrain([7])).toEqual({ retry: [], deferred: [], failedAlone: 7 })
  })
})

describe('the train PR', () => {
  it('lists the members in plain text and keeps release markers out of the merge commit', () => {
    const pr = trainPullRequest({
      members: [
        { prNumber: 5, title: 'fix: null cart [release:all]', reportId: 'r' },
        { prNumber: 6, title: 'fix: label\n[skip ci] contrast', reportId: null },
      ],
      attempt: 1,
      skipped: 2,
      now: new Date('2026-10-24T01:30:00Z'),
    })
    expect(pr.title).toBe('fix: release train, 2 fixes (2026-10-24)')
    expect(pr.body).toContain('- #5 fix: null cart')
    expect(pr.body).not.toMatch(/\[release|\[skip/)
    expect(pr.body).toContain('2 more approved pull requests wait for the next train')
    expect(trainBranchName(new Date('2026-10-24T01:30:00Z'))).toBe('mushi/train/20261024-0130')
    expect(pr.body).toContain('Do not squash it.')
    const squash = trainPullRequest({ members: [{ prNumber: 5, title: 't', reportId: null }], attempt: 1, skipped: 0, now: new Date('2026-10-24T01:30:00Z'), method: 'squash' })
    expect(squash.body).toContain('Mushi squash-merges this PR, then closes each PR above as shipped')
  })
})
