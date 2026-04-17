// ============================================================
// Wave D D5: Thin Stripe wrapper for the Mushi Cloud product.
//
// Wraps just the four operations the Edge Functions actually need:
//   1. createCustomer / retrieveCustomer  — sign-up bootstrap
//   2. createCheckoutSession              — sign-up redirect
//   3. createBillingPortalSession         — manage card / cancel
//   4. recordMeterEvents                  — usage push (Stripe Meter Events)
//
// Plus signature verification for the webhook receiver.
//
// Direct REST calls — no `npm:stripe@x` SDK so we can run on Deno Edge
// without bundling 600KB. The contract is documented inline.
// ============================================================
import { log } from './logger.ts'

const stripeLog = log.child('stripe')

const STRIPE_API = 'https://api.stripe.com/v1'

export interface StripeConfig {
  secretKey: string
  webhookSecret: string
  meterEventName: string  // e.g. 'reports_ingested'
  defaultPriceId: string  // metered price ID for the Cloud Starter plan
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
      'Stripe-Version': '2025-08-27.acacia',
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
    }),
  })

export const retrieveCustomer = (cfg: StripeConfig, id: string): Promise<StripeCustomer> =>
  stripeFetch(cfg, `/customers/${id}`)

export interface CheckoutSession {
  id: string
  url: string
  customer: string
}

export const createCheckoutSession = (
  cfg: StripeConfig,
  args: { customer: string; projectId: string },
): Promise<CheckoutSession> =>
  stripeFetch(cfg, '/checkout/sessions', {
    method: 'POST',
    body: form({
      mode: 'subscription',
      customer: args.customer,
      'line_items[0][price]': cfg.defaultPriceId,
      success_url: cfg.successUrl,
      cancel_url: cfg.cancelUrl,
      'metadata[project_id]': args.projectId,
      'subscription_data[metadata][project_id]': args.projectId,
      automatic_tax: 'true',
      payment_method_collection: 'always',
    }),
  })

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

// ----------------------------------------------------------------
// Meter Events — Stripe's per-record usage reporting API
// (https://docs.stripe.com/billing/subscriptions/usage-based/recording-usage)
// ----------------------------------------------------------------
export interface MeterEventPayload {
  identifier: string                  // unique key for idempotency
  customer: string                    // Stripe customer ID
  value: number                       // units in this event
  timestamp?: number                  // unix seconds; defaults to now
}

export const recordMeterEvent = async (
  cfg: StripeConfig,
  payload: MeterEventPayload,
): Promise<{ identifier: string }> => {
  const body = form({
    event_name: cfg.meterEventName,
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
  meterEventName: Deno.env.get('STRIPE_METER_EVENT_NAME') ?? 'reports_ingested',
  defaultPriceId: Deno.env.get('STRIPE_DEFAULT_PRICE_ID') ?? '',
  successUrl: Deno.env.get('STRIPE_SUCCESS_URL') ?? 'https://app.mushimushi.dev/billing/success',
  cancelUrl: Deno.env.get('STRIPE_CANCEL_URL') ?? 'https://app.mushimushi.dev/billing/cancel',
  portalReturnUrl: Deno.env.get('STRIPE_PORTAL_RETURN_URL') ?? 'https://app.mushimushi.dev/settings/billing',
})

declare const Deno: { env: { get(name: string): string | undefined } }
