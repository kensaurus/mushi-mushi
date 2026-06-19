import { describe, expect, it } from 'vitest'
import { heroSnapshotFromPageStats } from './heroSnapshots'
import { EMPTY_MEMBERS_STATS } from '../components/members/types'
import { heroMetricChips } from './pageHeroSnapshot'

describe('heroSnapshotFromPageStats', () => {
  it('uses page stats not zeros', () => {
    const hero = heroSnapshotFromPageStats('/organization/members', {
      ...EMPTY_MEMBERS_STATS,
      memberCount: 3,
      inactiveCount: 3,
      pendingInvites: 0,
    })
    expect(hero).not.toBeNull()
    expect(hero!.decide?.metric).toContain('3 members')
    expect(hero!.decide?.metric).toContain('3 inactive')
    expect(hero!.decide?.severity).toBe('warn')
    expect(hero!.act?.title).toMatch(/Audit/)
  })

  it('splits metrics into readable chips', () => {
    const chips = heroMetricChips('3 members · 3 inactive · 0 pending')
    expect(chips).toEqual(['3 members', '3 inactive', '0 pending'])
  })
})
