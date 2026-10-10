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

// ── Annual plans and in-app plan changes (2026-10-10) ────────────────────────
//
// Decision: annual plans have no pay-as-you-go overage. They stop at the
// plan's included monthly diagnoses, and the console offers an upgrade or a
// switch to monthly. Why not an annual base plus a monthly metered item on one
// subscription (Stripe "mixed interval")? Checkout cannot create one
// (docs.stripe.com/billing/subscriptions/mixed-interval, Limitations), a
// failed overage invoice cancels the whole annual subscription (same page,
// "Cancel a subscription"), and the customer portal cannot update a
// subscription with usage-based billing either way
// (docs.stripe.com/customer-management, Limitations). Plan changes therefore
// go through our own Subscriptions API route, not the portal.

export type BillingInterval = 'monthly' | 'annual'

/** Plans a customer can switch between in-app. Enterprise is sales-led. */
export const SELF_SERVE_CHANGE_PLANS = ['indie', 'pro'] as const
export type SelfServeChangePlan = (typeof SELF_SERVE_CHANGE_PLANS)[number]

export function isSelfServeChangePlan(id: unknown): id is SelfServeChangePlan {
  return typeof id === 'string' && (SELF_SERVE_CHANGE_PLANS as readonly string[]).includes(id)
}

export function isBillingInterval(v: unknown): v is BillingInterval {
  return v === 'monthly' || v === 'annual'
}

/**
 * Whether diagnoses above the included quota can be billed for this project.
 * Overage is billable only when the subscription carries the metered overage
 * item; annual subscriptions never do, so they stop at the included quota.
 * No subscription row (free plans, complimentary orgs) leaves the decision to
 * the plan, as before.
 */
export function diagnosisOverageBillable(
  sub: { overage_subscription_item_id?: string | null } | null | undefined,
): boolean {
  if (!sub) return true
  return !!sub.overage_subscription_item_id
}

/**
 * Stripe price IDs for a self-serve plan at an interval, read from the env
 * names scripts/stripe-bootstrap.mjs prints. Annual has no overage price.
 * Mirrors the checkout route's mapping for Indie and Pro.
 */
export function selfServePlanPrices(
  planId: SelfServeChangePlan,
  interval: BillingInterval,
  env: (name: string) => string | undefined,
): { base: string | undefined; overage: string | undefined } {
  if (planId === 'indie') {
    return interval === 'annual'
      ? { base: env('STRIPE_PRICE_INDIE_ANNUAL'), overage: undefined }
      : { base: env('STRIPE_PRICE_INDIE_BASE'), overage: env('STRIPE_PRICE_INDIE_DIAGNOSES_OVERAGE') }
  }
  return interval === 'annual'
    ? { base: env('STRIPE_PRICE_PRO_ANNUAL'), overage: undefined }
    : {
        base: env('STRIPE_PRICE_PRO_BASE_V2') ?? env('STRIPE_PRICE_PRO_BASE'),
        overage: env('STRIPE_PRICE_PRO_DIAGNOSES_OVERAGE') ?? env('STRIPE_PRICE_PRO_OVERAGE'),
      }
}

/** Monthly or annual, from a Stripe price's recurring interval. */
export function intervalFromRecurring(
  recurring: { interval?: string | null; interval_count?: number | null } | null | undefined,
): BillingInterval {
  if (!recurring) return 'monthly'
  if (recurring.interval === 'year') return 'annual'
  if (recurring.interval === 'month' && (recurring.interval_count ?? 1) >= 12) return 'annual'
  return 'monthly'
}

interface SubItemLike {
  id: string
  price?: {
    id?: string
    metadata?: Record<string, string> | null
    recurring?: { interval?: string | null; interval_count?: number | null } | null
  } | null
}

const isOverageItem = (item: SubItemLike) => item.price?.metadata?.kind === 'overage'

/**
 * The flat base item of a subscription. Item order is not guaranteed once an
 * item has been added or removed, so never assume `items[0]`.
 */
