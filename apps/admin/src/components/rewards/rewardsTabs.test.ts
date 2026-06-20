import { describe, expect, it } from 'vitest'
import { resolveRewardsTabParam } from './rewardsTabs'

describe('rewardsTabs', () => {
  it('maps legacy webhook/dispute deep links to settings', () => {
    expect(resolveRewardsTabParam('webhooks')).toBe('settings')
    expect(resolveRewardsTabParam('disputes')).toBe('settings')
  })

  it('falls back unknown tabs to overview', () => {
    expect(resolveRewardsTabParam('nope')).toBe('overview')
    expect(resolveRewardsTabParam(null)).toBe('overview')
  })
})
