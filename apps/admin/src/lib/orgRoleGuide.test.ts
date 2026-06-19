import { describe, expect, it } from 'vitest'
import { orgRoleDefinition, seatBillingExplainer } from './orgRoleGuide'

describe('orgRoleGuide', () => {
  it('defines all four roles', () => {
    expect(orgRoleDefinition('admin').canDo.length).toBeGreaterThan(0)
    expect(orgRoleDefinition('viewer').cannotDo[0]).toMatch(/invite/i)
  })

  it('unlimited seats copy says role does not affect price', () => {
    const copy = seatBillingExplainer({
      planDisplayName: 'Pro',
      planId: 'pro',
      seatLimit: null,
      seatsUsed: 3,
      teamsEnabled: true,
    })
    expect(copy.body).toMatch(/do not add to your bill/i)
  })

  it('capped plan mentions remaining seats', () => {
    const copy = seatBillingExplainer({
      planDisplayName: 'Hobby',
      planId: 'hobby',
      seatLimit: 3,
      seatsUsed: 2,
      teamsEnabled: true,
    })
    expect(copy.headline).toMatch(/2 of 3/)
  })
})
