import { describe, expect, it } from 'vitest'
import {
  blocksNewCheckout,
  customerPaymentMethodChanged,
  meterDayDisposition,
  tierFromBasePrice,
} from '../../supabase/functions/_shared/billing-rules.ts'

describe('blocksNewCheckout', () => {
  it('blocks every status that still bills or can start billing', () => {
    for (const s of ['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused']) {
      expect(blocksNewCheckout(s)).toBe(true)
    }
  })
  it('allows a new checkout after a terminal status or with no subscription', () => {
    for (const s of ['canceled', 'incomplete_expired', null, undefined, '']) {
      expect(blocksNewCheckout(s)).toBe(false)
    }
  })
})

describe('meterDayDisposition', () => {
  const now = Date.parse('2026-10-09T09:00:00Z')

  it('waits on the current UTC day (its 23:59:59 stamp would be future-dated)', () => {
    expect(meterDayDisposition('2026-10-09', now)).toBe('wait')
  })
  it('pushes a completed day', () => {
    expect(meterDayDisposition('2026-10-08', now)).toBe('push')
    expect(meterDayDisposition('2026-09-05', now)).toBe('push')
  })
  it('expires days outside Stripe’s 35-day window', () => {
    expect(meterDayDisposition('2026-09-03', now)).toBe('expired')
    expect(meterDayDisposition('2026-08-10', now)).toBe('expired')
  })
  it('treats an unparseable day as expired rather than pushing it', () => {
    expect(meterDayDisposition('not-a-date', now)).toBe('expired')
  })
})

describe('tierFromBasePrice', () => {
  const base = (tier: string) => ({ price: { metadata: { kind: 'base', project: 'mushi-mushi', tier } } })
  const overage = { price: { metadata: { kind: 'overage', project: 'mushi-mushi', tier: 'indie' } } }

  it('reads the tier from the base price, wherever it sits in the items', () => {
    expect(tierFromBasePrice([overage, base('pro')])).toBe('pro')
  })
  it('ignores overage prices and other products on the shared account', () => {
    expect(tierFromBasePrice([overage])).toBeNull()
    expect(tierFromBasePrice([{ price: { metadata: { kind: 'base', project: 'yen-yen', tier: 'pro' } } }])).toBeNull()
    expect(tierFromBasePrice([{ price: null }, {}])).toBeNull()
  })
})

describe('customerPaymentMethodChanged', () => {
  it('is true only when the default payment method changed', () => {
    expect(customerPaymentMethodChanged({ invoice_settings: { default_payment_method: null } })).toBe(true)
  })
  it('ignores address and name updates that Checkout makes', () => {
    expect(customerPaymentMethodChanged({ address: null, name: null })).toBe(false)
    expect(customerPaymentMethodChanged({ invoice_settings: { footer: null } })).toBe(false)
    expect(customerPaymentMethodChanged(undefined)).toBe(false)
  })
})
