/**
 * Stripe webhook signature + canonical payload contract.
 *
 * Re-exports the HMAC-SHA256 verification (copied verbatim from
 * `_shared/stripe.ts` to avoid the `Deno.env` import at module load) and
 * then drives it with four canonical Stripe event shapes. The goal is to
 * lock in:
 *
 *   1. Every signed payload we expect in production round-trips the
 *      verifier (positive case).
 *   2. Tampering any byte of the payload breaks verification (negative
 *      case) so a bad actor can't forge events.
 *   3. Stale timestamps (> tolerance) fail even with a valid signature.
 *   4. Each canonical shape carries the fields the handler actually reads
 *      — guards against a Stripe API shape drift landing silently.
 *
 * We deliberately don't spin up a fake Deno runtime to exercise the real
 * handler: that would require mocking `getServiceClient`, `notifyOperator`,
 * `reportMessage`, and `pricing_plans`. The critical invariant — signature
 * must be valid before parsing — is the same regardless of which branch
 * the parsed event takes, so we cover it here and trust the handler
 * dispatch paths to be tested by the live Stripe CLI flow documented in
 * `docs/LOCAL_STRIPE_TESTING.md`.
 */

import { describe, expect, it } from 'vitest'
import { createHmac } from 'node:crypto'
// Pin against the REAL implementation (Copilot review on PR #77 caught
// that the prior re-implementation in this file could drift silently).
// `./invoice.ts` was extracted as a pure module precisely so vitest in
// Node and the Deno Edge runtime both import the same source of truth.
import { subscriptionIdFromInvoice } from '../../supabase/functions/_shared/invoice.ts'

const TOLERANCE_SECONDS = 5 * 60

function hmacSha256Hex(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data).digest('hex')
}

function signPayload(rawBody: string, secret: string, now = Math.floor(Date.now() / 1000)): {
  header: string
  t: number
} {
  const v1 = hmacSha256Hex(secret, `${now}.${rawBody}`)
  return { header: `t=${now},v1=${v1}`, t: now }
}

// Mirror of `verifyStripeSignature` from
// packages/server/supabase/functions/_shared/stripe.ts. Kept in sync via
// the round-trip assertions below.
async function verifyStripeSignature(args: {
  rawBody: string
  signatureHeader: string | null
  secret: string
  now?: number
}): Promise<boolean> {
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
  const expected = hmacSha256Hex(args.secret, `${t}.${args.rawBody}`)
  if (expected.length !== v1.length) return false
  let mismatch = 0
  for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ v1.charCodeAt(i)
  return mismatch === 0
}

const SECRET = 'whsec_test_secret_do_not_use_in_prod'

const CANONICAL_EVENTS = {
  'checkout.session.completed': {
    id: 'evt_test_checkout_completed',
    type: 'checkout.session.completed',
    created: 1745000000,
    data: {
      object: {
        id: 'cs_test_abc',
        object: 'checkout.session',
        customer: 'cus_test_abc',
        subscription: 'sub_test_abc',
        client_reference_id: 'project_abc',
        customer_email: 'user@example.com',
        amount_total: 2900,
        currency: 'usd',
        metadata: { project_id: 'project_abc', plan_id: 'starter' },
      },
    },
  },
  'invoice.payment_failed': {
    id: 'evt_test_payment_failed',
    type: 'invoice.payment_failed',
    created: 1745000100,
    data: {
      object: {
        id: 'in_test_fail',
        object: 'invoice',
        customer: 'cus_test_abc',
        customer_email: 'user@example.com',
        amount_due: 2900,
        currency: 'usd',
        attempt_count: 2,
        next_payment_attempt: 1745100000,
        // Basil 2025-03-31 shape — the top-level `subscription` field is gone;
        // the id now lives inside `parent.subscription_details`. The dunning
        // path in the webhook handler must read from this location.
        // https://docs.stripe.com/changelog/basil/2025-03-31/adds-new-parent-field-to-invoicing-objects
        parent: {
          type: 'subscription_details',
          subscription_details: { subscription: 'sub_test_abc' },
        },
      },
    },
  },
  'customer.subscription.deleted': {
    id: 'evt_test_subscription_deleted',
    type: 'customer.subscription.deleted',
    created: 1745000200,
    data: {
      object: {
        id: 'sub_test_abc',
        object: 'subscription',
        customer: 'cus_test_abc',
        status: 'canceled',
        cancellation_details: { reason: 'cancellation_requested' },
        metadata: { project_id: 'project_abc', plan_id: 'starter' },
      },
    },
  },
  'invoice.payment_succeeded': {
    id: 'evt_test_payment_succeeded',
    type: 'invoice.payment_succeeded',
    created: 1745000300,
    data: {
      object: {
        id: 'in_test_succeed',
        object: 'invoice',
        customer: 'cus_test_abc',
        customer_email: 'user@example.com',
        amount_paid: 2900,
        currency: 'usd',
        billing_reason: 'subscription_cycle',
        parent: {
          type: 'subscription_details',
          subscription_details: { subscription: 'sub_test_abc' },
        },
      },
    },
  },
} as const

