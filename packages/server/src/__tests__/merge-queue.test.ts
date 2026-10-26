/**
 * FILE: merge-queue.test.ts
 * PURPOSE: "Merge when ready" decisions (ADR 0041) on the states the
 *          2026-10-23 console bulk merge met: BEHIND after another merge,
 *          a conflict, CI running or failed on the head, a closed PR.
 */
import { describe, expect, it } from 'vitest'
import { checksView, conflictPrompt, failuresOnBase, nextQueueStep, queueLine, reviewRefusal } from '../../supabase/functions/_shared/merge-queue.ts'

const pr = (over: Partial<Parameters<typeof nextQueueStep>[0]> = {}) => ({
  state: 'open',
  merged: false,
  draft: false,
  mergeable: true,
  mergeableState: 'clean',
  headSha: 'abc',
  ...over,
})
const green = { pending: 0, failed: [] }

describe('nextQueueStep', () => {
  it('merges a clean or unstable PR with green checks', () => {
    expect(nextQueueStep(pr(), green)).toEqual({ do: 'merge' })
    expect(nextQueueStep(pr({ mergeableState: 'unstable' }), green)).toEqual({ do: 'merge' })
  })
  it('updates a branch that is behind (the twm #201/#204/#205 case), even with old checks running', () => {
    expect(nextQueueStep(pr({ mergeableState: 'behind' }), { pending: 2, failed: [] })).toEqual({ do: 'update' })
  })
  it('resolves a conflict before anything else (the tsumagoi #839 case)', () => {
    expect(nextQueueStep(pr({ mergeableState: 'dirty', mergeable: false }), { pending: 0, failed: ['CI'] })).toEqual({ do: 'resolve' })
  })
  it('waits while GitHub computes or CI runs, and blocks on failed CI', () => {
    expect(nextQueueStep(pr({ mergeable: null, mergeableState: 'unknown' }), green).do).toBe('wait')
    expect(nextQueueStep(pr(), { pending: 1, failed: [] })).toEqual({ do: 'wait', reason: 'CI is running (1 check left).' })
    expect(nextQueueStep(pr(), { pending: 0, failed: ['required', 'lint'] })).toMatchObject({ do: 'blocked', reason: expect.stringMatching(/^CI failed: required, lint\. A CI-repair agent/) })
    expect(nextQueueStep(pr({ mergeableState: 'blocked' }), green).do).toBe('blocked')
  })
  it('is done when merged, drops a closed PR, and marks a draft ready', () => {
    expect(nextQueueStep(pr({ merged: true, state: 'closed' }), green)).toEqual({ do: 'done' })
    expect(nextQueueStep(pr({ state: 'closed' }), green).do).toBe('drop')
    expect(nextQueueStep(pr({ draft: true }), green)).toEqual({ do: 'ready' })
  })
})

describe('failuresOnBase', () => {
  const base = { pending: 0, failed: ['npm audit'], ran: ['npm audit', 'build'] }
  it('blames the base when every failure fails there or did not run there (an aggregator)', () => {
    expect(failuresOnBase(['npm audit'], base)).toBe(true)
    expect(failuresOnBase(['gate', 'npm audit'], base)).toBe(true)
  })
  it('blames the PR when a failure passed on the base, or none fails there', () => {
    expect(failuresOnBase(['build', 'npm audit'], base)).toBe(false)
    expect(failuresOnBase(['gate'], base)).toBe(false)
    expect(failuresOnBase(['gate', 'npm audit'], { pending: 0, failed: ['npm audit'] })).toBe(false)
  })
})

describe('checksView / conflictPrompt / queueLine', () => {
  it('counts unfinished runs and names failures (neutral and skipped are fine)', () => {
    expect(
      checksView([
        { name: 'build', status: 'in_progress' },
        { name: 'required', status: 'completed', conclusion: 'failure' },
        { name: 'lighthouse', status: 'completed', conclusion: 'neutral' },
        { name: 'e2e', status: 'completed', conclusion: 'skipped' },
      ]),
    ).toEqual({ pending: 1, failed: ['required'], ran: ['required', 'lighthouse'] })
  })
  it('asks the agent to keep both sides and to say needs_human otherwise', () => {
    const p = conflictPrompt({ prUrl: 'https://github.com/o/r/pull/1', baseRef: 'main', headRef: 'fix/x' })
    expect(p).toContain('git merge origin/main')
    expect(p).toContain('Mushi verdict: needs_human')
    expect(p).not.toMatch(/report|reporter/i)
  })
  it('reads each state as one line', () => {
    expect(queueLine({ state: 'queued', detail: null })).toBe('Queued to merge.')
    expect(queueLine({ state: 'waiting', detail: 'CI is running (2 checks left).' })).toBe('CI is running (2 checks left).')
  })
})

describe('reviewRefusal', () => {
  it('waits for the re-review of an updated commit, and asks for it unless one runs', () => {
    expect(reviewRefusal('REVIEW_NOT_MERGE', 'x', { verdict: 'merge', stale: true, rerunning: false })).toMatchObject({ state: 'waiting', requeueReview: true })
    expect(reviewRefusal('REVIEW_NOT_MERGE', 'x', { verdict: 'merge', stale: true, rerunning: true })).toMatchObject({ state: 'waiting', requeueReview: false })
    expect(reviewRefusal('HEAD_MOVED', 'moved', null)).toEqual({ state: 'waiting', detail: 'moved', requeueReview: false })
  })
  it('holds a fix-first, a hold and a PR without review, each saying what happens next', () => {
    expect(reviewRefusal('REVIEW_NOT_MERGE', 'x', { verdict: 'fix_first' }).detail).toMatch(/fix first.*agent fixes its findings/)
    expect(reviewRefusal('REVIEW_HOLD', 'x', { verdict: 'hold' })).toMatchObject({ state: 'blocked', detail: expect.stringMatching(/only you can override/) })
    expect(reviewRefusal('REVIEW_NOT_MERGE', 'x', null).detail).toMatch(/no Opus review yet/)
  })
})
