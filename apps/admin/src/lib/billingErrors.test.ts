/**
 * Billing toasts showed raw codes like NO_STRIPE_CUSTOMER (suspected-bugs
 * entry 254).
 */

import { describe, expect, it } from 'vitest'
import { describeBillingError } from './billingErrors'

describe('describeBillingError', () => {
  it('translates a code-only error (apiEnvelope copies the code into message)', () => {
    const text = describeBillingError({ code: 'NO_STRIPE_CUSTOMER', message: 'NO_STRIPE_CUSTOMER' })
    expect(text).toMatch(/no billing account yet/)
    expect(text).not.toContain('NO_STRIPE_CUSTOMER')
    expect(describeBillingError({ code: 'FORBIDDEN', message: 'FORBIDDEN' })).toMatch(/Ask an owner/)
  })

  it('keeps a real server sentence', () => {
    expect(describeBillingError({ code: 'PLAN_SALES_LED', message: 'Enterprise requires contacting sales.' })).toBe(
      'Enterprise requires contacting sales.',
    )
  })

  it('never shows an unknown code or raw HTTP text', () => {
    expect(describeBillingError({ code: 'WEIRD_THING', message: 'WEIRD_THING' })).toMatch(/Nothing was charged/)
    expect(describeBillingError({ code: 'HTTP_ERROR', message: '502: <html>' })).toMatch(/Nothing was charged/)
    expect(describeBillingError(undefined)).toMatch(/Nothing was charged/)
  })
})
