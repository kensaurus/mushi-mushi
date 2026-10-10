/**
 * FILE: packages/server/supabase/functions/_shared/billing-rules.ts
 * PURPOSE: Pure billing decisions shared by the checkout route, the Stripe
 *          webhook and the usage aggregator. Zero imports (no `Deno.env`,
 *          no logger) so Vitest in Node and the Deno Edge runtime import
 *          the same source, the same way `./invoice.ts` does.
 */

/**
 * Subscription statuses that still bill, or can still start billing, the
 * customer. A project in one of these must not get a second Checkout
 * Session: Stripe would create a second subscription and charge both.
 * `canceled` and `incomplete_expired` are terminal, so a new checkout is fine.
 */
const LIVE_SUBSCRIPTION_STATUSES = new Set([
  'active',
  'trialing',
  'past_due',
  'unpaid',
  'incomplete',
  'paused',
])

export function blocksNewCheckout(status: string | null | undefined): boolean {
  return !!status && LIVE_SUBSCRIPTION_STATUSES.has(status)
}

/** The product inbox (docs/adr/0015). Enterprise is arranged here. */
export const SALES_CONTACT_EMAIL = 'kensaurus@gmail.com'

/**
 * Plans that are arranged with us rather than bought through Checkout.
 * Enterprise is sales-led by owner decision (2026-10-10), whatever its
 * `pricing_plans.is_self_serve` row says: that row was once flipped to
 * self-serve outside a migration, and this keeps such a drift from
 * reopening checkout.
 */
export function isSalesLedPlan(plan: { id: string; is_self_serve: boolean }): boolean {
  return plan.id === 'enterprise' || !plan.is_self_serve
}

/** The checkout refusal for a sales-led plan, with the address to write to. */
export function salesLedCheckoutError(displayName: string): {
  code: 'PLAN_SALES_LED'
  message: string
  contact: string
} {
  const subject = encodeURIComponent(`Mushi ${displayName} inquiry`)
  return {
    code: 'PLAN_SALES_LED',
    message: `${displayName} is arranged with our team, not bought online. Email ${SALES_CONTACT_EMAIL} and we will set it up with you.`,
    contact: `mailto:${SALES_CONTACT_EMAIL}?subject=${subject}`,
  }
}

/** Stripe accepts meter events up to 35 days old and at most 5 min ahead. */
export const METER_EVENT_MAX_AGE_DAYS = 35

/**
 * What the usage aggregator does with one UTC day of unsynced usage.
 *
 *   wait    — the day is still open. The event is stamped at the day's last
 *             second, which Stripe rejects as future-dated, and pushing a
 *             partial day would reuse the day's identifier for the rest.
 *   push    — a completed day Stripe still accepts.
 *   expired — older than Stripe's 35-day window; every retry would fail.
 *
 * Source: https://docs.stripe.com/api/billing/meter-event/create —
 * timestamp "must be within the past 35 calendar days or up to 5 minutes
 * in the future".
 */
export function meterDayDisposition(dayUtc: string, nowMs: number): 'wait' | 'push' | 'expired' {
  const dayEndMs = Date.parse(`${dayUtc}T23:59:59Z`)
  if (Number.isNaN(dayEndMs)) return 'expired'
  if (dayEndMs >= nowMs) return 'wait'
  // Leave an hour of margin inside the window so a slow run can't cross it.
  const oldestMs = nowMs - METER_EVENT_MAX_AGE_DAYS * 86_400_000 + 3_600_000
  return dayEndMs < oldestMs ? 'expired' : 'push'
}

interface PriceLike {
  lookup_key?: string | null
  metadata?: Record<string, string> | null
}

/**
 * The plan tier a subscription is actually paying for, read from its base
 * price (`metadata.kind = 'base'`, set by scripts/stripe-bootstrap.mjs on
 * every monthly and annual base price). Prefer this over the subscription's
 * own `metadata.plan_id`, which stays at the checkout-time value if the
 * price is ever swapped in the Dashboard.
 */
export function tierFromBasePrice(items: Array<{ price?: PriceLike | null }>): string | null {
  for (const item of items) {
    const meta = item.price?.metadata
    if (meta?.kind === 'base' && meta?.project === 'mushi-mushi' && meta.tier) return meta.tier
  }
  return null
}

/**
 * Whether a `customer.updated` event changed the Customer's default payment
 * method. Checkout attaches the card to the Subscription, not to
 * `invoice_settings`, and `customer_update[address]=auto` makes Checkout
 * update the Customer, so most `customer.updated` events say nothing about
 * the card. Only these may touch `billing_customers.default_payment_ok`.
 */
export function customerPaymentMethodChanged(
  previousAttributes: Record<string, unknown> | null | undefined,
): boolean {
  const prev = previousAttributes?.invoice_settings as Record<string, unknown> | undefined
  return !!prev && 'default_payment_method' in prev
}
