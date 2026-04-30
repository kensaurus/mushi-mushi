// ============================================================
// Thin Stripe wrapper for Mushi Mushi Cloud.
//
// Wraps just the operations the Edge Functions actually need:
//   1. createCustomer / retrieveCustomer  — sign-up bootstrap
//   2. createCheckoutSession              — sign-up + plan upgrade redirect
//   3. createBillingPortalSession         — manage card / cancel / switch
//   4. listInvoices                       — billing UI history
//   5. recordMeterEvent                   — usage push (Stripe Meter Events)
//   6. retrieveSubscription               — webhook hydrate w/ items expanded
//
// Plus signature verification for the webhook receiver.
//
// Direct REST calls — no `npm:stripe@x` SDK so we can run on Deno Edge
// without bundling 600KB. The contract is documented inline.
// ============================================================
import { log } from './logger.ts'
import { SUPPORT_EMAIL } from './support.ts'

const stripeLog = log.child('stripe')

const STRIPE_API = 'https://api.stripe.com/v1'

export interface StripeConfig {
  secretKey: string
  webhookSecret: string
  /**
   * Stripe Billing Meter `event_name` for ingested user reports.
   * Defaults to `mushi_reports_ingested` to avoid name collisions with
   * other projects on the same Stripe account. The legacy alias
   * `reports_ingested` is also accepted by `stripeFromEnv()` for
   * backwards compatibility with installs that haven't run the bootstrap
   * script yet.
   */
  meterEventName: string
  /** Meter event name for successfully merged auto-fix PRs (value-based pricing). */
  fixesMeterEventName: string
  /** Legacy single-price alias — the Starter base price ID. Kept for the */
  /** pre-tier-rollout `/billing/checkout` callers that didn't pass a plan. */
  defaultPriceId: string
  successUrl: string
  cancelUrl: string
  portalReturnUrl: string
}

const form = (params: Record<string, string | number | boolean | undefined>) => {
  const u = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue
    u.set(k, String(v))
  }
  return u
}

const stripeFetch = async <T>(
  cfg: StripeConfig,
  path: string,
  init: { method: string; body?: URLSearchParams } = { method: 'GET' },
): Promise<T> => {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${cfg.secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': '2025-08-27.basil',
    },
    body: init.body?.toString(),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    stripeLog.error('stripe_http_error', { path, status: res.status, body: text })
    throw new Error(`stripe ${path} -> ${res.status}: ${text}`)
  }
  return (await res.json()) as T
}

export interface StripeCustomer {
  id: string
  email: string | null
  default_source?: string | null
  invoice_settings?: { default_payment_method: string | null }
}

export const createCustomer = (
  cfg: StripeConfig,
  args: { email: string; name?: string; projectId: string },
): Promise<StripeCustomer> =>
  stripeFetch(cfg, '/customers', {
    method: 'POST',
    body: form({
      email: args.email,
      name: args.name,
      'metadata[project_id]': args.projectId,
      'metadata[source]': 'mushi-mushi',
    }),
  })

export const retrieveCustomer = (cfg: StripeConfig, id: string): Promise<StripeCustomer> =>
  stripeFetch(cfg, `/customers/${id}`)

export interface CheckoutSession {
  id: string
  url: string
  customer: string
}

export interface CheckoutLineItem {
  /** Stripe Price ID. */
  price: string
  /** Optional fixed quantity. Metered prices must omit this. */
  quantity?: number
}

export interface CreateCheckoutSessionArgs {
  customer: string
  projectId: string
  /**
   * Plan we're upgrading the customer to. Persisted as `metadata.plan_id` on
   * both the Checkout Session and the resulting Subscription so the webhook
   * can hydrate `billing_subscriptions.plan_id` without a Stripe round-trip.
   */
  planId: string
  /**
   * Line items for the subscription. The first item is the flat base fee;
   * subsequent items are metered overage prices (no quantity).
   */
  lineItems: CheckoutLineItem[]
  /** Optional Checkout Session-level override (e.g. self-serve coupon code). */
  promotionCode?: string
}