export function baseSubscriptionItem<T extends SubItemLike>(items: readonly T[]): T | null {
  return items.find((i) => !isOverageItem(i)) ?? null
}

export function overageSubscriptionItem<T extends SubItemLike>(items: readonly T[]): T | null {
  return items.find(isOverageItem) ?? null
}

export type PlanChangeItem =
  | { id: string; price: string; quantity: 1 }
  | { id: string; deleted: true }
  | { price: string }

export interface PlanChangePlan {
  items: PlanChangeItem[]
  /** The interval changes, so the new price starts a fresh period today. */
  resetBillingAnchor: boolean
  fromInterval: BillingInterval
}

/**
 * The `items[]` for a Subscriptions API update that moves a subscription to a
 * new base price and, for monthly plans, the matching overage price.
 *
 * - The base item keeps its id and gets the new price.
 * - A different overage price replaces the old item (delete + add) instead
 *   of swapping in place. In flexible billing mode, deleting a usage-based
 *   item invoices its unbilled usage at the old price
 *   (docs.stripe.com/billing/subscriptions/billing-mode/compare, "Bill for
 *   unbilled usage when removing usage-based items"), and each plan's
 *   graduated price has its own free allowance.
 * - Annual targets drop the overage item; monthly targets add one.
 */
export function planChangeItems(input: {
  items: readonly SubItemLike[]
  targetBasePriceId: string
  targetOveragePriceId: string | null
  targetInterval: BillingInterval
}): PlanChangePlan {
  const base = baseSubscriptionItem(input.items)
  if (!base) throw new Error('subscription has no base item')
  const overage = overageSubscriptionItem(input.items)
  const fromInterval = intervalFromRecurring(base.price?.recurring)

  const items: PlanChangeItem[] = [{ id: base.id, price: input.targetBasePriceId, quantity: 1 }]
  if (overage && overage.price?.id !== input.targetOveragePriceId) {
    items.push({ id: overage.id, deleted: true })
  }
  if (input.targetOveragePriceId && overage?.price?.id !== input.targetOveragePriceId) {
    items.push({ price: input.targetOveragePriceId })
  }
  return { items, resetBillingAnchor: fromInterval !== input.targetInterval, fromInterval }
}

/** Form fields for `items[]` under a prefix (`items` or `subscription_details[items]`). */
export function planChangeItemFields(prefix: string, items: readonly PlanChangeItem[]): Array<[string, string]> {
  const out: Array<[string, string]> = []
  items.forEach((item, i) => {
    const k = `${prefix}[${i}]`
    if ('deleted' in item) {
      out.push([`${k}[id]`, item.id], [`${k}[deleted]`, 'true'])
    } else if ('id' in item) {
      out.push([`${k}[id]`, item.id], [`${k}[price]`, item.price], [`${k}[quantity]`, String(item.quantity)])
    } else {
      out.push([`${k}[price]`, item.price])
    }
  })
  return out
}

export type PlanChangeRefusal =
  | 'NO_SUBSCRIPTION'
  | 'SUBSCRIPTION_NOT_CHANGEABLE'
  | 'PLAN_NOT_SELF_SERVE'
  | 'NO_CHANGE'

/**
 * Why an in-app plan change must be refused, or null when it may proceed.
 * Only active or trialing subscriptions change in-app: past_due / unpaid
 * must settle the open invoice first (portal), and incomplete / paused ones
 * have no settled plan to move from.
 */
export function planChangeRefusal(input: {
  status: string | null | undefined
  currentPlanId: string | null | undefined
  currentInterval: BillingInterval
  targetPlanId: string
  targetInterval: BillingInterval
}): PlanChangeRefusal | null {
  if (!input.status) return 'NO_SUBSCRIPTION'
  if (input.status !== 'active' && input.status !== 'trialing') return 'SUBSCRIPTION_NOT_CHANGEABLE'
  if (!isSelfServeChangePlan(input.targetPlanId)) return 'PLAN_NOT_SELF_SERVE'
  if (input.currentPlanId === input.targetPlanId && input.currentInterval === input.targetInterval) {
    return 'NO_CHANGE'
  }
  return null
}
