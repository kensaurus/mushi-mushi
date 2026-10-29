/**
 * FILE: apps/admin/src/lib/billingFunnel.ts
 * PURPOSE: The console's half of the 60-day price test (docs/plan-pricing.md,
 *          2026-10-28): which billing moments become ad-hoc product events,
 *          and how a Stripe Checkout return is read from the URL.
 *
 *   pricing_viewed      the Plans tab is shown
 *   plan_selected       a plan is picked on Overview or Plans (BillingPage pickPlan)
 *   checkout_started    just before the browser leaves for Stripe Checkout
 *   checkout_completed  Stripe sends the person back with ?checkout=success
 *
 * Stripe returns to /billing/success or /billing/cancel (STRIPE_SUCCESS_URL,
 * STRIPE_CANCEL_URL defaults); the router sends both to Team > Billing with
 * ?checkout=success|cancelled, which the page reads once and then removes.
 */

export type CheckoutOutcome = 'success' | 'cancelled'

export function checkoutOutcome(value: string | null): CheckoutOutcome | null {
  return value === 'success' || value === 'cancelled' ? value : null
}

/** The search string without the checkout marker, so a reload never counts it twice. */
export function withoutCheckoutMarker(search: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(search)
  next.delete('checkout')
  return next
}
