/**
 * The console's half of the 60-day price test (lib/billingFunnel.ts): a
 * Stripe Checkout return is read once from the URL, and the Billing page
 * records pricing_viewed, checkout_started and checkout_completed.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkoutOutcome, withoutCheckoutMarker } from './billingFunnel'

describe('checkout return', () => {
  it('reads success and cancelled, nothing else', () => {
    expect(checkoutOutcome('success')).toBe('success')
    expect(checkoutOutcome('cancelled')).toBe('cancelled')
    expect(checkoutOutcome('done')).toBeNull()
    expect(checkoutOutcome(null)).toBeNull()
  })

  it('drops only the marker, so a reload never counts it twice', () => {
    const next = withoutCheckoutMarker(new URLSearchParams('view=billing&checkout=success&tab=plans'))
    expect(next.toString()).toBe('view=billing&tab=plans')
  })
})

describe('wiring', () => {
  const page = readFileSync(join(__dirname, '../pages/BillingPage.tsx'), 'utf8')
  const app = readFileSync(join(__dirname, '../App.tsx'), 'utf8')
  const read = (rel: string) => readFileSync(join(__dirname, rel), 'utf8')

  it('records the price-test events on the Billing page', () => {
    expect(page).toContain("trackAdHoc('pricing_viewed'")
    expect(page).toContain("trackAdHoc('checkout_completed'")
    // Both pickers (Overview and Plans) go through pickPlan, which records the
    // interval actually chosen; it used to be hardcoded 'monthly'.
    const pick = page.indexOf('const pickPlan = useCallback(')
    const selected = page.indexOf("trackAdHoc('plan_selected', { plan_id: planId, interval: billingInterval")
    expect(pick).toBeGreaterThan(0)
    expect(selected).toBeGreaterThan(pick)
    expect(read('../components/billing/PlanComparisonTable.tsx')).not.toContain("interval: 'monthly'")
    const started = page.indexOf("trackAdHoc('checkout_started'")
    expect(started).toBeGreaterThan(0)
    // Recorded before the browser leaves for Stripe.
    expect(started).toBeLessThan(page.indexOf('window.location.href = res.data.url'))
  })

  it("routes Stripe's success and cancel returns to Billing instead of the 404 page", () => {
    expect(app).toContain('path="/billing/success" element={<Navigate to="/team?view=billing&checkout=success" replace />}')
    expect(app).toContain('path="/billing/cancel" element={<Navigate to="/team?view=billing&checkout=cancelled" replace />}')
  })
})
