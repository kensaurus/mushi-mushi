// ============================================================
// Stripe webhook receiver — production-hardened.
//
// Listens for the event families that drive subscription state and
// payment-method readiness:
//
//   * customer.subscription.{created,updated,deleted,paused,resumed}
//   * customer.updated  (default_payment_method changes)
//   * invoice.payment_failed   (flip status to past_due quickly)
//   * invoice.payment_succeeded (flip past_due → active when retry recovers)
//   * checkout.session.completed (link Stripe customer back to project)
//
// Mirrors them into `billing_subscriptions` / `billing_customers`. The
// gateway reads `billing_subscriptions.status` + `.plan_id` to drive quota.
//
// Hardening:
//   * Verifies Stripe-Signature with `verifyStripeSignature` BEFORE parsing.
//   * Idempotency via `stripe_processed_events` (PRIMARY KEY = event.id).
//   * On DB error → returns 500 so Stripe RETRIES (per Stripe docs, any
//     non-2xx triggers automatic retry with exponential backoff). The
//     pre-hardening version swallowed errors and returned 200, silently
//     dropping subscription state.
//   * Plan resolution from line item lookup_keys → pricing_plans.id.
//   * Period start/end pulled from `items.data[0]` (Stripe API
//     2025-03-31.basil moved them off the subscription object).
// ============================================================
import { getServiceClient } from '../_shared/db.ts'
import { log } from '../_shared/logger.ts'
import {
  retrieveSubscription,
  readSubscriptionPeriod,
  stripeFromEnv,
  verifyStripeSignature,
  type StripeSubscription,
} from '../_shared/stripe.ts'
import { getPlanByBaseLookupKey } from '../_shared/plans.ts'
import { invalidateQuotaCache } from '../_shared/quota.ts'
import { withSentry } from '../_shared/sentry.ts'

const wlog = log.child('stripe-webhooks')

interface StripeEvent {
  id: string
  type: string
  data: { object: Record<string, unknown> }
  created: number
}

type Db = ReturnType<typeof getServiceClient>

// Stripe sometimes sends the same event multiple times (retries, our timeouts,
// network blips). Dedup by event.id BEFORE doing any work — the table has
// PRIMARY KEY on event_id so a unique-violation means "already processed".
async function recordIfNew(db: Db, event: StripeEvent): Promise<boolean> {
  const { error } = await db
    .from('stripe_processed_events')
    .insert({ event_id: event.id, event_type: event.type })
  if (!error) return true
  // 23505 = unique_violation. PostgREST surfaces this in `error.code`.
  if (error.code === '23505') return false
  // Anything else is unexpected — bubble up so we 500 and Stripe retries.
  throw new Error(`stripe_processed_events insert failed: ${error.message}`)
}

// Resolve the pricing_plans.id for a subscription. Priority order:
//   1. `subscription.metadata.plan_id` (set by our Checkout Session)
//   2. Lookup the FIRST line item's `price.lookup_key` against pricing_plans.base_price_lookup_key
//   3. Default to 'hobby' (i.e. effectively a downgrade). The webhook callers
//      will surface this in logs so a misconfigured price can be caught.
async function resolvePlanId(
  db: Db,
  sub: StripeSubscription,
): Promise<string | null> {
  const fromMetadata = sub.metadata?.plan_id
  if (fromMetadata) return fromMetadata

  const items = sub.items?.data ?? []
  for (const item of items) {
    const lookup = item.price?.lookup_key
    if (!lookup) continue
    const plan = await getPlanByBaseLookupKey(lookup)
    if (plan) return plan.id
  }
  wlog.warn('plan_resolution_failed', { sub_id: sub.id, item_count: items.length })
  return null
}

// Prefer the period from a hydrated subscription (we expand items.data when
// re-fetching). Fall back to the webhook payload's items.data[0] which is
// the post-2025-03-31 location for these fields.
function periodFromAny(
  sub: Record<string, unknown>,
): { start: number | null; end: number | null } {
  return readSubscriptionPeriod(sub as StripeSubscription)
}

const upsertSubscription = async (db: Db, raw: Record<string, unknown>) => {
  const subId = raw.id as string
  const projectId = (raw.metadata as Record<string, string> | undefined)?.['project_id']
  if (!projectId) {
    wlog.warn('subscription_missing_project_id', { id: subId })
    return
  }

  // Webhook payloads include `items.data` but with a slimmer shape than the
  // API call returns. Re-fetch so we have a stable view of price + period.
  const cfg = stripeFromEnv()
  let sub: StripeSubscription
  try {
    sub = await retrieveSubscription(cfg, subId)
  } catch (err) {
    wlog.warn('subscription_refetch_failed_falling_back_to_payload', {
      id: subId,
      err: err instanceof Error ? err.message : String(err),
    })
    sub = raw as unknown as StripeSubscription
  }

  const item = sub.items?.data?.[0]
  const priceId = item?.price?.id
  if (!priceId) {
    throw new Error(`subscription ${subId} has no items[0].price.id — cannot persist`)
  }

  const planId = await resolvePlanId(db, sub)
  const { start, end } = periodFromAny(sub as unknown as Record<string, unknown>)
  const overageItem = sub.items.data.find((i) =>
    (i.price?.metadata?.kind ?? '') === 'overage',
  )

  const { error } = await db.from('billing_subscriptions').upsert(
    {
      project_id: projectId,
      stripe_subscription_id: subId,
      stripe_price_id: priceId,
      plan_id: planId,
      overage_subscription_item_id: overageItem?.id ?? null,
      status: sub.status,
      current_period_start: new Date((start ?? 0) * 1000).toISOString(),
      current_period_end: new Date((end ?? 0) * 1000).toISOString(),
      cancel_at_period_end: Boolean(sub.cancel_at_period_end),
      metadata: sub.metadata ?? {},
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'stripe_subscription_id' },
  )
  if (error) throw new Error(`subscription_upsert_failed: ${error.message}`)
  invalidateQuotaCache(projectId)
}

