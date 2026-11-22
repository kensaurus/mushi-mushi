/**
 * Team → Billing (round-2 review 2026-11-18): "Seats 3 / 5" next to
 * "Admin seats Unlimited", because the billing tier has no seat_limit.
 */

import { describe, expect, it } from 'vitest'
import { appUsageFacts, seatEntitlementLabel } from './billingView'

describe('seatEntitlementLabel', () => {
  it('uses the same limit as the Seats meter', () => {
    expect(seatEntitlementLabel({ teams: true, seatLimit: 5, limitKnown: true })).toBe('5')
  })

  it('never says Unlimited when the limit is unknown', () => {
    expect(seatEntitlementLabel({ teams: true, seatLimit: null, limitKnown: false })).toBeNull()
    expect(seatEntitlementLabel({ teams: true, seatLimit: null, limitKnown: true })).toBe('Unlimited')
  })

  it('a plan without teams is one person', () => {
    expect(seatEntitlementLabel({ teams: false, seatLimit: 5, limitKnown: true })).toBe('Just you')
  })
})

describe('appUsageFacts', () => {
  const usd = (n: number) => `$${n.toFixed(4)}`

  it('has no fixes count: the team meter is the one source', () => {
    const facts = appUsageFacts({ tokens: 0 }, 0.019, usd)
    expect(facts.map((f) => f.label)).toEqual(['Classifier tokens', 'AI cost'])
    expect(facts.find((f) => /fix/i.test(f.label))).toBeUndefined()
  })

  it('marks zero counts so they draw grey', () => {
    const [tokens, cost] = appUsageFacts({ tokens: 0 }, 0.019, usd)
    expect(tokens).toMatchObject({ value: '0', zero: true })
    expect(cost).toMatchObject({ value: '$0.0190', zero: false })
  })

  it("shows this app's fixes only when the team meters are hidden", () => {
    const facts = appUsageFacts({ tokens: 3, fixes: 0, fixesSucceeded: 2 }, null, usd, { includeFixes: true })
    expect(facts[0]).toEqual({ label: 'Fixes merged', value: '2', zero: false })
  })

  it('leaves the cost out when the API sent none', () => {
    expect(appUsageFacts({ tokens: 12 }, undefined, usd)).toHaveLength(1)
  })
})
