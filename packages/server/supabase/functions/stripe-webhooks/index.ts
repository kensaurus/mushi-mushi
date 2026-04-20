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
import { getPlan, getPlanByBaseLookupKey } from '../_shared/plans.ts'
import { invalidateQuotaCache } from '../_shared/quota.ts'
import { withSentry } from '../_shared/sentry.ts'
import { notifyOperator, type NotifyField } from '../_shared/operator-notify.ts'

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

// Returns true when the row was actually flipped (i.e. it was past_due and
// is now active). Lets the caller decide whether to fire the
// "payment recovered" operator notification — a routine successful invoice
// on an already-active sub doesn't deserve a Slack ping.
const recoverFromDelinquent = async (db: Db, invoice: Record<string, unknown>): Promise<boolean> => {
  const subId = invoice.subscription as string | undefined
  if (!subId) return false
  const { data, error } = await db
    .from('billing_subscriptions')
    .update({ status: 'active', updated_at: new Date().toISOString() })
    .eq('stripe_subscription_id', subId)
    .eq('status', 'past_due')
    .select('stripe_subscription_id')
  if (error) throw new Error(`recover_active_failed: ${error.message}`)
  invalidateQuotaCache()
  return (data?.length ?? 0) > 0
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

// ============================================================
// Operator notifications.
//
// Fired AFTER the database mutation succeeds — we'd rather lose a Slack
// ping than corrupt billing state. All helpers swallow their own errors;
// the caller wraps with `.catch(() => {})` for belt-and-braces safety.
// ============================================================

const STRIPE_DASHBOARD_ROOT = (Deno.env.get('STRIPE_LIVEMODE') === 'true')
  ? 'https://dashboard.stripe.com'
  : 'https://dashboard.stripe.com/test'

function projectName(metadata: Record<string, string> | undefined): string {
  return metadata?.['project_id']?.slice(0, 8) ?? 'unknown'
}

function maskEmail(email: string | null | undefined): string {
  if (!email) return 'unknown@—'
  const [local, domain] = email.split('@')
  if (!domain || !local) return email
  const prefix = local.length <= 2 ? local : `${local.slice(0, 2)}…`
  return `${prefix}@${domain}`
}

async function notifyCheckoutCompleted(
  session: Record<string, unknown>,
): Promise<void> {
  const projectId = (session.metadata as Record<string, string> | undefined)?.['project_id']
  const planMetadata = (session.metadata as Record<string, string> | undefined)?.['plan_id']
  const customerId = session.customer as string | undefined
  const email = (session.customer_details as { email?: string } | undefined)?.email
  const amountTotal = session.amount_total as number | undefined
  const currency = (session.currency as string | undefined)?.toUpperCase() ?? 'USD'
  const paymentStatus = session.payment_status as string | undefined

  let planLabel = planMetadata ?? 'unknown'
  if (planMetadata) {
    try {
      const plan = await getPlan(planMetadata)
      planLabel = `${plan.display_name} ($${plan.monthly_price_usd}/mo)`
    } catch {
      // fall through with the metadata id as label
    }
  }

  const fields: NotifyField[] = [
    { label: 'Plan', value: planLabel },
    { label: 'Project', value: projectName(session.metadata as Record<string, string> | undefined) },
    { label: 'Email', value: maskEmail(email) },
    { label: 'Payment', value: paymentStatus ?? 'unknown' },
  ]
  if (amountTotal != null) {
    fields.push({ label: 'Charged', value: `${(amountTotal / 100).toFixed(2)} ${currency}` })
  }

  await notifyOperator({
    title: 'New paid customer',
    body: `*${maskEmail(email)}* completed Checkout for project \`${projectId ?? '?'}\`.`,
    level: 'info',
    fields,
    url: customerId ? `${STRIPE_DASHBOARD_ROOT}/customers/${customerId}` : undefined,
    footer: `event: checkout.session.completed`,
  }).catch(() => {})
}

async function notifySubscriptionDeleted(
  raw: Record<string, unknown>,
): Promise<void> {
  const subId = raw.id as string | undefined
  const customerId = raw.customer as string | undefined
  const meta = raw.metadata as Record<string, string> | undefined
  const planId = meta?.['plan_id']
  const cancelReason = (raw.cancellation_details as { reason?: string } | undefined)?.reason

  await notifyOperator({
    title: 'Customer cancelled',
    body: `Subscription \`${subId ?? '?'}\` ended. Project \`${projectName(meta)}\` has dropped to free.`,
    level: 'warn',
    fields: [
      { label: 'Plan', value: planId ?? 'unknown' },
      { label: 'Project', value: projectName(meta) },
      { label: 'Reason', value: cancelReason ?? 'not provided' },
    ],
    url: customerId ? `${STRIPE_DASHBOARD_ROOT}/customers/${customerId}` : undefined,
    footer: 'event: customer.subscription.deleted',
  }).catch(() => {})
}

async function notifyPaymentFailed(
  invoice: Record<string, unknown>,
): Promise<void> {
  const invoiceId = invoice.id as string | undefined
  const customerId = invoice.customer as string | undefined
  const customerEmail = invoice.customer_email as string | undefined
  const amountDue = invoice.amount_due as number | undefined
  const currency = (invoice.currency as string | undefined)?.toUpperCase() ?? 'USD'
  const attempt = invoice.attempt_count as number | undefined
  const nextAttempt = invoice.next_payment_attempt as number | undefined

  const fields: NotifyField[] = [
    { label: 'Customer', value: maskEmail(customerEmail) },
    { label: 'Attempt', value: String(attempt ?? '?') },
  ]
  if (amountDue != null) {
    fields.push({ label: 'Amount due', value: `${(amountDue / 100).toFixed(2)} ${currency}` })
  }
  if (nextAttempt) {
    fields.push({
      label: 'Next retry',
      value: new Date(nextAttempt * 1000).toUTCString(),
    })
  }

  await notifyOperator({
    title: 'Payment failed',
    body: `Card declined for *${maskEmail(customerEmail)}*. Subscription will move to \`past_due\`; quota stays enforced until the dunning window expires.`,
    level: 'urgent',
    fields,
    url: invoiceId ? `${STRIPE_DASHBOARD_ROOT}/invoices/${invoiceId}` : undefined,
    footer: 'event: invoice.payment_failed',
  }).catch(() => {})
}

async function notifyPaymentRecovered(
  invoice: Record<string, unknown>,
): Promise<void> {
  const customerId = invoice.customer as string | undefined
  const customerEmail = invoice.customer_email as string | undefined
  const amountPaid = invoice.amount_paid as number | undefined
  const currency = (invoice.currency as string | undefined)?.toUpperCase() ?? 'USD'

  await notifyOperator({
    title: 'Payment recovered',
    body: `*${maskEmail(customerEmail)}* paid the open invoice. Subscription is back to \`active\`.`,
    level: 'info',
    fields: [
      { label: 'Customer', value: maskEmail(customerEmail) },
      {
        label: 'Paid',
        value: amountPaid != null ? `${(amountPaid / 100).toFixed(2)} ${currency}` : 'unknown',
      },
    ],
    url: customerId ? `${STRIPE_DASHBOARD_ROOT}/customers/${customerId}` : undefined,
    footer: 'event: invoice.payment_succeeded (recovery)',
  }).catch(() => {})
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
        await upsertSubscription(db, event.data.object)
        // Note: the matching `checkout.session.completed` event also fires
        // and carries the rich payment context — we ping there, not here,
        // to avoid double-paging on every new sub.
        break
      case 'customer.subscription.updated': {
        await upsertSubscription(db, event.data.object)
        // Detect a downgrade-signal: the customer flipped on
        // `cancel_at_period_end`. Stripe doesn't fire `.deleted` until the
        // period ACTUALLY ends, which can be 30 days away — by then the
        // signal to retain them is stale. Surface it the moment they hit
        // "Cancel" in the Billing Portal.
        const obj = event.data.object as Record<string, unknown>
        const previous = (event.data as { previous_attributes?: Record<string, unknown> }).previous_attributes
        const wasNotCancelling = previous && 'cancel_at_period_end' in previous
          ? previous.cancel_at_period_end === false
          : false
        const isCancellingNow = obj.cancel_at_period_end === true
        if (wasNotCancelling && isCancellingNow) {
          await notifyOperator({
            title: 'Cancellation scheduled',
            body: `A customer scheduled cancellation at period end. You have ~30 days to reach out.`,
            level: 'warn',
            fields: [
              { label: 'Project', value: projectName(obj.metadata as Record<string, string> | undefined) },
              { label: 'Plan', value: (obj.metadata as Record<string, string> | undefined)?.['plan_id'] ?? 'unknown' },
              { label: 'Period ends', value: typeof obj.current_period_end === 'number'
                  ? new Date((obj.current_period_end as number) * 1000).toUTCString()
                  : 'unknown' },
            ],
            url: typeof obj.customer === 'string'
              ? `${STRIPE_DASHBOARD_ROOT}/customers/${obj.customer}`
              : undefined,
            footer: 'event: customer.subscription.updated (cancel_at_period_end → true)',
          }).catch(() => {})
        }
        break
      }
      case 'customer.subscription.deleted':
        await upsertSubscription(db, event.data.object)
        await notifySubscriptionDeleted(event.data.object)
        break
      case 'customer.subscription.paused':
      case 'customer.subscription.resumed':
        await upsertSubscription(db, event.data.object)
        break
      case 'checkout.session.completed':
        await linkCustomerOnCheckout(db, event.data.object)
        await notifyCheckoutCompleted(event.data.object)
        break
      case 'invoice.payment_failed':
        await markPaymentDelinquent(db, event.data.object)
        await notifyPaymentFailed(event.data.object)
        break
      case 'invoice.payment_succeeded': {
        const wasRecovery = await recoverFromDelinquent(db, event.data.object)
        // Only ping on actual recovery. Routine renewals every month don't
        // deserve a notification — they'd train the operator to ignore the
        // channel.
        if (wasRecovery) await notifyPaymentRecovered(event.data.object)
        break
      }
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

Deno.serve(withSentry('stripe-webhooks', handler))

declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): void
  env: { get(name: string): string | undefined }
}
