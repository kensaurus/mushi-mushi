import { describe, expect, it } from 'vitest'
import {
  completedJobCockpitFields,
  isUpgradePrStillRelevant,
} from '../../supabase/functions/_shared/sdk-upgrade-gates.ts'

describe('completedJobCockpitFields', () => {
  it('puts a job that opened a PR into the release cockpit', () => {
    // glot.it#142: the job finished with release_status NULL, so
    // sdk-release-sync never saw the merge and the console kept offering
    // a new upgrade PR.
    expect(completedJobCockpitFields('completed', 'https://github.com/o/r/pull/142')).toEqual({
      release_status: 'pr_opened',
      pr_state: 'open',
    })
  })

  it('leaves no-PR and failed jobs alone', () => {
    expect(completedJobCockpitFields('completed_no_pr', undefined)).toEqual({})
    expect(completedJobCockpitFields('failed', 'https://github.com/o/r/pull/1')).toEqual({})
    expect(completedJobCockpitFields('completed', null)).toEqual({})
  })
})

describe('isUpgradePrStillRelevant', () => {
  const pr = 'https://github.com/o/r/pull/9'
  it('shows open, unsynced and merged PRs', () => {
    expect(isUpgradePrStillRelevant({ status: 'completed', pr_url: pr, pr_state: 'open' })).toBe(true)
    expect(isUpgradePrStillRelevant({ status: 'completed', pr_url: pr, pr_state: null })).toBe(true)
    expect(
      isUpgradePrStillRelevant({ status: 'completed', pr_url: pr, pr_state: 'merged', merged_at: '2026-10-03' }),
    ).toBe(true)
  })

  it('hides a PR closed without merging, and jobs with no PR', () => {
    expect(isUpgradePrStillRelevant({ status: 'completed', pr_url: pr, pr_state: 'closed' })).toBe(false)
    expect(isUpgradePrStillRelevant({ status: 'completed_no_pr', pr_url: null })).toBe(false)
  })
})