// `checkout.session.completed` doesn't necessarily mean the card is good —
// Stripe also fires it for synchronous-failure flows. Read `payment_status`
// to set `default_payment_ok` honestly so the UI doesn't lie.
const linkCustomerOnCheckout = async (db: Db, session: Record<string, unknown>) => {
  const projectId = (session.metadata as Record<string, string> | undefined)?.['project_id']
  const customerId = session.customer as string | undefined
  const email = (session.customer_details as { email?: string } | undefined)?.email
  if (!projectId || !customerId) return
  const paymentOk = session.payment_status === 'paid' || session.payment_status === 'no_payment_required'
  const { error } = await db.from('billing_customers').upsert(
    {
      project_id: projectId,
      stripe_customer_id: customerId,
      email: email ?? '',
      default_payment_ok: paymentOk,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'project_id' },
  )
  if (error) throw new Error(`customer_upsert_failed: ${error.message}`)
  invalidateQuotaCache(projectId)
}

const markPaymentDelinquent = async (db: Db, invoice: Record<string, unknown>) => {
  const subId = invoice.subscription as string | undefined
  if (!subId) return
  const { error } = await db
    .from('billing_subscriptions')
    .update({ status: 'past_due', updated_at: new Date().toISOString() })
    .eq('stripe_subscription_id', subId)
  if (error) throw new Error(`mark_past_due_failed: ${error.message}`)
  invalidateQuotaCache()
}

const recoverFromDelinquent = async (db: Db, invoice: Record<string, unknown>) => {
  const subId = invoice.subscription as string | undefined
  if (!subId) return
  // Only flip past_due → active. A successful invoice on an `active` sub is a no-op.
  const { error } = await db
    .from('billing_subscriptions')
    .update({ status: 'active', updated_at: new Date().toISOString() })
    .eq('stripe_subscription_id', subId)
    .eq('status', 'past_due')
  if (error) throw new Error(`recover_active_failed: ${error.message}`)
  invalidateQuotaCache()
}

const updateCustomerPaymentOk = async (db: Db, customer: Record<string, unknown>) => {
  const customerId = customer.id as string | undefined
  if (!customerId) return
  const settings = customer.invoice_settings as { default_payment_method?: string | null } | undefined
  const ok = !!settings?.default_payment_method
  const { error } = await db
    .from('billing_customers')
    .update({ default_payment_ok: ok, updated_at: new Date().toISOString() })
    .eq('stripe_customer_id', customerId)
  if (error) throw new Error(`customer_payment_update_failed: ${error.message}`)
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return new Response('method_not_allowed', { status: 405 })

  const cfg = stripeFromEnv()
  if (!cfg.webhookSecret) {
    wlog.error('missing_webhook_secret')
    return new Response('misconfigured', { status: 500 })
  }

  const rawBody = await req.text()
  const ok = await verifyStripeSignature({
    rawBody,
    signatureHeader: req.headers.get('stripe-signature'),
    secret: cfg.webhookSecret,
  })
  if (!ok) {
    wlog.warn('signature_verification_failed')
    return new Response('bad_signature', { status: 400 })
  }

  let event: StripeEvent
  try {
    event = JSON.parse(rawBody) as StripeEvent
  } catch {
    return new Response('invalid_json', { status: 400 })
  }

  const db = getServiceClient()

  // Idempotency BEFORE work. If the row insert succeeds, we own the event.
  // Anything else means another invocation is already processing it.
  let isNew: boolean
  try {
    isNew = await recordIfNew(db, event)
  } catch (err) {
    wlog.error('idempotency_check_failed', {
      event_id: event.id,
      err: err instanceof Error ? err.message : String(err),
    })
    return new Response('db_error', { status: 500 })
  }
  if (!isNew) {
    wlog.debug('event_already_processed', { event_id: event.id, type: event.type })
    return Response.json({ ok: true, deduped: true, event_id: event.id })
  }

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
      case 'customer.subscription.paused':
      case 'customer.subscription.resumed':
        await upsertSubscription(db, event.data.object)
        break
      case 'checkout.session.completed':
        await linkCustomerOnCheckout(db, event.data.object)
        break
      case 'invoice.payment_failed':
        await markPaymentDelinquent(db, event.data.object)
        break
      case 'invoice.payment_succeeded':
        await recoverFromDelinquent(db, event.data.object)
        break
      case 'customer.updated':
        await updateCustomerPaymentOk(db, event.data.object)
        break
      default:
        wlog.debug('event_ignored', { type: event.type })
    }
  } catch (err) {
    // Roll back the idempotency row so Stripe's retry actually re-enters
    // this handler. Without this, the next attempt would dedup and 200.
    await db.from('stripe_processed_events').delete().eq('event_id', event.id)
    wlog.error('event_handler_failed', {
      event_id: event.id,
      type: event.type,
      err: err instanceof Error ? err.message : String(err),
    })
    return new Response('handler_error', { status: 500 })
  }

  return Response.json({ ok: true, event_id: event.id })
}

Deno.serve(withSentry(handler, { name: 'stripe-webhooks' }))

declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): void
  env: { get(name: string): string | undefined }
}
