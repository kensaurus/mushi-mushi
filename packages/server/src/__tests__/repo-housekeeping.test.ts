/**
 * FILE: repo-housekeeping.test.ts
 * PURPOSE: The repo clean-up rules (ADR 0051), pure: which recorded branches
 *          and fix PRs a clean-up may touch, every refusal, and the payload
 *          check the run applies before anything changes on GitHub.
 */

import { describe, expect, it } from 'vitest'
import {
  branchCandidates,
  branchRefusal,
  clampStaleDays,
  housekeepingPayloadProblem,
  isHeadOf,
  MAX_HOUSEKEEPING_ITEMS,
  prCandidates,
  type GhPull,
  type RecordedBranch,
  type RepoFacts,
} from '../../supabase/functions/_shared/repo-housekeeping.ts'

const REPO = 'kensaurus/app'
const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const C = 'c'.repeat(40)
const NOW = new Date('2026-10-27T12:00:00Z')

const pull = (n: number, over: Partial<GhPull> = {}): GhPull => ({
  number: n,
  state: 'closed',
  merged: true,
  draft: false,
  headRef: `mushi/fix-${n}`,
  headRepo: REPO,
  headSha: A,
  baseRef: 'main',
  closedAt: '2026-10-20T00:00:00Z',
  mergedAt: '2026-10-20T00:00:00Z',
  ...over,
})

const rec = (branch: string, pr: number | null, over: Partial<RecordedBranch> = {}): RecordedBranch => ({ source: 'fix_attempt', sourceId: `f-${branch}`, repo: REPO, branch, prNumber: pr, active: false, ...over })

function facts(over: Partial<RepoFacts> = {}): RepoFacts {
  return {
    repo: REPO,
    defaultBranch: 'main',
    branches: [{ name: 'main', sha: C, protected: true }, { name: 'mushi/fix-1', sha: A, protected: false }],
    openPulls: [],
    closedPulls: new Map([[1, pull(1)]]),
    headCommitAt: new Map(),
    truncated: false,
    ...over,
  }
}

