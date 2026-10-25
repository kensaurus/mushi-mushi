import { describe, expect, it } from 'vitest'
import { memberPlanBadge, orgRoleDefinition, seatBillingExplainer, visiblePlanLabel } from './orgRoleGuide'

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
    expect(copy.body).toMatch(/You're on Hobby with 1 seat left — upgrade on Billing/)
  })

  it('complimentary org does not read as a paid Pro plan', () => {
    expect(visiblePlanLabel('Pro', 'pro', 'complimentary')).toBe('Admin · Pro')
    const badge = memberPlanBadge({
      planDisplayName: 'Pro',
      planId: 'pro',
      billingMode: 'complimentary',
      teamsEnabled: true,
    })
    expect(badge.label).toBe('Admin · Pro')
    expect(badge.tone).toBe('brand')
    const copy = seatBillingExplainer({
      planDisplayName: 'Pro',
      planId: 'pro',
      seatLimit: 5,
      seatsUsed: 3,
      teamsEnabled: true,
      billingMode: 'complimentary',
    })
    expect(copy.body).toMatch(/You're on Admin · Pro with 2 seats left/)
    expect(copy.body).not.toMatch(/upgrade on Billing/i)
    expect(copy.billingLink).toBe(false)
  })
})
