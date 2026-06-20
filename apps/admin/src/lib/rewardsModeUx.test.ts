import { describe, expect, it } from 'vitest'
import { shouldHideEconomyGuide, resolveQuickRewardsTab } from './rewardsModeUx'
import { EMPTY_REWARDS_STATS } from '../components/rewards/types'

describe('rewardsModeUx', () => {
  it('hides economy guide when webhook banner covers priority', () => {
    expect(shouldHideEconomyGuide('webhooks_failing')).toBe(true)
    expect(shouldHideEconomyGuide('healthy')).toBe(false)
  })

  it('resolves quick tab to settings on webhook failure', () => {
    expect(
      resolveQuickRewardsTab({
        ...EMPTY_REWARDS_STATS,
        topPriority: 'webhooks_failing',
        webhooksFailing: 1,
      }),
    ).toBe('settings')
  })
})