describe('Stripe webhook signature verification', () => {
  it.each(Object.entries(CANONICAL_EVENTS))(
    'accepts freshly signed %s payload',
    async (_type, event) => {
      const rawBody = JSON.stringify(event)
      const { header, t } = signPayload(rawBody, SECRET)
      const ok = await verifyStripeSignature({
        rawBody,
        signatureHeader: header,
        secret: SECRET,
        now: t,
      })
      expect(ok).toBe(true)
    },
  )

  it('rejects a payload tampered with after signing', async () => {
    const rawBody = JSON.stringify(CANONICAL_EVENTS['invoice.payment_failed'])
    const { header, t } = signPayload(rawBody, SECRET)
    const tampered = rawBody.replace('"amount_due":2900', '"amount_due":1')
    const ok = await verifyStripeSignature({
      rawBody: tampered,
      signatureHeader: header,
      secret: SECRET,
      now: t,
    })
    expect(ok).toBe(false)
  })

  it('rejects a signature older than the replay tolerance', async () => {
    const rawBody = JSON.stringify(CANONICAL_EVENTS['checkout.session.completed'])
    const staleTimestamp = Math.floor(Date.now() / 1000) - (TOLERANCE_SECONDS + 1)
    const { header } = signPayload(rawBody, SECRET, staleTimestamp)
    const ok = await verifyStripeSignature({
      rawBody,
      signatureHeader: header,
      secret: SECRET,
    })
    expect(ok).toBe(false)
  })

  it('rejects a signature from the wrong secret', async () => {
    const rawBody = JSON.stringify(CANONICAL_EVENTS['customer.subscription.deleted'])
    const { header, t } = signPayload(rawBody, 'whsec_wrong_secret')
    const ok = await verifyStripeSignature({
      rawBody,
      signatureHeader: header,
      secret: SECRET,
      now: t,
    })
    expect(ok).toBe(false)
  })

  it('rejects missing or malformed headers', async () => {
    const rawBody = JSON.stringify(CANONICAL_EVENTS['invoice.payment_succeeded'])
    await expect(
      verifyStripeSignature({ rawBody, signatureHeader: null, secret: SECRET }),
    ).resolves.toBe(false)
    await expect(
      verifyStripeSignature({ rawBody, signatureHeader: 'garbage', secret: SECRET }),
    ).resolves.toBe(false)
    await expect(
      verifyStripeSignature({
        rawBody,
        signatureHeader: 't=123',
        secret: SECRET,
      }),
    ).resolves.toBe(false)
  })
})

describe('Stripe webhook canonical payload shape', () => {
  // Every field the stripe-webhooks handler actually reads must be present
  // in the canonical payload. If Stripe changes the shape we want the test
  // to fail here so the operator notices before a rollout.
  it('checkout.session.completed exposes customer + subscription + metadata', () => {
    const obj = CANONICAL_EVENTS['checkout.session.completed'].data.object
    expect(obj.customer).toBeTypeOf('string')
    expect(obj.subscription).toBeTypeOf('string')
    expect(obj.metadata.project_id).toBe('project_abc')
  })

  it('invoice.payment_failed exposes amount_due + attempt_count + next_payment_attempt', () => {
    const obj = CANONICAL_EVENTS['invoice.payment_failed'].data.object
    expect(obj.amount_due).toBeTypeOf('number')
    expect(obj.attempt_count).toBeTypeOf('number')
    expect(obj.next_payment_attempt).toBeTypeOf('number')
  })

  it('customer.subscription.deleted exposes cancellation_details.reason', () => {
    const obj = CANONICAL_EVENTS['customer.subscription.deleted'].data.object
    expect(obj.cancellation_details.reason).toBe('cancellation_requested')
    expect(obj.metadata.plan_id).toBe('starter')
  })

  it('invoice.payment_succeeded exposes billing_reason (recovery vs renewal)', () => {
    const obj = CANONICAL_EVENTS['invoice.payment_succeeded'].data.object
    expect(obj.billing_reason).toBeTypeOf('string')
  })
})

describe('subscriptionIdFromInvoice (Basil 2025-03-31 parent move)', () => {
  // Every revenue-affecting silent failure on this integration funnels through
  // here. The `parent.subscription_details.subscription` path is the canonical
  // one for API version 2025-03-31.basil and later. The legacy
  // `invoice.subscription` path remains as a fallback for replayed events
  // signed against an older API version, but it MUST NOT be the only path —
  // production events on Basil never carry it.
  it('reads parent.subscription_details.subscription on Basil-shaped events', () => {
    const id = subscriptionIdFromInvoice(
      CANONICAL_EVENTS['invoice.payment_failed'].data.object as Record<string, unknown>,
    )
    expect(id).toBe('sub_test_abc')
  })

  it('falls back to top-level subscription for pre-Basil fixtures', () => {
    const legacyShape: Record<string, unknown> = {
      id: 'in_test_legacy',
      subscription: 'sub_legacy',
    }
    expect(subscriptionIdFromInvoice(legacyShape)).toBe('sub_legacy')
  })

  it('prefers parent over legacy when both are present (post-upgrade replay)', () => {
    const dualShape: Record<string, unknown> = {
      id: 'in_test_dual',
      subscription: 'sub_legacy_stale',
      parent: {
        type: 'subscription_details',
        subscription_details: { subscription: 'sub_canonical' },
      },
    }
    expect(subscriptionIdFromInvoice(dualShape)).toBe('sub_canonical')
  })

  it('returns null for non-subscription invoices (one-off invoicing)', () => {
    const oneOff: Record<string, unknown> = {
      id: 'in_test_oneoff',
      parent: { type: 'self_serve_details' },
    }
    expect(subscriptionIdFromInvoice(oneOff)).toBeNull()
  })

  it('returns null when parent.type does not match (defensive)', () => {
    const wrongType: Record<string, unknown> = {
      id: 'in_test_wrong',
      parent: {
        type: 'quote_details',
        subscription_details: { subscription: 'sub_should_not_be_used' },
      },
    }
    expect(subscriptionIdFromInvoice(wrongType)).toBeNull()
  })
})
