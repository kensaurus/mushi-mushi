/**
 * FILE: packages/server/src/__tests__/auto-decide.test.ts
 * PURPOSE: "Decide for me" (ADR 0055) maps the stored Opus verdict and GitHub's
 *          view of a fix PR to one action, and never loops on a report.
 */

import { describe, expect, it } from 'vitest'
import {
  closeComment,
  decideFix,
  HOLD_GRACE_MS,
  MAX_PR_ATTEMPTS_PER_REPORT,
  ownCi,
  pickKeeper,
  REPAIR_GRACE_MS,
  type DecideInput,
} from '../../supabase/functions/_shared/auto-decide.ts'

const NOW = new Date('2026-10-30T12:00:00Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()

function input(over: Partial<DecideInput> = {}, review: Partial<NonNullable<DecideInput['review']>> = {}): DecideInput {
  return {
    pr: { open: true, merged: false, headSha: 'h1' },
    report: { closed: false },
    superseded: false,
    review: { status: 'completed', verdict: 'merge', headSha: 'h1', fixesReport: true, skipReason: null, completedAt: ago(3600_000), ...review },
    ci: 'green',
    repairActive: false,
    prAttempts: 1,
    now: NOW,
    ...over,
  }
}

describe('decideFix', () => {
  it('queues an Opus-approved PR on its current head unless CI is red', () => {
    expect(decideFix(input()).do).toBe('queue')
    expect(decideFix(input({ ci: 'pending' })).do).toBe('queue')
    expect(decideFix(input({ ci: 'unknown' })).do).toBe('queue')
  })

  it('only records a PR GitHub already closed or merged', () => {
    expect(decideFix(input({ pr: { open: false, merged: true, headSha: 'h1' } }))).toMatchObject({ do: 'synced', reason: 'Merged on GitHub.' })
    expect(decideFix(input({ pr: { open: false, merged: false, headSha: 'h1' } })).do).toBe('synced')
  })

  it('closes a PR whose report is closed, or that another PR of the report supersedes', () => {
    expect(decideFix(input({ report: { closed: true } })).do).toBe('close_superseded')
    expect(decideFix(input({ superseded: true })).do).toBe('close_superseded')
  })

  it('waits for a review that is missing, running, skipped or failed', () => {
    expect(decideFix(input({ review: null })).do).toBe('wait')
    expect(decideFix(input({}, { status: 'running', verdict: null })).do).toBe('wait')
    const skipped = decideFix(input({}, { status: 'skipped', verdict: null, skipReason: 'llm_budget_exceeded' }))
    expect(skipped).toMatchObject({ do: 'wait' })
    expect(skipped.reason).toContain('llm_budget_exceeded')
    expect(decideFix(input({}, { status: 'failed', verdict: null })).do).toBe('wait')
  })

  it('asks Opus again when the verdict is about an older commit, whatever it said', () => {
    for (const verdict of ['merge', 'fix_first', 'hold'] as const) {
      expect(decideFix(input({}, { verdict, headSha: 'old' })).do).toBe('rereview')
    }
  })

  it('gives "fix first" and red CI the repair window, then closes and redoes', () => {
    expect(decideFix(input({}, { verdict: 'fix_first', completedAt: ago(REPAIR_GRACE_MS - 1) })).do).toBe('wait')
    expect(decideFix(input({ repairActive: true }, { verdict: 'fix_first', completedAt: ago(REPAIR_GRACE_MS * 3) })).do).toBe('wait')
    expect(decideFix(input({}, { verdict: 'fix_first', completedAt: ago(REPAIR_GRACE_MS + 1) })).do).toBe('close_redo')
    expect(decideFix(input({ ci: 'red' }, { completedAt: ago(REPAIR_GRACE_MS - 1) })).do).toBe('wait')
    expect(decideFix(input({ ci: 'red' }, { completedAt: ago(REPAIR_GRACE_MS + 1) })).do).toBe('close_redo')
  })

  it('acts on a hold after the grace, and says when the PR does not fix the report', () => {
    expect(decideFix(input({}, { verdict: 'hold', completedAt: ago(HOLD_GRACE_MS - 1) })).do).toBe('wait')
    const notFix = decideFix(input({}, { verdict: 'hold', fixesReport: false, completedAt: ago(HOLD_GRACE_MS + 1) }))
    expect(notFix.do).toBe('close_redo')
    expect(notFix.reason).toContain('does not fix the report')
    // "accept ADR 0043 first" holds are never merged: closed and redone without the flagged part.
    expect(decideFix(input({}, { verdict: 'hold', fixesReport: true, completedAt: ago(HOLD_GRACE_MS + 1) })).do).toBe('close_redo')
  })

  it('stops redoing a report after the cap, so credits are never spent in a loop', () => {
    const atCap = decideFix(input({ prAttempts: MAX_PR_ATTEMPTS_PER_REPORT }, { verdict: 'hold', completedAt: ago(HOLD_GRACE_MS + 1) }))
    expect(atCap.do).toBe('close_park')
    expect(atCap.reason).toContain('a person decides')
    expect(decideFix(input({ prAttempts: MAX_PR_ATTEMPTS_PER_REPORT - 1 }, { verdict: 'hold', completedAt: ago(HOLD_GRACE_MS + 1) })).do).toBe('close_redo')
    // An approved PR is still queued at the cap: the cap limits retries, not merges.
    expect(decideFix(input({ prAttempts: 9 })).do).toBe('queue')
  })
})

describe('pickKeeper', () => {
  it('keeps the best verdict, then the newest', () => {
    const prs = [
      { id: 'old-merge', verdict: 'merge' as const, createdAt: '2026-10-01T00:00:00Z' },
      { id: 'new-hold', verdict: 'hold' as const, createdAt: '2026-10-29T00:00:00Z' },
      { id: 'new-merge', verdict: 'merge' as const, createdAt: '2026-10-20T00:00:00Z' },
    ]
    expect(pickKeeper(prs)?.id).toBe('new-merge')
    expect(pickKeeper([{ id: 'a', verdict: null, createdAt: '2026-10-01T00:00:00Z' }, { id: 'b', verdict: 'hold', createdAt: '2026-10-29T00:00:00Z' }])?.id).toBe('a')
    expect(pickKeeper([])).toBeNull()
  })
})

describe('ownCi and the close comment', () => {
  it('reads the merge queue check view', () => {
    expect(ownCi({ pending: 0, failed: ['test'] })).toBe('red')
    expect(ownCi({ pending: 2, failed: [] })).toBe('pending')
    expect(ownCi({ pending: 0, failed: [], ran: ['test'] })).toBe('green')
    expect(ownCi({ pending: 0, failed: [] })).toBe('unknown')
  })

  it('says why, links the review and how to undo it', () => {
    const text = closeComment({ do: 'close_redo', reason: 'Opus says this pull request does not fix the report.' }, 'https://github.com/o/r/pull/1#issuecomment-9')
    expect(text).toContain('Decide for me')
    expect(text).toContain('does not fix the report')
    expect(text).toContain('#issuecomment-9')
    expect(text).toContain('Reopen it')
  })
})

describe('prRepoRef', () => {
  it('reads owner and repo from a pull request URL only', async () => {
    const { prRepoRef } = await import('../../supabase/functions/_shared/auto-decide.ts')
    expect(prRepoRef('https://github.com/kensaurus/glot.it/pull/585')).toEqual({ owner: 'kensaurus', repo: 'glot.it' })
    expect(prRepoRef('https://github.com/kensaurus/glot.it/issues/585')).toBeNull()
    expect(prRepoRef('https://evil.example/kensaurus/x/pull/1')).toBeNull()
    expect(prRepoRef(null)).toBeNull()
  })
})