describe('branchRefusal', () => {
  const base = { repo: REPO, branch: 'mushi/fix-1', defaultBranch: 'main', protectedBranch: false, openPulls: [] as GhPull[] }
  it('refuses the default branch', () => expect(branchRefusal({ ...base, branch: 'main' })).toMatch(/default branch/))
  it('refuses a protected branch', () => expect(branchRefusal({ ...base, protectedBranch: true })).toMatch(/protected/))
  it('refuses the head of an open PR in this repo', () => {
    expect(branchRefusal({ ...base, openPulls: [pull(9, { state: 'open', merged: false, headRef: 'mushi/fix-1' })] })).toMatch(/head of open pull request #9/)
  })
  it('does not count a fork PR whose branch has the same name', () => {
    expect(branchRefusal({ ...base, openPulls: [pull(9, { state: 'open', merged: false, headRef: 'mushi/fix-1', headRepo: 'someone/app' })] })).toBeNull()
  })
  it('refuses the base of an open PR (deleting it would close that PR)', () => {
    expect(branchRefusal({ ...base, openPulls: [pull(9, { state: 'open', merged: false, headRef: 'other', baseRef: 'mushi/fix-1' })] })).toMatch(/targets it/)
  })
  it('allows a branch nothing points at', () => expect(branchRefusal(base)).toBeNull())
})

describe('branchCandidates', () => {
  it('lists a recorded branch whose PR merged and whose tip is the PR head', () => {
    const r = branchCandidates(facts(), [rec('mushi/fix-1', 1)], new Set())
    expect(r.candidates).toHaveLength(1)
    expect(r.candidates[0]).toMatchObject({ key: 'branch:mushi/fix-1', headSha: A, prNumber: 1, prState: 'merged' })
    expect(r.candidates[0].reason).toMatch(/#1 was merged on 2026-10-20/)
  })

  it('never lists a branch Mushi did not record, whatever its name', () => {
    const f = facts({ branches: [...facts().branches, { name: 'mushi/fix-2', sha: A, protected: false }], closedPulls: new Map([[2, pull(2)]]) })
    expect(branchCandidates(f, [], new Set()).candidates).toEqual([])
  })

  it('keeps a branch with commits pushed after its PR closed', () => {
    const r = branchCandidates(facts({ branches: [{ name: 'mushi/fix-1', sha: B, protected: false }] }), [rec('mushi/fix-1', 1)], new Set())
    expect(r.candidates).toEqual([])
    expect(r.kept[0].reason).toMatch(/pushed after pull request #1 closed/)
  })

  it('keeps a branch whose PR is still open, and one with no recorded PR', () => {
    const open = facts({ closedPulls: new Map(), openPulls: [pull(1, { state: 'open', merged: false })] })
    expect(branchCandidates(open, [rec('mushi/fix-1', 1)], new Set()).kept[0].reason).toMatch(/head of open pull request #1/)
    expect(branchCandidates(facts(), [rec('mushi/fix-1', null)], new Set()).kept[0].reason).toMatch(/no pull request/)
  })

  it('keeps a branch whose recorded PR came from a fork with the same branch name', () => {
    const f = facts({ closedPulls: new Map([[1, pull(1, { headRepo: 'someone/app' })]]) })
    expect(branchCandidates(f, [rec('mushi/fix-1', 1)], new Set()).candidates).toEqual([])
  })

  it('keeps the default branch and protected branches even when recorded', () => {
    const f = facts({ branches: [{ name: 'main', sha: A, protected: false }, { name: 'mushi/fix-1', sha: A, protected: true }], closedPulls: new Map([[1, pull(1)], [3, pull(3, { headRef: 'main' })]]) })
    const r = branchCandidates(f, [rec('mushi/fix-1', 1), rec('main', 3)], new Set())
    expect(r.candidates).toEqual([])
    expect(r.kept.map((k) => k.reason).join(' ')).toMatch(/default branch.*protected|protected.*default branch/)
  })

  it('keeps a branch a Mushi run is still working on, and one already waiting in a clean-up', () => {
    expect(branchCandidates(facts(), [rec('mushi/fix-1', 1, { active: true })], new Set()).kept[0].reason).toMatch(/still going/)
    expect(branchCandidates(facts(), [rec('mushi/fix-1', 1)], new Set(['branch:mushi/fix-1'])).kept[0].reason).toMatch(/waiting for a decision/)
  })

  it('counts recorded branches already gone and ignores other repos', () => {
    const r = branchCandidates(facts(), [rec('mushi/gone', 4), rec('mushi/fix-1', 1, { repo: 'kensaurus/other' })], new Set())
    expect(r.gone).toBe(1)
    expect(r.candidates).toEqual([])
  })

  it('says closed without merging for a closed PR', () => {
    const r = branchCandidates(facts({ closedPulls: new Map([[1, pull(1, { merged: false, mergedAt: null })]]) }), [rec('mushi/fix-1', 1)], new Set())
    expect(r.candidates[0].prState).toBe('closed')
    expect(r.candidates[0].reason).toMatch(/closed without merging/)
  })
})

describe('prCandidates', () => {
  const open = (n: number, over: Partial<GhPull> = {}) => pull(n, { state: 'open', merged: false, closedAt: null, mergedAt: null, headSha: B, ...over })
  const base = { staleDays: 14, now: NOW, riding: new Set<number>(), pending: new Set<string>(), activeBranches: new Set<string>() }
  const attempt = (id: string, n: number, over: Record<string, unknown> = {}) => ({ id, reportId: 'r1', repo: REPO, prNumber: n, createdAt: '2026-10-01T00:00:00Z', active: false, merged: false, ...over })

  it('lists a PR superseded by a newer open PR for the same report', () => {
    const f = facts({ openPulls: [open(5), open(6, { headSha: C })] })
    const r = prCandidates(f, [attempt('f5', 5), attempt('f6', 6, { createdAt: '2026-10-10T00:00:00Z' })], [], base)
    expect(r.candidates.map((x) => x.prNumber)).toEqual([5])
    expect(r.candidates[0].why).toEqual(['superseded'])
    expect(r.candidates[0].reason).toMatch(/newer fix for the same report is open as #6/)
  })

  it('lists a PR whose latest Opus review said hold about its current head, not an older one', () => {
    const f = facts({ openPulls: [open(5)] })
    const reviews = [
      { fixAttemptId: 'f5', verdict: 'merge', headSha: A, summary: null, at: '2026-10-02T00:00:00Z' },
      { fixAttemptId: 'f5', verdict: 'hold', headSha: B, summary: 'Removes a feature', at: '2026-10-03T00:00:00Z' },
    ]
    expect(prCandidates(f, [attempt('f5', 5)], reviews, base).candidates[0].why).toEqual(['hold'])
    const stale = [{ fixAttemptId: 'f5', verdict: 'hold', headSha: A, summary: null, at: '2026-10-03T00:00:00Z' }]
    expect(prCandidates(f, [attempt('f5', 5)], stale, base).candidates).toEqual([])
  })

  it('lists a PR with no new commit for longer than staleDays', () => {
    const f = facts({ openPulls: [open(5)], headCommitAt: new Map([[5, '2026-10-01T00:00:00Z']]) })
    const r = prCandidates(f, [attempt('f5', 5)], [], base)
    expect(r.candidates[0].why).toEqual(['stale'])
    expect(r.candidates[0].reason).toMatch(/no new commit since 2026-10-01/)
    const fresh = facts({ openPulls: [open(5)], headCommitAt: new Map([[5, '2026-10-20T00:00:00Z']]) })
    expect(prCandidates(fresh, [attempt('f5', 5)], [], base).candidates).toEqual([])
  })

  it('keeps a PR riding a release train, one a Mushi run still works on, and one already asked', () => {
    const f = facts({ openPulls: [open(5)], headCommitAt: new Map([[5, '2026-09-01T00:00:00Z']]) })
    expect(prCandidates(f, [attempt('f5', 5)], [], { ...base, riding: new Set([5]) }).kept[0].reason).toMatch(/release train/)
    expect(prCandidates(f, [attempt('f5', 5, { active: true })], [], base).kept[0].reason).toMatch(/still going/)
    expect(prCandidates(f, [attempt('f5', 5)], [], { ...base, pending: new Set(['pr:5']) }).kept[0].reason).toMatch(/waiting/)
  })

  it('only looks at open PRs of Mushi fixes in this repo', () => {
    const f = facts({ openPulls: [open(5), open(7)], headCommitAt: new Map([[5, '2026-09-01T00:00:00Z'], [7, '2026-09-01T00:00:00Z']]) })
    expect(prCandidates(f, [attempt('f5', 5, { repo: 'kensaurus/other' })], [], base).candidates).toEqual([])
  })
})

describe('housekeepingPayloadProblem', () => {
  const item = { key: 'branch:x', branch: 'x', headSha: A, prNumber: 1, prState: 'merged', reason: 'r' }
  it('accepts a well-formed list', () => expect(housekeepingPayloadProblem('delete_branches', { repo: REPO, defaultBranch: 'main', items: [item] })).toBeNull())
  it(`refuses more than ${MAX_HOUSEKEEPING_ITEMS} items`, () => {
    const items = Array.from({ length: MAX_HOUSEKEEPING_ITEMS + 1 }, (_, i) => ({ ...item, key: `branch:x${i}`, branch: `x${i}` }))
    expect(housekeepingPayloadProblem('delete_branches', { repo: REPO, defaultBranch: 'main', items })).toMatch(/At most 50/)
  })
  it('refuses the default branch, a bad commit, a bad name and repeated items', () => {
    expect(housekeepingPayloadProblem('delete_branches', { repo: REPO, defaultBranch: 'x', items: [item] })).toMatch(/default branch/)
    expect(housekeepingPayloadProblem('delete_branches', { repo: REPO, defaultBranch: 'main', items: [{ ...item, headSha: 'abc' }] })).toMatch(/valid name or commit/)
    expect(housekeepingPayloadProblem('delete_branches', { repo: REPO, defaultBranch: 'main', items: [{ ...item, branch: '../x' }] })).toMatch(/valid name or commit/)
    expect(housekeepingPayloadProblem('delete_branches', { repo: REPO, defaultBranch: 'main', items: [item, item] })).toMatch(/repeated/)
  })
  it('only turns the setting on, never off', () => {
    expect(housekeepingPayloadProblem('set_delete_branch_on_merge', { repo: REPO, setting: 'delete_branch_on_merge', value: true })).toBeNull()
    expect(housekeepingPayloadProblem('set_delete_branch_on_merge', { repo: REPO, setting: 'delete_branch_on_merge', value: false })).toMatch(/only turns on/)
  })
  it('refuses an unknown action and a missing repo', () => {
    expect(housekeepingPayloadProblem('delete_repo', { repo: REPO, items: [item] })).toMatch(/Unknown/)
    expect(housekeepingPayloadProblem('delete_branches', { items: [item] })).toMatch(/no repository/)
  })
})

describe('helpers', () => {
  it('clamps staleDays to 7..90 and defaults to 14', () => {
    expect(clampStaleDays(undefined)).toBe(14)
    expect(clampStaleDays('3')).toBe(7)
    expect(clampStaleDays(400)).toBe(90)
    expect(clampStaleDays('30')).toBe(30)
  })
  it('isHeadOf compares the head repo too', () => {
    expect(isHeadOf(pull(1), REPO, 'mushi/fix-1')).toBe(true)
    expect(isHeadOf(pull(1, { headRepo: null }), REPO, 'mushi/fix-1')).toBe(false)
  })
})
