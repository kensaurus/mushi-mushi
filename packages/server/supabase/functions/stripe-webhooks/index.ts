// ============================================================
// Wave D D5: Stripe webhook receiver.
//
// Listens for the four event families that drive subscription state and
// payment-method readiness:
//
//   * customer.subscription.{created,updated,deleted,paused,resumed}
//   * customer.updated  (default_payment_method changes)
//   * invoice.payment_failed   (flip status to past_due quickly)
//   * checkout.session.completed (link Stripe customer back to project)
//
// Mirrors them into `billing_subscriptions` / `billing_customers`. The
// gateway reads `billing_subscriptions.status` to gate API access — a
// `canceled` or `unpaid` subscription returns 402 from `/v1/ingest`.
//
// Verifies Stripe-Signature with `verifyStripeSignature` BEFORE parsing
// the body, replies 200 with a structured ack so Stripe doesn't retry.
// ============================================================
import { getServiceClient } from '../_shared/db.ts'
import { log } from '../_shared/logger.ts'
import { stripeFromEnv, verifyStripeSignature } from '../_shared/stripe.ts'
import { withSentry } from '../_shared/sentry.ts'

const wlog = log.child('stripe-webhooks')

interface StripeEvent {
  id: string
  type: string
  data: { object: Record<string, unknown> }
  created: number
}

const upsertSubscription = async (
  db: ReturnType<typeof getServiceClient>,
  sub: Record<string, unknown>,
) => {
  const projectId = (sub.metadata as Record<string, string> | undefined)?.['project_id']
  if (!projectId) {
    wlog.warn('subscription_missing_project_id', { id: sub.id })
    return
  }
  const item = ((sub.items as { data?: Array<{ price: { id: string } }> } | undefined)?.data ?? [])[0]
  const priceId = item?.price?.id
  if (!priceId) {
    wlog.warn('subscription_missing_price', { id: sub.id })
    return
  }
  const { error } = await db.from('billing_subscriptions').upsert(
    {
      project_id: projectId,
      stripe_subscription_id: sub.id as string,
      stripe_price_id: priceId,
      status: sub.status as string,
      current_period_start: new Date(((sub.current_period_start as number) ?? 0) * 1000).toISOString(),
      current_period_end: new Date(((sub.current_period_end as number) ?? 0) * 1000).toISOString(),
      cancel_at_period_end: Boolean(sub.cancel_at_period_end),
      metadata: sub.metadata ?? {},
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'stripe_subscription_id' },
  )
  if (error) wlog.error('subscription_upsert_failed', { error: error.message })
}

const linkCustomerOnCheckout = async (
  db: ReturnType<typeof getServiceClient>,
  session: Record<string, unknown>,
) => {
  const projectId = (session.metadata as Record<string, string> | undefined)?.['project_id']
  const customerId = session.customer as string | undefined
  const email = (session.customer_details as { email?: string } | undefined)?.email
  if (!projectId || !customerId) return
  const { error } = await db.from('billing_customers').upsert(
    {
      project_id: projectId,
      stripe_customer_id: customerId,
      email: email ?? '',
      default_payment_ok: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'project_id' },
  )
  if (error) wlog.error('customer_upsert_failed', { error: error.message })
}

const markPaymentDelinquent = async (
  db: ReturnType<typeof getServiceClient>,
  invoice: Record<string, unknown>,
) => {
  const subId = invoice.subscription as string | undefined
  if (!subId) return
  const { error } = await db
    .from('billing_subscriptions')
    .update({ status: 'past_due', updated_at: new Date().toISOString() })
    .eq('stripe_subscription_id', subId)
  if (error) wlog.error('mark_past_due_failed', { error: error.message })
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
    default:
      wlog.debug('event_ignored', { type: event.type })
  }

  return Response.json({ ok: true, event_id: event.id })
}

Deno.serve(withSentry(handler, { name: 'stripe-webhooks' }))

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): void; env: { get(name: string): string | undefined } }