export const createCheckoutSession = (
  cfg: StripeConfig,
  args: CreateCheckoutSessionArgs,
): Promise<CheckoutSession> => {
  // Read from the canonical SUPPORT_EMAIL helper rather than re-implementing
  // the env-var fallback inline (the previous duplicate hard-coded
  // `support@mushimushi.dev` and silently drifted out of sync with
  // `_shared/support.ts` once we changed the maintainer inbox).
  const supportEmail = SUPPORT_EMAIL
  const body = form({
    mode: 'subscription',
    customer: args.customer,
    success_url: cfg.successUrl,
    cancel_url: cfg.cancelUrl,
    'metadata[project_id]': args.projectId,
    'metadata[plan_id]': args.planId,
    'subscription_data[metadata][project_id]': args.projectId,
    'subscription_data[metadata][plan_id]': args.planId,
    'subscription_data[metadata][source]': 'mushi-mushi',
    automatic_tax: 'true',
    payment_method_collection: 'always',
    allow_promotion_codes: 'true',
    billing_address_collection: 'auto',
    // Surface the support address on the Checkout page so prospects know
    // where to ask questions BEFORE they hand over their card. Stripe caps
    // each entry at 1000 chars; a short tagline is plenty.
    'custom_text[submit][message]':
      `Need a hand? Email ${supportEmail} — we reply within one business day.`,
    'custom_text[after_submit][message]':
      `Receipt + login link will arrive at the email you entered. Questions? ${supportEmail}`,
  })
  args.lineItems.forEach((item, i) => {
    body.set(`line_items[${i}][price]`, item.price)
    if (item.quantity !== undefined) {
      body.set(`line_items[${i}][quantity]`, String(item.quantity))
    }
  })
  if (args.promotionCode) body.set('discounts[0][promotion_code]', args.promotionCode)
  return stripeFetch(cfg, '/checkout/sessions', { method: 'POST', body })
}

export interface PortalSession {
  id: string
  url: string
}

export const createBillingPortalSession = (
  cfg: StripeConfig,
  customer: string,
): Promise<PortalSession> =>
  stripeFetch(cfg, '/billing_portal/sessions', {
    method: 'POST',
    body: form({ customer, return_url: cfg.portalReturnUrl }),
  })

export interface StripeInvoice {
  id: string
  number: string | null
  status: string
  amount_due: number
  amount_paid: number
  currency: string
  created: number
  hosted_invoice_url: string | null
  invoice_pdf: string | null
  period_start: number
  period_end: number
}

export const listInvoices = (
  cfg: StripeConfig,
  customer: string,
  limit = 10,
): Promise<{ data: StripeInvoice[] }> =>
  stripeFetch(cfg, `/invoices?customer=${encodeURIComponent(customer)}&limit=${limit}`)

// ----------------------------------------------------------------
// Subscription hydration
// ----------------------------------------------------------------
//
// Stripe API version 2025-03-31.basil moved `current_period_start` and
// `current_period_end` from the Subscription onto each Subscription Item,
// because subscriptions can now have items with mixed billing cycles. The
// pre-2025 webhook payload still includes these fields at the subscription
// level for backwards compatibility — but only when reading via API call,
// not in webhook events. To get a stable view, we pull the subscription
// with `expand[]=items.data` and read the period from `items.data[0]`.
export interface StripeSubscriptionItem {
  id: string
  price: { id: string; lookup_key?: string | null; metadata?: Record<string, string> }
  current_period_start: number
  current_period_end: number
  metadata?: Record<string, string>
}
export interface StripeSubscription {
  id: string
  status: string
  customer: string
  cancel_at_period_end: boolean
  current_period_start?: number
  current_period_end?: number
  metadata: Record<string, string>
  items: { data: StripeSubscriptionItem[] }
}

export const retrieveSubscription = (
  cfg: StripeConfig,
  subscriptionId: string,
): Promise<StripeSubscription> =>
  stripeFetch(
    cfg,
    `/subscriptions/${encodeURIComponent(subscriptionId)}?expand[]=items.data.price`,
  )

/**
 * Pull the canonical (start, end) for a subscription regardless of which
 * Stripe API quirk it came from. Falls back through every known location:
 *
 *   1. Newest API: `items.data[i].current_period_start/_end`
 *   2. Pre-2025-03-31: subscription-level fields (kept for old test fixtures)
 *   3. Last resort: `null` so the caller can decide whether to refetch
 */
