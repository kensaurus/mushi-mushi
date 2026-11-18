import { describe, expect, it } from 'vitest'
import { membersSeatCalloutHasNews, orgRoleDefinition, seatBillingExplainer } from './orgRoleGuide'

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
    // Members shows "2/3" in its Seats tile; the card explains instead of
    // repeating the count (console sweep, 2026-10-28). Billing keeps it.
    expect(copy.headline).toBe('How seats work')
    expect(copy.body).toMatch(/1 seat left/)
    expect(seatBillingExplainer({ planDisplayName: 'Hobby', planId: 'hobby', seatLimit: 3, seatsUsed: 2, teamsEnabled: true, onBillingPage: true }).headline).toMatch(/2 of 3/)
  })

  // On Billing itself the card said "upgrade on Billing" and linked to Billing (2026-10-28).
  it('does not send someone on Billing to Billing', () => {
    const ctx = { planDisplayName: 'Pro', planId: 'pro', seatLimit: 5, seatsUsed: 4, teamsEnabled: true }
    expect(seatBillingExplainer(ctx).body).toMatch(/upgrade on Billing/)
    const onBilling = seatBillingExplainer({ ...ctx, onBillingPage: true })
    expect(onBilling.body).not.toMatch(/on Billing/)
    expect(onBilling.body).toMatch(/under Plans/)
    expect(onBilling.billingLink).toBe(false)
  })

  // Owner 2026-11-18: the Members "Seat usage" card repeated 3/5 beside the
  // Seats tile. It shows only near the cap; Teams-off has the upgrade banner.
  it('keeps the Members seat card for news only', () => {
    const base = { planDisplayName: 'Studio', planId: 'pro', teamsEnabled: true }
    expect(membersSeatCalloutHasNews({ ...base, seatLimit: 5, seatsUsed: 3 })).toBe(false)
    expect(membersSeatCalloutHasNews({ ...base, seatLimit: 5, seatsUsed: 4 })).toBe(true)
    expect(membersSeatCalloutHasNews({ ...base, seatLimit: null, seatsUsed: 9 })).toBe(false)
    expect(membersSeatCalloutHasNews({ ...base, teamsEnabled: false, seatLimit: 1, seatsUsed: 1 })).toBe(false)
  })
})