export function readSubscriptionPeriod(
  sub: StripeSubscription | Record<string, unknown>,
): { start: number | null; end: number | null } {
  const items = (sub as StripeSubscription).items?.data ?? []
  const first = items[0]
  if (first?.current_period_start && first?.current_period_end) {
    return { start: first.current_period_start, end: first.current_period_end }
  }
  const start = (sub as { current_period_start?: number }).current_period_start ?? null
  const end = (sub as { current_period_end?: number }).current_period_end ?? null
  return { start, end }
}

// Re-exported from `./invoice.ts` so production AND the vitest test file
// share the exact same implementation. See `./invoice.ts` for the why.
export { subscriptionIdFromInvoice } from './invoice.ts'

// ----------------------------------------------------------------
// Meter Events — Stripe's per-record usage reporting API
// (https://docs.stripe.com/billing/subscriptions/usage-based/recording-usage)
// ----------------------------------------------------------------
export interface MeterEventPayload {
  identifier: string                  // unique key for idempotency
  customer: string                    // Stripe customer ID
  value: number                       // units in this event
  timestamp?: number                  // unix seconds; defaults to now
  /**
   * Optional override of the meter event name. Defaults to the config's
   * `meterEventName`. Pass to record `mushi_fixes_succeeded` from the
   * fix-worker without threading a second config through.
   */
  eventName?: string
}

export const recordMeterEvent = async (
  cfg: StripeConfig,
  payload: MeterEventPayload,
): Promise<{ identifier: string }> => {
  const body = form({
    event_name: payload.eventName ?? cfg.meterEventName,
    'payload[stripe_customer_id]': payload.customer,
    'payload[value]': payload.value,
    identifier: payload.identifier,
    timestamp: payload.timestamp,
  })
  return stripeFetch(cfg, '/billing/meter_events', { method: 'POST', body })
}

// ----------------------------------------------------------------
// Webhook signature verification — see
// https://docs.stripe.com/webhooks/signature
// ----------------------------------------------------------------
const TOLERANCE_SECONDS = 300

const hmacSha256Hex = async (key: string, body: string): Promise<string> => {
  const enc = new TextEncoder()
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(body))
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

const constantTimeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}

export const verifyStripeSignature = async (args: {
  rawBody: string
  signatureHeader: string | null
  secret: string
  now?: number
}): Promise<boolean> => {
  if (!args.signatureHeader) return false
  const parts = Object.fromEntries(
    args.signatureHeader.split(',').map((p) => {
      const [k, v] = p.split('=')
      return [k.trim(), (v ?? '').trim()]
    }),
  )
  const t = Number(parts['t'])
  const v1 = parts['v1']
  if (!t || !v1) return false

  const now = args.now ?? Math.floor(Date.now() / 1000)
  if (Math.abs(now - t) > TOLERANCE_SECONDS) return false

  const expected = await hmacSha256Hex(args.secret, `${t}.${args.rawBody}`)
  return constantTimeEqual(expected, v1)
}

export const stripeFromEnv = (): StripeConfig => ({
  secretKey: Deno.env.get('STRIPE_SECRET_KEY') ?? '',
  webhookSecret: Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '',
  // Default to the namespaced meter name created by `scripts/stripe-bootstrap.mjs`.
  // Old installs setting `STRIPE_METER_EVENT_NAME=reports_ingested` keep working.
  meterEventName: Deno.env.get('STRIPE_METER_REPORTS_EVENT_NAME')
    ?? Deno.env.get('STRIPE_METER_EVENT_NAME')
    ?? 'mushi_reports_ingested',
  fixesMeterEventName: Deno.env.get('STRIPE_METER_FIXES_EVENT_NAME') ?? 'mushi_fixes_succeeded',
  defaultPriceId: Deno.env.get('STRIPE_DEFAULT_PRICE_ID') ?? Deno.env.get('STRIPE_PRICE_STARTER_BASE') ?? '',
  successUrl: Deno.env.get('STRIPE_SUCCESS_URL') ?? 'https://app.mushimushi.dev/billing/success',
  cancelUrl: Deno.env.get('STRIPE_CANCEL_URL') ?? 'https://app.mushimushi.dev/billing/cancel',
  portalReturnUrl: Deno.env.get('STRIPE_PORTAL_RETURN_URL') ?? 'https://app.mushimushi.dev/settings/billing',
})

declare const Deno: { env: { get(name: string): string | undefined } }
